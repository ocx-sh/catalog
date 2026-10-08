/**
 * C-010 / C-031 / S-003 — the landing view: `min(24, n)` default-scope cards in
 * name order, toolbar counts and scope tabs in their final state, `base`-joined
 * links, catalog-root-relative logos, deterministic JSON.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCatalog } from "../../../src/build/sources_pipeline.js";
import { loadConfig } from "../../../src/config/load.js";
import { landingView } from "../../../src/site/model/landing.js";
import type { Catalog, CatalogEntry, CatalogIndexInfo } from "../../../src/viewmodel/types.js";

const SITE_DIR = fileURLToPath(new URL("../../fixtures/site/", import.meta.url));

function entry(name: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const [, namespace = "", ...rest] = name.split("/");
  return {
    namespace,
    package: rest.join("/"),
    name,
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title: name,
    description: `${name} description`,
    keywords: [],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
    ...overrides,
  };
}

function index(name: string, overrides: Partial<CatalogIndexInfo> = {}): CatalogIndexInfo {
  return { name, root: false, default: false, excludeFromAll: false, count: 0, ...overrides };
}

/** `n` root-index packages, names zero-padded so name order is numeric order. */
function numbered(n: number): Catalog {
  return {
    generated: null,
    indexes: [index("a", { root: true, default: true, count: n })],
    packages: Array.from({ length: n }, (_, i) => entry(`a/acme/p${String(i).padStart(2, "0")}`)),
  };
}

describe("landingView card window (C-010)", () => {
  it("n=3: every package becomes a card", () => {
    const view = landingView(numbered(3), "/");
    expect(view.total).toBe(3);
    expect(view.cards.map((card) => card.name)).toEqual(["a/acme/p00", "a/acme/p01", "a/acme/p02"]);
  });

  it("n=24: exactly 24 cards", () => {
    const view = landingView(numbered(24), "/");
    expect(view.total).toBe(24);
    expect(view.cards).toHaveLength(24);
  });

  it("n=30: the first 24 in name order, total still 30", () => {
    const view = landingView(numbered(30), "/");
    expect(view.total).toBe(30);
    expect(view.cards).toHaveLength(24);
    expect(view.cards[0]?.name).toBe("a/acme/p00");
    expect(view.cards[23]?.name).toBe("a/acme/p23");
  });

  it("empty catalog: no cards, no tabs, scope all", () => {
    expect(landingView({ generated: null, packages: [] }, "/")).toEqual({
      scope: null,
      total: 0,
      scopes: [],
      cards: [],
    });
  });

  it("keeps the catalog's name order", () => {
    const catalog: Catalog = {
      generated: null,
      indexes: [index("a", { root: true, default: true })],
      packages: [entry("a/acme/alpha"), entry("a/acme/beta"), entry("a/acme/gamma")],
    };
    expect(landingView(catalog, "/").cards.map((card) => card.name)).toEqual(["a/acme/alpha", "a/acme/beta", "a/acme/gamma"]);
  });
});

describe("landingView cards", () => {
  it("copies the display fields, joins href onto base, keeps logoUrl catalog-root-relative", () => {
    const catalog: Catalog = {
      generated: null,
      indexes: [index("a", { root: true, default: true }), index("b")],
      packages: [
        entry("a/acme/tool", {
          title: "Tool",
          description: "A tool",
          status: "deprecated",
          latestVersion: null,
          platforms: ["linux/amd64", "darwin/arm64"],
          keywords: ["cli", "rare", "common", "extra"],
          tagCount: 7,
          logoUrl: "/p/acme/tool/o/sha256/logo.png",
        }),
        entry("a/acme/second", { keywords: ["common", "cli"] }),
        entry("a/acme/third", { keywords: ["common"] }),
        entry("b/acme/other"),
      ],
    };
    const [card] = landingView(catalog, "/catalog/").cards;
    expect(card).toEqual({
      key: "acme/tool",
      href: "/catalog/acme/tool/",
      name: "a/acme/tool",
      title: "Tool",
      description: "A tool",
      status: "deprecated",
      latestVersion: null,
      platforms: ["linux/amd64", "darwin/arm64"],
      // "common" (3 packages) and "cli" (2) outrank the singletons; ties are alphabetical.
      keywords: ["common", "cli", "extra"],
      tagCount: 7,
      logoUrl: "/p/acme/tool/o/sha256/logo.png",
    });
    expect(card?.logoUrl).not.toContain("/catalog/");
  });

  it("qualifies a non-root index's link and key", () => {
    const catalog: Catalog = {
      generated: null,
      indexes: [index("a", { root: true }), index("b", { default: true })],
      packages: [entry("a/acme/tool"), entry("b/acme/other")],
    };
    const [card] = landingView(catalog, "/").cards;
    expect(card?.key).toBe("b/acme/other");
    expect(card?.href).toBe("/b/acme/other/");
  });

  it("a catalog without an index envelope links bare routes", () => {
    const [card] = landingView({ generated: null, packages: [entry("a/acme/tool")] }, "/").cards;
    expect(card?.href).toBe("/acme/tool/");
  });
});

