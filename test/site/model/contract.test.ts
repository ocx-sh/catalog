/**
 * C-031 / C-047 — `siteModel` contract: pure, deterministic, one `DetailView`
 * per `PackageRoute`, landing a function of the default scope only, and no
 * README body / wire root / image index anywhere in the serialized model.

 */
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../../../src/config/types.js";
import { siteModel, routeKey } from "../../../src/site/model/index.js";
import type { PackageRoute } from "../../../src/viewmodel/route.js";
import type { Catalog, CatalogEntry } from "../../../src/viewmodel/types.js";

const README_BODY = "UNIQUE-README-BODY-MARKER";
const WIRE_ROOT = "UNIQUE-WIRE-ROOT-MARKER";

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
    readmeUrl: `/p/${namespace}/${rest.join("/")}/o/sha256/${"a".repeat(64)}.md`,
    ...overrides,
  };
}

function route(segments: string[], namespace: string, pkg: string, wireBase: string): PackageRoute {
  return { segments, namespace, package: pkg, wireBase };
}

const loaded: LoadedConfig = {
  config: { sources: [], brand: { title: "Mirror" }, base: "/catalog/" },
  configDir: "/cfg",
  sources: [],
};

function fixture(extra: CatalogEntry[] = [], extraRoutes: PackageRoute[] = []) {
  const catalog: Catalog = {
    generated: null,
    indexes: [
      { name: "a", root: true, default: true, excludeFromAll: false, count: 2 },
      { name: "b", root: false, default: false, excludeFromAll: false, count: 1 + extra.length },
    ],
    packages: [entry("a/acme/tool"), entry("a/acme/lib/core"), entry("b/acme/other"), ...extra],
  };
  const packages = [
    route(["acme", "tool"], "acme", "tool", ""),
    route(["acme", "lib", "core"], "acme", "lib/core", ""),
    route(["b", "acme", "other"], "acme", "other", "index/b"),
    ...extraRoutes,
  ];
  return { catalog, packages };
}

