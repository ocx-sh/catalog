import { describe, expect, test, vi } from "vitest";
import { CATALOG_PATH, createCatalogLoader, EMPTY_CATALOG, sharedCatalogLoader } from "../../../src/site/lib/catalogFetch.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";

const DATA = { generated: "2026-08-22T00:00:00Z", packages: [] };

/** A fetch double answering every call with the given response shape. */
function respond(resp: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  return vi.fn(async () => resp) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

describe("createCatalogLoader", () => {
  test("fetches the catalog URL and returns the parsed body", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    expect(await loader.load()).toEqual(DATA);
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(CATALOG_PATH);
  });

  test("honours an injected URL", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    await createCatalogLoader(fetchFn, "/elsewhere/catalog.json").load();
    expect(fetchFn).toHaveBeenCalledWith("/elsewhere/catalog.json");
  });

  test("concurrent loads share one request", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    const [a, b] = await Promise.all([loader.load(), loader.load()]);

    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("a successful load is cached: later loads never refetch", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    const first = await loader.load();
    const second = await loader.load();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test("a 404 resolves the empty catalog and is not cached", async () => {
    const fetchFn = respond({ ok: false, status: 404 });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    expect(await loader.load()).toBe(EMPTY_CATALOG);
    await loader.load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("any other non-ok status rejects with the status, and the next load retries", async () => {
    const fetchFn = respond({ ok: false, status: 503 });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    await expect(loader.load()).rejects.toThrow("HTTP 503");
    await expect(loader.load()).rejects.toThrow("HTTP 503");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("a network error and a malformed body both reject", async () => {
    const down = createCatalogLoader((async () => {
      throw new Error("NetworkError");
    }) as FetchLike, CATALOG_PATH);
    await expect(down.load()).rejects.toThrow("NetworkError");

    const garbled = createCatalogLoader(
      respond({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) }),
      CATALOG_PATH,
    );
    await expect(garbled.load()).rejects.toThrow("bad json");
  });

  test.each([
    ["null", null],
    ["a string", "<html>oops</html>"],
    ["an array", []],
    ["an object without packages", { generated: null }],
    ["packages that is not an array", { generated: null, packages: { a: 1 } }],
  ])("a body that is %s rejects, is not cached, and the next load retries", async (_label, body) => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => body });
    const loader = createCatalogLoader(fetchFn, CATALOG_PATH);

    await expect(loader.load()).rejects.toThrow("not a catalog");
    await expect(loader.load()).rejects.toThrow("not a catalog");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("loaders keep separate caches", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    await createCatalogLoader(fetchFn, CATALOG_PATH).load();
    await createCatalogLoader(fetchFn, CATALOG_PATH).load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("sharedCatalogLoader", () => {
  test("the grid and the palette asking for one URL share one request and one array", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => ({ generated: null, packages: [] }) });

    const [grid, palette] = await Promise.all([
      sharedCatalogLoader("/catalog/data/catalog/catalog.json", fetchFn).load(),
      sharedCatalogLoader("/catalog/data/catalog/catalog.json", fetchFn).load(),
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(palette.packages).toBe(grid.packages);
  });

  test("asking creates nothing to fetch: no request until load() is called (C-011)", () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => DATA });
    sharedCatalogLoader("/untouched/catalog.json", fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("another URL, or another fetch function, gets its own loader", async () => {
    const fetchFn = respond({ ok: true, status: 200, json: async () => ({ generated: null, packages: [] }) });
    const other = respond({ ok: true, status: 200, json: async () => ({ generated: null, packages: [] }) });

    await sharedCatalogLoader("/a/catalog.json", fetchFn).load();
    await sharedCatalogLoader("/b/catalog.json", fetchFn).load();
    await sharedCatalogLoader("/a/catalog.json", other).load();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("without an injected fetch it uses the global fetch, read at call time", async () => {
    const globalFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => DATA }));
    vi.stubGlobal("fetch", globalFetch);
    try {
      await sharedCatalogLoader("/default/catalog.json").load();
      await sharedCatalogLoader("/default/catalog.json").load();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(globalFetch).toHaveBeenCalledExactlyOnceWith("/default/catalog.json");
  });
});
