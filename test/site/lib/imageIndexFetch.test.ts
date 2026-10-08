import { describe, expect, test, vi } from "vitest";
import { createImageIndexLoader } from "../../../src/site/lib/imageIndexFetch.js";
import type { FetchLike, ImageIndex } from "../../../src/site/lib/wireTypes.js";

const HEX = "a".repeat(64);
const DIGEST = `sha256:${HEX}`;
const URL = `/p/ns/pkg/o/sha256/${HEX}.json`;

const INDEX: ImageIndex = {
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [],
};

type Resp = { ok: boolean; status?: number; json?: () => Promise<unknown> };
function respond(resp: Resp) {
  return vi.fn(async () => resp) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

describe("createImageIndexLoader", () => {
  test("fetches <wireBase>/p/<ns>/<pkg>/o/sha256/<hex>.json", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    const load = createImageIndexLoader(fetchFn);

    expect(await load("ns", "pkg", DIGEST, "")).toEqual(INDEX);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(URL);
  });

  test("a non-root source is fetched under its mount prefix", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    await createImageIndexLoader(fetchFn)("ns", "pkg", DIGEST, "index/acme");
    expect(fetchFn).toHaveBeenCalledWith(`/index/acme${URL}`);
  });

  test("concurrent loads of one digest share a single request", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    const load = createImageIndexLoader(fetchFn);

    const [a, b] = await Promise.all([load("ns", "pkg", DIGEST, ""), load("ns", "pkg", DIGEST, "")]);

    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("the cache is keyed by digest alone: the same digest under another source never refetches", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    const load = createImageIndexLoader(fetchFn);

    await load("ns", "pkg", DIGEST, "");
    await load("ns", "pkg", DIGEST, "index/acme");

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("distinct digests are fetched separately", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    const load = createImageIndexLoader(fetchFn);

    await load("ns", "pkg", DIGEST, "");
    await load("ns", "pkg", `sha256:${"b".repeat(64)}`, "");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("a non-ok response resolves null and is not cached", async () => {
    const fetchFn = respond({ ok: false, status: 404 });
    const load = createImageIndexLoader(fetchFn);

    expect(await load("ns", "pkg", DIGEST, "")).toBeNull();
    expect(await load("ns", "pkg", DIGEST, "")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("a network error and a malformed body resolve null, never reject", async () => {
    const down = createImageIndexLoader((async () => Promise.reject(new Error("NetworkError"))) as FetchLike);
    expect(await down("ns", "pkg", DIGEST, "")).toBeNull();

    const garbled = createImageIndexLoader(respond({ ok: true, json: async () => Promise.reject(new SyntaxError("x")) }));
    expect(await garbled("ns", "pkg", DIGEST, "")).toBeNull();
  });

  test("the in-flight entry is released after a failure, so a retry fetches again", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => INDEX }) as unknown as FetchLike;
    const load = createImageIndexLoader(fetchFn);

    expect(await load("ns", "pkg", DIGEST, "")).toBeNull();
    expect(await load("ns", "pkg", DIGEST, "")).toEqual(INDEX);
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["an object without manifests", { schemaVersion: 2 }],
    ["manifests that is not an array", { manifests: "none" }],
  ])("a body that is %s resolves null and is not cached", async (_label, body) => {
    const fetchFn = respond({ ok: true, json: async () => body });
    const load = createImageIndexLoader(fetchFn);

    expect(await load("ns", "pkg", DIGEST, "")).toBeNull();
    expect(await load("ns", "pkg", DIGEST, "")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("the URL is built by casUrl: a malformed digest or an escaping name never reaches fetch", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    const load = createImageIndexLoader(fetchFn);

    expect(await load("ns", "pkg", `sha256:${"a".repeat(63)}/../x`, "")).toBeNull();
    expect(await load("ns", "pkg", `sha256:${HEX}\n`, "")).toBeNull();
    expect(await load("ns", "pkg", "../../etc/passwd", "")).toBeNull();
    expect(await load("..", "pkg", DIGEST, "")).toBeNull();
    expect(await load("ns", "../pkg", DIGEST, "")).toBeNull();
    expect(await load("ns", "pkg", DIGEST, "")).toEqual(INDEX);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(URL);
  });

  test("loaders keep separate caches", async () => {
    const fetchFn = respond({ ok: true, json: async () => INDEX });
    await createImageIndexLoader(fetchFn)("ns", "pkg", DIGEST, "");
    await createImageIndexLoader(fetchFn)("ns", "pkg", DIGEST, "");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