describe("siteModel contract (C-031, C-047)", () => {
  it("is deterministic: same input, byte-equal JSON", () => {
    const { catalog, packages } = fixture();
    expect(JSON.stringify(siteModel(catalog, packages, loaded))).toBe(
      JSON.stringify(siteModel(catalog, packages, loaded)),
    );
  });

  it("is pure: it does not mutate its input", () => {
    const { catalog, packages } = fixture();
    const before = JSON.stringify({ catalog, packages, loaded });
    siteModel(catalog, packages, loaded);
    expect(JSON.stringify({ catalog, packages, loaded })).toBe(before);
  });

  it("carries exactly one DetailView per PackageRoute, keyed by route key", () => {
    const { catalog, packages } = fixture();
    const model = siteModel(catalog, packages, loaded);
    expect(model.routes).toEqual(["acme/tool", "acme/lib/core", "b/acme/other"]);
    expect(Object.keys(model.details)).toEqual(model.routes);
    for (const route of packages) {
      const view = model.details[routeKey(route)];
      expect(view?.key).toBe(routeKey(route));
      expect(view?.namespace).toBe(route.namespace);
      expect(view?.package).toBe(route.package);
    }
  });

  it("carries no wire URL, only the base-joined logo (C-016) and the source mount prefix the browser fetches under (D-149)", () => {
    const logo = "/index/b/p/acme/other/o/sha256/" + "c".repeat(64) + ".svg";
    const { catalog, packages } = fixture();
    const withLogo: Catalog = {
      ...catalog,
      packages: catalog.packages.map((p) => (p.name === "b/acme/other" ? { ...p, logoUrl: logo } : p)),
    };
    const model = siteModel(withLogo, packages, loaded);
    expect(model.details["b/acme/other"]?.logoUrl).toBe(`/catalog${logo}`);
    expect(model.details["acme/tool"]?.logoUrl).toBeNull();
    const json = JSON.stringify(model.details);
    expect(json).not.toContain("rootUrl");
    // The mount prefix the browser builds its own `_root.json` and image-index URLs from (D-149), never a URL.
    expect(model.details["acme/tool"]?.wireBase).toBe("");
    expect(model.details["b/acme/other"]?.wireBase).toBe("index/b");
  });

  it("makes the landing view a function of the default scope only", () => {
    const base = fixture();
    const withMoreInOtherIndex = fixture([entry("b/acme/extra")], [route(["b", "acme", "extra"], "acme", "extra", "index/b")]);
    expect(siteModel(withMoreInOtherIndex.catalog, withMoreInOtherIndex.packages, loaded).landing.cards).toEqual(
      siteModel(base.catalog, base.packages, loaded).landing.cards,
    );
  });

  it("D-085 keeps each route's README CAS path in `readmeUrl`, for the provenance menu, once the build swaps `readme` for a file", () => {
    const { catalog, packages } = fixture(
      [entry("b/acme/hostile", { description: "plain", readmeUrl: null })],
      [route(["b", "acme", "hostile"], "acme", "hostile", "index/b")],
    );
    const model = siteModel(catalog, packages, loaded);

    expect(model.readmeUrl["acme/tool"]).toBe(catalog.packages[0]?.readmeUrl);
    expect(model.readmeUrl["b/acme/hostile"]).toBeNull();
  });

  it("holds each route's README CAS path, never a README body, wire root or image index (C-047)", () => {
    const { catalog, packages } = fixture(
      [entry("b/acme/hostile", { description: "plain", readmeUrl: null })],
      [route(["b", "acme", "hostile"], "acme", "hostile", "index/b")],
    );
    const model = siteModel(catalog, packages, loaded);
    expect(model.readme["acme/tool"]).toBe(catalog.packages[0]?.readmeUrl);
    expect(model.readme["b/acme/hostile"]).toBeNull();
    const json = JSON.stringify(model);
    expect(json).not.toContain(README_BODY);
    expect(json).not.toContain(WIRE_ROOT);
    expect(json).not.toContain("manifests");
  });

  it("joins every internal href onto base", () => {
    const { catalog, packages } = fixture();
    const model = siteModel(catalog, packages, loaded);
    expect(model.base).toBe("/catalog/");
    for (const card of model.landing.cards) {
      expect(card.href.startsWith("/catalog/")).toBe(true);
    }
  });
});

// These drive `siteModel` itself with no packages and assert only the `docs`
// field.
describe("siteModel contract: docs rows (C-020, C-031)", () => {
  const docs = [
    { slug: "reference/cli", id: "reference/cli", title: "CLI reference", order: 1 },
    { slug: "guide/install", id: "guide/install", title: "Installing", order: 2 },
    { slug: "guide/start", id: "guide/start", title: "Start", order: 1 },
  ];
  const { catalog } = fixture();

  it("is deterministic and pure: same input, byte-equal JSON, input untouched", () => {
    const before = JSON.stringify(docs);
    expect(JSON.stringify(siteModel(catalog, [], loaded, docs).docs)).toBe(
      JSON.stringify(siteModel(catalog, [], loaded, docs).docs),
    );
    expect(JSON.stringify(docs)).toBe(before);
  });

  it("builds the sidebar from the pre-scanned docs and joins every href onto base", () => {
    const view = siteModel(catalog, [], loaded, docs).docs;
    expect(view.pages.map((page) => page.slug)).toEqual(["guide/start", "guide/install", "reference/cli"]);
    expect(view.groups.flatMap((group) => group.pages.map((page) => page.href))).toEqual([
      "/catalog/docs/guide/start/",
      "/catalog/docs/guide/install/",
      "/catalog/docs/reference/cli/",
    ]);
  });

  it("has no sidebar when docs is unset", () => {
    expect(siteModel(catalog, [], loaded).docs).toEqual({ groups: [], pages: [] });
  });
});
