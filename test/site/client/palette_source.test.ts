// @vitest-environment happy-dom
//
// The palette's catalog-specific part (C-011, C-009, D-174): the lazy source that ranks packages with
// `filterPackages` over `catalog.json` and, when a docs mount exists, docs pages over `docs-index.json`.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPaletteSource } from "../../../src/site/client/palette_source.js";
import type { DocsIndexEntry } from "../../../src/site/lib/docsIndexWire.js";
import type { CatalogData, FetchLike } from "../../../src/site/lib/wireTypes.js";

function pkg(name: string, title: string, keywords: string[] = []) {
  const [, namespace, ...rest] = name.split("/");
  return {
    namespace,
    package: rest.join("/"),
    name,
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title,
    description: `${title} description`,
    keywords,
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}

/** Same id published by two indexes: `ocx.sh` is the root (bare routes), `corp.example` is not. */
const AGGREGATED = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: true, default: true, count: 1 },
    { name: "corp.example", root: false, default: false, count: 1 },
  ],
  packages: [pkg("ocx.sh/tools/widget", "Widget"), pkg("corp.example/tools/widget", "Widget")],
} as unknown as CatalogData;

const DOCS: DocsIndexEntry[] = [
  { id: "index", href: "/catalog/docs/", title: "Overview", crumbs: [], headings: ["Welcome"], text: "The widget catalog explained." },
  {
    id: "run-books/widget install",
    href: "/catalog/docs/run-books/widget%20install/",
    title: "Installing the widget",
    crumbs: ["run books"],
    headings: ["Prerequisites", "Install steps"],
    text: "Run the installer and verify the checksum.",
  },
  { id: "guide/other", href: "/catalog/docs/guide/other/", title: "Other", crumbs: ["guide"], headings: [], text: "Nothing relevant." },
];