describe("landingView scope (S-003)", () => {
  const twoIndexes = (a: Partial<CatalogIndexInfo>, b: Partial<CatalogIndexInfo>): Catalog => ({
    generated: null,
    indexes: [index("a", { root: true, ...a }), index("b", b)],
    packages: [entry("a/acme/one"), entry("a/acme/two"), entry("b/acme/three")],
  });

  it("opens on the default index and counts every tab", () => {
    const view = landingView(twoIndexes({}, { default: true }), "/");
    expect(view.scope).toBe("b");
    expect(view.total).toBe(1);
    expect(view.cards.map((card) => card.name)).toEqual(["b/acme/three"]);
    expect(view.scopes).toEqual([
      { index: null, count: 3, default: false, active: false },
      { index: "a", count: 2, default: false, active: false },
      { index: "b", count: 1, default: true, active: true },
    ]);
  });

  it("opens on all when no index is the default", () => {
    const view = landingView(twoIndexes({}, {}), "/");
    expect(view.scope).toBeNull();
    expect(view.total).toBe(3);
    expect(view.cards).toHaveLength(3);
    expect(view.scopes.map((tab) => tab.active)).toEqual([true, false, false]);
  });

  it("excludeFromAll narrows the all scope and the all tab, not the index's own tab", () => {
    const view = landingView(twoIndexes({}, { excludeFromAll: true }), "/");
    expect(view.scope).toBeNull();
    expect(view.total).toBe(2);
    expect(view.cards.map((card) => card.name)).toEqual(["a/acme/one", "a/acme/two"]);
    expect(view.scopes.map((tab) => tab.count)).toEqual([2, 2, 1]);
  });

  it("a default index that is excludeFromAll still opens on its own packages", () => {
    const view = landingView(twoIndexes({}, { default: true, excludeFromAll: true }), "/");
    expect(view.cards.map((card) => card.name)).toEqual(["b/acme/three"]);
    expect(view.scopes[0]?.count).toBe(2);
  });

  it("a single index has no scope to choose: no tabs, scope all, nothing excluded", () => {
    const catalog: Catalog = {
      generated: null,
      indexes: [index("a", { root: true, default: true, excludeFromAll: true })],
      packages: [entry("a/acme/one")],
    };
    const view = landingView(catalog, "/");
    expect(view.scope).toBeNull();
    expect(view.scopes).toEqual([]);
    expect(view.cards.map((card) => card.name)).toEqual(["a/acme/one"]);
  });
});

describe("landingView determinism (C-031)", () => {
  it("same input, byte-equal JSON; input untouched", () => {
    const catalog = numbered(30);
    const before = JSON.stringify(catalog);
    expect(JSON.stringify(landingView(catalog, "/catalog/"))).toBe(JSON.stringify(landingView(catalog, "/catalog/")));
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("is a function of the default scope: packages of another index change nothing", () => {
    const base = numbered(3);
    const more: Catalog = {
      generated: null,
      indexes: [...(base.indexes ?? []), index("b")],
      packages: [...base.packages, entry("b/acme/extra")],
    };
    expect(landingView(more, "/").cards).toEqual(landingView(base, "/").cards);
  });
});

describe("landingView over the site fixture", () => {
  it("catalog config: opens on the default excludeFromAll index with every card a base link", async () => {
    const loaded = await loadConfig(join(SITE_DIR, "catalog.config.json"));
    const resolved = await resolveCatalog(loaded.sources, loaded.configDir);
    const catalog = JSON.parse(resolved.catalogJson) as Catalog;
    const view = landingView(catalog, loaded.config.base ?? "/");
    expect(view.scope).toBe("index-b");
    expect(view.total).toBe(catalog.packages.filter((p) => p.name.startsWith("index-b/")).length);
    expect(view.cards.length).toBe(Math.min(24, view.total));
    for (const card of view.cards) {
      expect(card.href.startsWith("/catalog/index-b/")).toBe(true);
      if (card.logoUrl !== null) {
        expect(card.logoUrl).toMatch(/^\/(?!\/)/);
        expect(card.logoUrl.startsWith("/catalog/")).toBe(false);
      }
    }
    expect(view.scopes[0]).toMatchObject({ index: null, active: false });
  });
});
