import { describe, expect, test, vi } from "vitest";
import { fetchPackageRoot } from "../../../src/site/lib/packageRootFetch.js";
import { createRequestGate } from "../../../src/site/lib/requestGate.js";
import type { FetchLike, PackageRoot } from "../../../src/site/lib/wireTypes.js";

const ROOT = { name: "ocx.sh/kitware/cmake", tags: {} } as unknown as PackageRoot;
const ALWAYS = () => true;

type Resp = { ok: boolean; status: number; json?: () => Promise<unknown> };
const OK: Resp = { ok: true, status: 200, json: async () => ROOT };
const NOT_FOUND: Resp = { ok: false, status: 404 };

/** A fetch double that answers each URL from the table, in call order. */
function routes(table: Record<string, Resp>) {
  return vi.fn(async (url: string) => table[url]) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

describe("fetchPackageRoot", () => {
  test("reads the _root.json alias first and stops there when it answers", async () => {
    const fetchFn = routes({ "/p/kitware/cmake/_root.json": OK });

    expect(await fetchPackageRoot(fetchFn, "kitware", "cmake", "", ALWAYS)).toEqual({ status: "ok", root: ROOT });
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith("/p/kitware/cmake/_root.json");
  });

  test("falls back to the canonical path when the alias is 404", async () => {
    const fetchFn = routes({ "/p/kitware/cmake/_root.json": NOT_FOUND, "/p/kitware/cmake.json": OK });

    expect(await fetchPackageRoot(fetchFn, "kitware", "cmake", "", ALWAYS)).toEqual({ status: "ok", root: ROOT });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(["/p/kitware/cmake/_root.json", "/p/kitware/cmake.json"]);
  });

  test("prefixes both URLs with the source's mount prefix", async () => {
    const fetchFn = routes({
      "/index/acme/p/kitware/cmake/_root.json": NOT_FOUND,
      "/index/acme/p/kitware/cmake.json": NOT_FOUND,
    });

    await fetchPackageRoot(fetchFn, "kitware", "cmake", "index/acme", ALWAYS);

    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      "/index/acme/p/kitware/cmake/_root.json",
      "/index/acme/p/kitware/cmake.json",
    ]);
  });

  test.each([
    ["a traversing namespace", "..", "b"],
    ["a traversing package", "a", "../b"],
    ["an empty package", "a", ""],
    ["a query in the package", "a", "b?x=1"],
    ["a fragment in the namespace", "a#", "b"],
    ["an escape in the package", "a", "b%2e"],
  ])("%s is not-found without a request", async (_label, ns, pkg) => {
    const fetchFn = routes({})
    expect(await fetchPackageRoot(fetchFn, ns, pkg, "", ALWAYS)).toEqual({ status: "not-found" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("a multi-segment package name is still fetched", async () => {
    const fetchFn = routes({ "/p/a/b/c/_root.json": OK });
    expect(await fetchPackageRoot(fetchFn, "a", "b/c", "", ALWAYS)).toEqual({ status: "ok", root: ROOT });
  });

  test("404 on both paths is not-found, not an error", async () => {
    const fetchFn = routes({ "/p/a/b/_root.json": NOT_FOUND, "/p/a/b.json": NOT_FOUND });
    expect(await fetchPackageRoot(fetchFn, "a", "b", "", ALWAYS)).toEqual({ status: "not-found" });
  });

  test("a non-404 failure throws with the status", async () => {
    const fetchFn = routes({ "/p/a/b/_root.json": { ok: false, status: 500 } });
    await expect(fetchPackageRoot(fetchFn, "a", "b", "", ALWAYS)).rejects.toThrow("HTTP 500");
  });

  test("a network error and a malformed body both throw", async () => {
    await expect(
      fetchPackageRoot((async () => Promise.reject(new Error("NetworkError"))) as FetchLike, "a", "b", "", ALWAYS),
    ).rejects.toThrow("NetworkError");
    const garbled = routes({
      "/p/a/b/_root.json": { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) },
    });
    await expect(fetchPackageRoot(garbled, "a", "b", "", ALWAYS)).rejects.toThrow("bad json");
  });

  test.each([
    ["null", null],
    ["a string", "oops"],
    ["an object without tags", { name: "x" }],
    ["tags that is null", { tags: null }],
    ["tags that is an array", { tags: [] }],
  ])("a body that is %s throws instead of reaching the island", async (_label, body) => {
    const fetchFn = routes({ "/p/a/b/_root.json": { ok: true, status: 200, json: async () => body } });
    await expect(fetchPackageRoot(fetchFn, "a", "b", "", ALWAYS)).rejects.toThrow("no tags");
  });

  describe("stale-response discard", () => {
    test("superseded while the alias is in flight: stale, and the fallback is never fetched", async () => {
      const gate = createRequestGate();
      const isCurrent = gate.begin();
      const fetchFn = vi.fn(async () => {
        gate.begin(); // a newer navigation fires while this request is out
        return NOT_FOUND;
      }) as unknown as FetchLike & ReturnType<typeof vi.fn>;

      expect(await fetchPackageRoot(fetchFn, "a", "b", "", isCurrent)).toEqual({ status: "stale" });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test("superseded while the fallback is in flight: stale, even though it answered 404", async () => {
      const gate = createRequestGate();
      const isCurrent = gate.begin();
      const fetchFn = vi.fn(async (url: string) => {
        if (url.endsWith(".json") && !url.endsWith("_root.json")) gate.begin();
        return NOT_FOUND;
      }) as unknown as FetchLike;

      expect(await fetchPackageRoot(fetchFn, "a", "b", "", isCurrent)).toEqual({ status: "stale" });
    });

    test("superseded while the body is parsing: stale, the parsed root is dropped", async () => {
      const gate = createRequestGate();
      const isCurrent = gate.begin();
      const fetchFn = routes({
        "/p/a/b/_root.json": {
          ok: true,
          status: 200,
          json: async () => {
            gate.begin();
            return ROOT;
          },
        },
      });

      expect(await fetchPackageRoot(fetchFn, "a", "b", "", isCurrent)).toEqual({ status: "stale" });
    });
  });
});