const answer = (payload: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

/** A fetch double that serves `catalog.json` and `docs-index.json` under whatever base. */
function serving(options: { catalog?: unknown; docs?: unknown; docsStatus?: number } = {}) {
  return vi.fn<FetchLike>(async (url) =>
    String(url).endsWith("docs-index.json")
      ? answer(options.docs ?? DOCS, options.docsStatus)
      : answer(options.catalog ?? AGGREGATED),
  );
}

const signal = new AbortController().signal;

beforeEach(() => document.body.replaceChildren());
afterEach(() => vi.resetModules());

describe.each([
  { base: "/", catalogUrl: "/data/catalog/catalog.json", widget: "/tools/widget/", corp: "/corp.example/tools/widget/" },
  {
    base: "/catalog/",
    catalogUrl: "/catalog/data/catalog/catalog.json",
    widget: "/catalog/tools/widget/",
    corp: "/catalog/corp.example/tools/widget/",
  },
])("base $base", ({ base, catalogUrl, widget, corp }) => {
  test("a query answers one Packages group: label, name as description, packageHref for non-root indexes", async () => {
    const fetch = serving();
    const source = createPaletteSource({ base, docs: false, fetch });

    const groups = await source.search("widget", signal);

    expect(fetch).toHaveBeenCalledWith(catalogUrl);
    expect(groups).toEqual([
      {
        label: "Packages",
        items: [
          { href: widget, label: "Widget", description: "ocx.sh/tools/widget" },
          { href: corp, label: "Widget", description: "corp.example/tools/widget" },
        ],
      },
    ]);
  });
});

describe("packages", () => {
  test("a blank query is an empty answer and fetches nothing", async () => {
    const fetch = serving();
    const source = createPaletteSource({ base: "/", docs: true, fetch });

    expect(await source.search("   ", signal)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("at most 8 rows", async () => {
    const many = { generated: null, packages: Array.from({ length: 12 }, (_, i) => pkg(`ocx.sh/t/tool${i}`, `Tool ${i}`)) };
    const source = createPaletteSource({ base: "/", docs: false, fetch: serving({ catalog: many }) });

    const [packages] = await source.search("tool", signal);

    expect(packages!.items).toHaveLength(8);
  });

  test("a failed catalog rejects (the theme shows its error line) and the next query retries", async () => {
    let calls = 0;
    const fetch = vi.fn<FetchLike>(async () => (++calls === 1 ? answer({}, 503) : answer(AGGREGATED)));
    const source = createPaletteSource({ base: "/", docs: false, fetch });

    await expect(source.search("widget", signal)).rejects.toThrow("HTTP 503");
    const [packages] = await source.search("widget", signal);

    expect(packages!.items).toHaveLength(2);
  });

  test("warm fetches the catalog ahead of the first query, which then costs no second request", async () => {
    const fetch = serving();
    const source = createPaletteSource({ base: "/", docs: false, fetch });

    await source.warm();
    await source.search("widget", signal);

    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("docs", () => {
  test("D-174 a docs mount adds a Docs group after Packages, with the section path as breadcrumbs", async () => {
    const source = createPaletteSource({ base: "/catalog/", docs: true, fetch: serving() });

    const groups = await source.search("widget", signal);

    expect(groups.map((group) => group.label)).toEqual(["Packages", "Docs"]);
    expect(groups[1]!.items).toEqual(
      expect.arrayContaining([
        {
          href: "/catalog/docs/run-books/widget%20install/",
          label: "Installing the widget",
          description: "run books",
        },
        { href: "/catalog/docs/", label: "Overview" },
      ]),
    );
  });

  test("D-174 docs match on headings and the text excerpt, not only the title", async () => {
    const source = createPaletteSource({ base: "/", docs: true, fetch: serving() });

    const byHeading = await source.search("prerequisites", signal);
    const byText = await source.search("checksum", signal);

    expect(byHeading[1]!.items.map((item) => item.label)).toEqual(["Installing the widget"]);
    expect(byText[1]!.items.map((item) => item.label)).toEqual(["Installing the widget"]);
  });

  test("a malformed docs entry drops the Docs group only, never the Packages group beside it", async () => {
    const source = createPaletteSource({ base: "/", docs: true, fetch: serving({ docs: [null] }) });

    const groups = await source.search("widget", signal);

    expect(groups.map((group) => group.label)).toEqual(["Packages", "Docs"]);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toEqual([]);
  });

  test("D-174 without a docs mount no docs-index.json is requested and no Docs group is answered", async () => {
    const fetch = serving();
    const source = createPaletteSource({ base: "/", docs: false, fetch });

    const groups = await source.search("widget", signal);
    await source.warm();

    expect(groups.map((group) => group.label)).toEqual(["Packages"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/data/catalog/catalog.json"]);
  });

  test("D-174 the docs index loads once and is shared by every query", async () => {
    const fetch = serving();
    const source = createPaletteSource({ base: "/", docs: true, fetch });

    await source.warm();
    await source.search("widget", signal);
    await source.search("install", signal);

    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("docs-index.json"))).toHaveLength(1);
  });

  test.each([
    ["an HTTP failure", { docsStatus: 404 }],
    ["a payload that is not an index", { docs: { not: "an array" } }],
  ])("D-174 %s drops only the Docs group; packages still answer, and the next query retries", async (_name, options) => {
    const fetch = serving(options);
    const source = createPaletteSource({ base: "/", docs: true, fetch });

    const [packages, docs] = await source.search("widget", signal);
    await source.search("widget", signal);

    expect(packages!.items).toHaveLength(2);
    expect(docs).toEqual({ label: "Docs", items: [] });
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("docs-index.json"))).toHaveLength(2);
  });
});

describe("the module the theme imports", () => {
  async function fresh(wrapper: string) {
    document.body.innerHTML = wrapper;
    vi.resetModules();
    return import("../../../src/site/client/palette_source.js");
  }

  test("search and warm read data-base and data-docs from the .ocx-palette wrapper", async () => {
    const fetch = serving();
    vi.stubGlobal("fetch", fetch);
    const { search, warm } = await fresh(`<div class="ocx-palette" data-base="/catalog/" data-docs=""></div>`);

    await warm();
    const groups = await search("widget", signal);
    await search("install", signal);

    expect(groups.map((group) => group.label)).toEqual(["Packages", "Docs"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/catalog/data/catalog/catalog.json",
      "/catalog/data/catalog/docs-index.json",
    ]);
    vi.unstubAllGlobals();
  });

  test("a wrapper without data-docs searches packages only", async () => {
    vi.stubGlobal("fetch", serving());
    const { search } = await fresh(`<div class="ocx-palette" data-base="/"></div>`);

    const groups = await search("widget", signal);

    expect(groups.map((group) => group.label)).toEqual(["Packages"]);
    vi.unstubAllGlobals();
  });

  test("a page without the wrapper's data-base is an error", async () => {
    const { search } = await fresh(`<div class="ocx-palette"></div>`);

    expect(() => search("widget", signal)).toThrow("palette: no data-base on .ocx-palette");
  });
});
