import { describe, expect, test } from "vitest";
import {
  ALL_INDEXES,
  excludedIndexNames,
  hasIndexScope,
  parseCatalogUrlState,
  resolveIndexScope,
  serializeCatalogUrlState,
  sortPackages,
} from "../../../src/site/lib/catalogState.js";
import type { CatalogIndexInfo, CatalogPackage } from "../../../src/site/lib/wireTypes.js";

const idx = (name: string, extra: Partial<CatalogIndexInfo> = {}): CatalogIndexInfo => ({
  name,
  root: false,
  default: false,
  count: 1,
  ...extra,
});

describe("parseCatalogUrlState", () => {
  test("an empty search is all-absent", () => {
    expect(parseCatalogUrlState("")).toEqual({ q: "", index: null, sort: null, view: null, keywords: [] });
  });

  test("reads every param, with or without the leading ?", () => {
    const expected = { q: "cmake tools", index: "acme", sort: "updated", view: "table", keywords: ["build", "c++"] };
    expect(parseCatalogUrlState("?index=acme&q=cmake+tools&sort=updated&view=table&keyword=build&keyword=c%2B%2B")).toEqual(expected);
    expect(parseCatalogUrlState("index=acme&q=cmake+tools&sort=updated&view=table&keyword=build&keyword=c%2B%2B")).toEqual(expected);
  });

  test("an empty index value is 'all', distinct from an absent one", () => {
    expect(parseCatalogUrlState("?index=").index).toBe(ALL_INDEXES);
    expect(parseCatalogUrlState("?q=x").index).toBeNull();
  });

  test("an unknown sort or view reads as absent, never as a made-up mode", () => {
    const state = parseCatalogUrlState("?sort=popularity&view=gallery");
    expect([state.sort, state.view]).toEqual([null, null]);
  });

  test("empty keyword params are dropped", () => {
    expect(parseCatalogUrlState("?keyword=&keyword=cli").keywords).toEqual(["cli"]);
  });
});

describe("serializeCatalogUrlState", () => {
  test("an empty state writes nothing", () => {
    expect(serializeCatalogUrlState({})).toBe("");
    expect(serializeCatalogUrlState({ q: "", index: null, sort: null, view: null, keywords: [] })).toBe("");
  });

  test("writes in a fixed order: index, q, sort, view, keyword", () => {
    expect(
      serializeCatalogUrlState({ keywords: ["a", "b"], view: "cards", sort: "name", q: "x", index: "acme" }),
    ).toBe("index=acme&q=x&sort=name&view=cards&keyword=a&keyword=b");
  });

  test("'all' is written as an empty index value, not omitted", () => {
    expect(serializeCatalogUrlState({ index: ALL_INDEXES })).toBe("index=");
    expect(serializeCatalogUrlState({ index: ALL_INDEXES, q: "x" })).toBe("index=&q=x");
  });

  test("escapes values that would otherwise corrupt the query string", () => {
    expect(serializeCatalogUrlState({ q: "a&b=c d" })).toBe("q=a%26b%3Dc+d");
  });

  test("round-trips through parse", () => {
    const state = { q: "c++ & more", index: "acme", sort: "created", view: "table", keywords: ["x y", "z"] } as const;
    expect(parseCatalogUrlState(serializeCatalogUrlState(state))).toEqual(state);
    const all = { q: "", index: ALL_INDEXES, sort: null, view: null, keywords: [] };
    expect(parseCatalogUrlState(serializeCatalogUrlState(all))).toEqual(all);
  });
});

describe("hasIndexScope", () => {
  test("needs more than one index to have a scope to choose", () => {
    expect(hasIndexScope(undefined)).toBe(false);
    expect(hasIndexScope([])).toBe(false);
    expect(hasIndexScope([idx("ocx.sh")])).toBe(false);
    expect(hasIndexScope([idx("ocx.sh"), idx("acme")])).toBe(true);
  });
});

describe("excludedIndexNames", () => {
  test("names the excludeFromAll indexes of an aggregating catalog", () => {
    expect(excludedIndexNames([idx("ocx.sh"), idx("acme", { excludeFromAll: true })])).toEqual(["acme"]);
  });

  test("a single-index catalog excludes nothing, even if the flag is set", () => {
    expect(excludedIndexNames([idx("acme", { excludeFromAll: true })])).toEqual([]);
  });

  test("no envelope, nothing excluded", () => {
    expect(excludedIndexNames(undefined)).toEqual([]);
  });
});

describe("resolveIndexScope", () => {
  const list = [idx("ocx.sh", { root: true, default: true }), idx("acme")];

  test("an empty value is 'all', whatever is marked default", () => {
    expect(resolveIndexScope(ALL_INDEXES, list)).toBeNull();
  });

  test("a known name selects that index", () => {
    expect(resolveIndexScope("acme", list)).toBe("acme");
  });

  test("an absent param settles on the default index", () => {
    expect(resolveIndexScope(null, list)).toBe("ocx.sh");
  });

  test("an unknown name is ignored in favour of the default, not an empty grid", () => {
    expect(resolveIndexScope("nope", list)).toBe("ocx.sh");
  });

  test("with no default index the fallback is 'all'", () => {
    expect(resolveIndexScope(null, [idx("a"), idx("b")])).toBeNull();
    expect(resolveIndexScope("nope", [idx("a"), idx("b")])).toBeNull();
  });
});

describe("sortPackages", () => {
  const pkg = (name: string, updated: string | null, created: string) =>
    ({ name, updated, created }) as CatalogPackage;
  const a = pkg("a", "2026-03-01", "2026-01-01");
  const b = pkg("b", null, "2026-03-01");
  const c = pkg("c", "2026-02-01", "2026-02-01");
  const list = [a, b, c];

  test("name keeps the catalog's own order, uncopied", () => {
    expect(sortPackages(list, "name", false)).toBe(list);
  });

  test("updated is newest-first with tagless packages last", () => {
    expect(sortPackages(list, "updated", false).map((p) => p.name)).toEqual(["a", "c", "b"]);
  });

  test("created is newest-first", () => {
    expect(sortPackages(list, "created", false).map((p) => p.name)).toEqual(["b", "c", "a"]);
  });

  test("inverted reverses whichever order applies", () => {
    expect(sortPackages(list, "name", true).map((p) => p.name)).toEqual(["c", "b", "a"]);
    expect(sortPackages(list, "updated", true).map((p) => p.name)).toEqual(["b", "c", "a"]);
  });

  test("never mutates the input", () => {
    sortPackages(list, "created", true);
    expect(list.map((p) => p.name)).toEqual(["a", "b", "c"]);
  });
});
