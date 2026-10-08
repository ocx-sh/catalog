import { describe, expect, test, vi } from "vitest";
import { CATALOG_URL, createCatalogLoader, EMPTY_CATALOG } from "../../../src/site/lib/catalogFetch.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";

const DATA = { generated: "2026-08-22T00:00:00Z", packages: [] };

/** A fetch double answering every call with the given response shape. */
function respond(resp: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  return vi.fn(async () => resp) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

describe("createCatalogLoader", () => {
  test("fetches the catalog URL and returns the parsed body", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn);

    expect(await loader.load()).toEqual(DATA);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(CATALOG_URL);
  });

  test("honours an injected URL", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    await createCatalogLoader(fetchFn, "/elsewhere/catalog.json").load();
    expect(fetchFn).toHaveBeenCalledWith("/elsewhere/catalog.json");
  });

  test("concurrent loads share one request", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn);

    const [a, b] = await Promise.all([loader.load(), loader.load()]);

    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("a successful load is cached: later loads never refetch, and peek() sees it", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn);
    expect(loader.peek()).toBeNull();

    await loader.load();
    await loader.load();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(loader.peek()).toEqual(DATA);
  });

  test("a 404 resolves the empty catalog and is not cached", async () => {
    const fetchFn = respond({ ok: false, status: 404 });
    const loader = createCatalogLoader(fetchFn);

    expect(await loader.load()).toBe(EMPTY_CATALOG);
    expect(loader.peek()).toBeNull();
    await loader.load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("any other non-ok status rejects with the status, and the next load retries", async () => {
    const fetchFn = respond({ ok: false, status: 503 });
    const loader = createCatalogLoader(fetchFn);

    await expect(loader.load()).rejects.toThrow("HTTP 503");
    await expect(loader.load()).rejects.toThrow("HTTP 503");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(loader.peek()).toBeNull();
  });

  test("a network error and a malformed body both reject", async () => {
    const down = createCatalogLoader((async () => {
      throw new Error("NetworkError");
    }) as FetchLike);
    await expect(down.load()).rejects.toThrow("NetworkError");

    const garbled = createCatalogLoader(
      respond({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) }),
    );
    await expect(garbled.load()).rejects.toThrow("bad json");
  });

  test("loaders keep separate caches", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    await createCatalogLoader(fetchFn).load();
    await createCatalogLoader(fetchFn).load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
