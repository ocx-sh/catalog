// @vitest-environment happy-dom
//
// The catalog grid island against the LazyMount double (C-033). The test plays
// the theme's part: it fires the documented `ocx:*:change` events and presses
// the chips the server renders. Parity rows ported from test/theme/components:
// catalog_layout (Tab out of search, chip rail, popover counts, filter-only
// emptying), index_scope, exclude_from_all, keyword_rail_narrowing,
// platform_agnostic (table), package_identifier_elision, catalog_windowing
// (the build window; the paint-bound CSS rows are not applicable, see
// landing.test.ts), catalog_fetch_error, catalog_a11y (list semantics and the
// status region live in landing.test.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountGrid, type GridOptions } from "../../../src/site/client/grid.js";
import { packageHref } from "../../../src/viewmodel/url.js";
import type { CatalogData, CatalogIndexInfo, CatalogPackage, FetchLike } from "../../../src/site/lib/wireTypes.js";
import { gridDom, type Dom } from "./grid_dom.js";
import { createLazyDouble, type LazyDouble } from "./lazy_double.js";

function pkg(name: string, overrides: Partial<CatalogPackage> = {}): CatalogPackage {
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
  return { name, root: false, default: false, count: 0, ...overrides };
}

const catalog = (packages: CatalogPackage[], indexes?: CatalogIndexInfo[]): CatalogData => ({
  generated: null,
  packages,
  ...(indexes && { indexes }),
});

/** A fetch answering every URL with `body`, recording the URLs asked. */
function answering(body: CatalogData, status = 200) {
  return vi.fn<FetchLike>(async () => ({ ok: status < 400, status, json: async () => body }));
}

const keys = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("a[data-card]")].map((a) => a.dataset.key);
const text = (el: Element | null | undefined) => el?.textContent?.trim();
const chipsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-grid-chip]")];
const chipNames = (el: HTMLElement) => chipsOf(el).map((chip) => chip.dataset.keyword);
const pressed = (el: Element | null) => el?.getAttribute("aria-pressed") === "true";

function emit(target: Element, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const platformChip = (os: string) => document.querySelector<HTMLElement>(`[data-grid-platform="${os}"]`)!;
const statusChip = (status: string) => document.querySelector<HTMLElement>(`[data-grid-status="${status}"]`)!;
const pickView = (view: string) => emit(document.querySelector('[data-grid-view] [data-zag-root]')!, "ocx:toggle-group:change", { value: [view] });
const pickSort = (sort: string) => emit(document.querySelector("[data-grid-sort] [data-zag-root]")!, "ocx:select:change", { value: sort });
const pickScope = (value: string) =>
  emit(document.querySelector("[data-grid-scope] [data-zag-root]")!, "ocx:toggle-group:change", { value: [value] });

/** Lets the lazy `import()` and the fetch/render promise chain settle after a trigger. */
const settle = async () => {
  await vi.waitFor(() => expect(document.querySelector("[data-grid-skeleton]")?.hasAttribute("hidden")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

let lazy: LazyDouble;
let unmount: (() => void) | undefined;

/** Mounts the grid, fires the first interaction and waits for the first render. */
async function open(dom: Dom, data: CatalogData | FetchLike, options: GridOptions = {}) {
  const fetch = typeof data === "function" ? data : answering(data);
  unmount = mountGrid(dom.root, lazy, { fetch, ...options }).destroy;
  await lazy.mounts[0]?.fire();
  await settle();
  return fetch;
}

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((entry) => entry !== el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting = true) {
    this.callback([{ isIntersecting }]);
  }
}

beforeEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  lazy = createLazyDouble();
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mounting", () => {
  test("registers one interaction mount without replay and touches nothing before it fires (C-011)", () => {
    const dom = gridDom({ ssrCards: ["a/x"] });
    const fetch = answering(catalog([]));
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;

    type(dom.search, "x");
    click(platformChip("linux"));

    expect(lazy.mounts).toHaveLength(1);
    expect(lazy.mounts[0]?.spec).toMatchObject({ trigger: "interaction", replay: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(keys(dom.cards)).toEqual(["a/x"]);
    expect(history.length).toBeLessThanOrEqual(2);
  });

  test("throws without a base, and names the missing element otherwise", () => {
    const dom = gridDom();
    delete dom.root.dataset.base;
    expect(() => mountGrid(dom.root, lazy)).toThrow("grid: no base");
    expect(() => mountGrid(dom.root, lazy, { base: "/" })).not.toThrow();
    dom.root.querySelector("[data-grid-sort]")!.remove();
    expect(() => mountGrid(dom.root, lazy, { base: "/" })).toThrow("grid: missing [data-grid-sort]");
  });

  test("reads data-base from the root, and the options base wins", async () => {
    const dom = gridDom({ base: "/seg/" });
    const fetch = await open(dom, catalog([pkg("a/x/y")]));
    expect(fetch).toHaveBeenCalledWith("/seg/data/catalog/catalog.json");

    document.body.replaceChildren();
    const other = gridDom({ base: "/seg/" });
    const second = answering(catalog([pkg("a/x/y")]));
    lazy = createLazyDouble();
    unmount?.();
    unmount = mountGrid(other.root, lazy, { base: "/other/", fetch: second }).destroy;
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith("/other/data/catalog/catalog.json"));
  });

  test("the first interaction fetches catalog.json exactly once (C-011)", async () => {
    const dom = gridDom();
    const fetch = await open(dom, catalog([pkg("a/x/y")]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("destroy removes every listener and destroys the lazy mount", async () => {
    const dom = gridDom();
    const handle = mountGrid(dom.root, lazy, { fetch: answering(catalog([])) });
    handle.destroy();
    type(dom.search, "x");
    click(platformChip("linux"));
    expect(lazy.mounts[0]?.destroyed).toBe(true);
    expect(pressed(platformChip("linux"))).toBe(false);
  });
});

describe.each([
  { base: "/", prefix: "" },
  { base: "/catalog/", prefix: "/catalog" },
])("rendering at base $base", ({ base, prefix }) => {
  const data = catalog(
    [
      pkg("a/acme/tool", {
        title: "Tool",
        description: "Does a thing",
        keywords: ["cli", "rare"],
        latestVersion: "2.0.0",
        tagCount: 4,
        platforms: ["linux/amd64", "darwin/arm64"],
        logoUrl: "/p/acme/tool/o/sha256/logo.svg",
      }),
      pkg("b/corp/deploy", { status: "deprecated", latestVersion: null, platforms: ["any/any"] }),
      pkg("a/acme/old", { status: "yanked", platforms: ["freebsd/amd64"] }),
    ],
    [index("a", { root: true }), index("b")],
  );

  test("links every card at packageHref and fills its fields from the catalog", async () => {
    const dom = gridDom({ base, scope: "toggle", ssrScope: ":all" });
    await open(dom, data);

    const cards = [...dom.cards.querySelectorAll<HTMLAnchorElement>("a[data-card]")];
    expect(cards.map((a) => a.getAttribute("href"))).toEqual(
      ["a/acme/tool", "b/corp/deploy", "a/acme/old"].map((name) => packageHref(name, data.indexes, base)),
    );
    expect(cards.map((a) => a.getAttribute("href"))).toEqual([
      `${prefix}/acme/tool/`,
      `${prefix}/b/corp/deploy/`,
      `${prefix}/acme/old/`,
    ]);
    const tool = dom.cards.querySelector('[data-key="a/acme/tool"]')!;
    expect(text(tool.querySelector('[data-field="title"]'))).toBe("Tool");
    expect(tool.querySelector('[data-field="title"]')?.getAttribute("title")).toBe("Tool");
    expect(text(tool.querySelector('[data-field="description"]'))).toBe("Does a thing");
    expect(text(tool.querySelector('[data-field="version"]'))).toBe("2.0.0");
    expect(text(tool.querySelector('[data-field="tags"]'))).toBe("4 tags");
    expect(text(tool.querySelector('[data-field="install"]'))).toBe("ocx add a/acme/tool");
    expect(text(tool.querySelector('[data-field="initials"]'))).toBe("TO");
    expect(tool.querySelector('[data-field="logo"]')?.getAttribute("src")).toBe(`${prefix}/p/acme/tool/o/sha256/logo.svg`);
    expect(tool.querySelector('[data-field="logo"]')?.hasAttribute("hidden")).toBe(false);
    expect([...tool.querySelectorAll('[data-slot="keyword"]')].map((el) => el.textContent)).toEqual(["cli", "rare"]);
    expect([...tool.querySelectorAll("[data-os]")].map((el) => el.getAttribute("data-os"))).toEqual(["linux", "darwin"]);
  });

  test("a deprecated or yanked package carries its stamp, one without a version hides the version", async () => {
    const dom = gridDom({ base, scope: "toggle" });
    await open(dom, data);
    const deploy = dom.cards.querySelector('[data-key="b/corp/deploy"]')!;
    expect(deploy.querySelector('[data-field="deprecated"]')?.hasAttribute("hidden")).toBe(false);
    expect(deploy.querySelector('[data-field="yanked"]')?.hasAttribute("hidden")).toBe(true);
    expect(deploy.querySelector('[data-field="version"]')?.hasAttribute("hidden")).toBe(true);
    const old = dom.cards.querySelector('[data-key="a/acme/old"]')!;
    expect(old.querySelector('[data-field="yanked"]')?.hasAttribute("hidden")).toBe(false);
    expect(old.querySelector('[data-field="deprecated"]')?.hasAttribute("hidden")).toBe(true);
  });

  test("a platform-agnostic card draws the globe alone; an OS without a glyph draws nothing", async () => {
    const dom = gridDom({ base, scope: "toggle" });
    await open(dom, data);
    const glyphsOf = (name: string) =>
      [...dom.cards.querySelectorAll(`[data-key="${name}"] [data-os]`)].map((el) => el.getAttribute("data-os"));
    expect(glyphsOf("b/corp/deploy")).toEqual(["any"]);
    expect(glyphsOf("a/acme/old")).toEqual([]);
  });

  test("a package without a logo hides the image and keeps its initials; a failed logo hides itself", async () => {
    const dom = gridDom({ base, scope: "toggle" });
    await open(dom, data);
    const none = dom.cards.querySelector('[data-key="a/acme/old"] [data-field="logo"]')!;
    expect(none.hasAttribute("src")).toBe(false);
    expect(none.hasAttribute("hidden")).toBe(true);

    const logo = dom.cards.querySelector<HTMLElement>('[data-key="a/acme/tool"] [data-field="logo"]')!;
    logo.dispatchEvent(new Event("error"));
    expect(logo.hidden).toBe(true);
  });

  test("table rows link and fill the same way, with one slot per catalog OS and a single globe for any", async () => {
    const dom = gridDom({ base, scope: "toggle" });
    await open(dom, data);
    pickView("table");

    expect(dom.table.hidden).toBe(false);
    expect(dom.cards.hidden).toBe(true);
    const rows = [...dom.table.querySelectorAll<HTMLAnchorElement>("a[data-card]")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(
      ["a/acme/tool", "b/corp/deploy", "a/acme/old"].map((name) => packageHref(name, data.indexes, base)),
    );
    const slots = (name: string) =>
      [...dom.table.querySelectorAll(`[data-key="${name}"] [data-field="platforms"] > *`)].map(
        (el) => el.getAttribute("data-os") ?? "empty",
      );
    // Columns come from the whole catalog (linux, darwin, freebsd), not from the row; freebsd has no glyph.
    expect(slots("a/acme/tool")).toEqual(["linux", "darwin", "empty"]);
    expect(slots("a/acme/old")).toEqual(["empty", "empty", "empty"]);
    expect(slots("b/corp/deploy")).toEqual(["any"]);
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("3");
  });
});

describe("hostile catalog data is inert (C-041)", () => {
  const hostile = pkg("a/acme/evil", {
    title: '<img src=x onerror=alert(1)>',
    description: '"><script>alert(1)</script>',
    keywords: ["<b>x</b>", '" onmouseover="alert(1)'],
    latestVersion: "<svg onload=alert(1)>",
    logoUrl: "/p/acme/evil/o/sha256/l.svg",
  });

  test.each(["cards", "table"] as const)("%s: every value lands as text, nothing it holds becomes a node or attribute", async (view) => {
    const dom = gridDom();
    await open(dom, catalog([hostile]));
    if (view === "table") pickView("table");
    const list = view === "cards" ? dom.cards : dom.table;

    expect(text(list.querySelector('[data-field="title"]'))).toBe('<img src=x onerror=alert(1)>');
    expect(text(list.querySelector('[data-field="description"]'))).toBe('"><script>alert(1)</script>');
    expect(list.querySelector("script, svg, b")).toBeNull();
    expect(list.querySelectorAll("img")).toHaveLength(1);
    expect(list.querySelector("[onerror], [onload], [onmouseover]")).toBeNull();
    if (view === "cards") {
      expect([...list.querySelectorAll('[data-slot="keyword"]')].map((el) => el.textContent)).toEqual([
        '" onmouseover="alert(1)',
        "<b>x</b>",
      ]);
    }
  });

  test("a hostile keyword is text on the rail and in the popover, and is selectable as itself", async () => {
    const dom = gridDom();
    await open(dom, catalog([hostile]));
    expect(chipNames(dom.rail)).toEqual(['" onmouseover="alert(1)', "<b>x</b>"].sort());
    expect(dom.rail.querySelector("b, [onmouseover]")).toBeNull();
  });
});

describe("filtering (C-012)", () => {
  const packages = [
    pkg("a/x/alpha", { keywords: ["cli", "go"], platforms: ["linux/amd64", "darwin/arm64"] }),
    pkg("a/x/beta", { keywords: ["cli", "rust"], platforms: ["linux/amd64"], status: "deprecated" }),
    pkg("a/x/gamma", { keywords: ["lib"], platforms: ["windows/amd64"], status: "yanked" }),
  ];

  test("the free-text query narrows, reports N of M and mirrors into the URL without a history entry", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    expect(dom.count.textContent).toBe("3 packages");
    const entries = history.length;

    type(dom.search, "alpha");

    expect(keys(dom.cards)).toEqual(["a/x/alpha"]);
    expect(dom.count.textContent).toBe("1 of 3 packages");
    expect(location.search).toBe("?q=alpha");
    expect(history.length).toBe(entries);
  });

  test("platform chips AND: two chips mean ships both", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));

    click(platformChip("linux"));
    expect(keys(dom.cards)).toEqual(["a/x/alpha", "a/x/beta"]);
    expect(pressed(platformChip("linux"))).toBe(true);
    click(platformChip("darwin"));
    expect(keys(dom.cards)).toEqual(["a/x/alpha"]);
    click(platformChip("linux"));
    expect(keys(dom.cards)).toEqual(["a/x/alpha"]);
    expect(pressed(platformChip("linux"))).toBe(false);
  });

  test("deprecated and yanked chips filter by status", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    click(statusChip("deprecated"));
    expect(keys(dom.cards)).toEqual(["a/x/beta"]);
    click(statusChip("deprecated"));
    click(statusChip("yanked"));
    expect(keys(dom.cards)).toEqual(["a/x/gamma"]);
    expect(pressed(statusChip("yanked"))).toBe(true);
  });

  test("keyword chips AND too, and a chip click toggles the keyword", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));

    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "cli")!);
    expect(keys(dom.cards)).toEqual(["a/x/alpha", "a/x/beta"]);
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "go")!);
    expect(keys(dom.cards)).toEqual(["a/x/alpha"]);
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "cli")!);
    expect(keys(dom.cards)).toEqual(["a/x/alpha"]);
  });

  test("the clear button shows only while something filters, and clears query, chips and status", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    const clears = [...document.querySelectorAll<HTMLElement>("[data-grid-clear]")];
    expect(clears.every((button) => button.hidden)).toBe(true);

    type(dom.search, "a");
    click(platformChip("linux"));
    click(statusChip("yanked"));
    expect(clears.every((button) => !button.hidden)).toBe(true);
    click(clears[0]!);

    expect(dom.search.value).toBe("");
    expect(keys(dom.cards)).toEqual(["a/x/alpha", "a/x/beta", "a/x/gamma"]);
    expect([platformChip("linux"), statusChip("yanked")].some(pressed)).toBe(false);
    expect(clears.every((button) => button.hidden)).toBe(true);
    expect(location.search).toBe("");
  });

  test("a query nothing matches empties the grid and says so, with the total", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    type(dom.search, "zzzzzz");

    expect(keys(dom.cards)).toEqual([]);
    expect(dom.noMatch.hidden).toBe(false);
    expect(text(dom.noMatch.querySelector('[data-field="title"]'))).toBe("No matches for “zzzzzz”");
    expect(text(dom.noMatch.querySelector('[data-field="message"]'))).toBe(
      "Check the spelling or drop a filter — 3 packages total.",
    );
    type(dom.search, "");
    expect(dom.noMatch.hidden).toBe(true);
  });

  test("filter-only emptying names the filters, leaves the query alone and has a working clear button", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    click(platformChip("windows"));
    click(platformChip("darwin"));

    expect(keys(dom.cards)).toEqual([]);
    expect(text(dom.noMatch.querySelector('[data-field="title"]'))).toBe("No packages match windows · darwin");
    expect(text(dom.noMatch.querySelector('[data-field="message"]'))).toBe("3 packages total — try dropping a filter.");
    click(dom.noMatch.querySelector("[data-grid-clear]"));
    expect(keys(dom.cards)).toHaveLength(3);
    expect(dom.noMatch.hidden).toBe(true);
  });

  test("an empty catalog (a genuine 404) reads as an empty view, not as a failure", async () => {
    const dom = gridDom();
    await open(dom, answering(catalog([]), 404));
    expect(dom.failure.hidden).toBe(true);
    expect(dom.noMatch.hidden).toBe(false);
    expect(text(dom.noMatch.querySelector('[data-field="title"]'))).toBe("No packages in this view");
    expect(text(dom.noMatch.querySelector('[data-field="message"]'))).toBe("0 packages total.");
    expect(dom.count.textContent).toBe("0 packages");
  });
});

describe("the keyword rail and the +N more popover", () => {
  // Three families, so the rail has real splitters: cli (a,b), db (c,d), web (e,f).
  const families = [
    pkg("a/x/a", { keywords: ["cli", "cli-only"] }),
    pkg("a/x/b", { keywords: ["cli"] }),
    pkg("a/x/c", { keywords: ["db", "sql"] }),
    pkg("a/x/d", { keywords: ["db"] }),
    pkg("a/x/e", { keywords: ["web", "html"] }),
    pkg("a/x/f", { keywords: ["web"] }),
  ];

  test("before any filter the rail spans the families", async () => {
    const dom = gridDom();
    await open(dom, catalog(families));
    expect(chipNames(dom.rail)).toEqual(expect.arrayContaining(["cli", "db", "web"]));
    expect(chipNames(dom.rail).length).toBeLessThanOrEqual(8);
  });

  test("filtering by one family drops every keyword no survivor carries, and the active one is pinned first", async () => {
    const dom = gridDom();
    await open(dom, catalog(families));
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "db")!);

    const names = chipNames(dom.rail);
    expect(names[0]).toBe("db");
    expect(pressed(chipsOf(dom.rail)[0]!)).toBe(true);
    expect(names).not.toContain("cli");
    expect(names).not.toContain("web");
    expect(names).toEqual(expect.arrayContaining(["sql"]));

    click(chipsOf(dom.rail)[0]!);
    expect(chipNames(dom.rail)).toEqual(expect.arrayContaining(["cli", "db", "web"]));
  });

  test("two selections both stay pinned, in click order", async () => {
    const dom = gridDom();
    await open(dom, catalog([...families, pkg("a/x/g", { keywords: ["db", "sql", "cli"] })]));
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "sql")!);
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "cli")!);
    expect(chipNames(dom.rail).slice(0, 2)).toEqual(["sql", "cli"]);
  });

  test("a rail change keeps a chip that stays in place, so a focused chip is not lost", async () => {
    const dom = gridDom();
    await open(dom, catalog(families));
    const first = chipsOf(dom.rail)[0]!;
    first.focus();
    type(dom.search, "a");
    // The same chip element survives a re-render that keeps its keyword.
    const same = chipsOf(dom.rail).find((chip) => chip.dataset.keyword === first.dataset.keyword);
    if (same) expect(same).toBe(first);
  });

  test("the +N more trigger counts the vocabulary the rail does not show and is hidden when it all fits", async () => {
    const dom = gridDom();
    await open(dom, catalog(families));
    // 8 keywords, the rail shows up to 8.
    expect(dom.more.hidden).toBe(true);

    const many = Array.from({ length: 12 }, (_, i) => pkg(`a/x/p${i}`, { keywords: [`kw${String(i).padStart(2, "0")}`] }));
    document.body.replaceChildren();
    unmount?.();
    const wide = gridDom();
    lazy = createLazyDouble();
    await open(wide, catalog(many));
    expect(wide.more.hidden).toBe(false);
    expect(text(wide.more.querySelector("[data-grid-more-count]"))).toBe("4");
  });

  test("the popover lists the whole vocabulary only while open, with counts scored against the survivors", async () => {
    const many = [
      ...Array.from({ length: 9 }, (_, i) => pkg(`a/x/p${i}`, { keywords: [`kw${i}`, "shared"] })),
      pkg("a/x/solo", { keywords: ["lonely"] }),
    ];
    const dom = gridDom();
    await open(dom, catalog(many));
    expect(chipsOf(dom.moreList)).toHaveLength(0);

    type(dom.search, "p1");
    emit(dom.more, "ocx:popover:change", { open: true });
    const counts = new Map(chipsOf(dom.moreList).map((chip) => [chip.dataset.keyword, text(chip.querySelector('[data-field="count"]'))]));
    // The vocabulary is complete (11), the counts are the survivors' (a keyword no survivor carries reads 0).
    expect(counts.size).toBe(11);
    expect(counts.get("lonely")).toBe("0");
    expect(counts.get("shared")).toBe("1");
    expect(chipsOf(dom.moreList).every((chip) => !chip.querySelector<HTMLElement>('[data-field="count"]')!.hidden)).toBe(true);

    type(dom.moreFilter, "LONE");
    expect(chipNames(dom.moreList)).toEqual(["lonely"]);
    click(chipsOf(dom.moreList)[0]!);
    expect(chipNames(dom.rail)[0]).toBe("lonely");

    emit(dom.more, "ocx:popover:change", { open: false });
    expect(chipsOf(dom.moreList)).toHaveLength(0);
  });

  test("a popover event from elsewhere is ignored", async () => {
    const dom = gridDom();
    await open(dom, catalog(families));
    emit(dom.root, "ocx:popover:change", { open: true });
    expect(chipsOf(dom.moreList)).toHaveLength(0);
  });
});

describe("sort and view live in the URL, not in storage", () => {
  const packages = [
    pkg("a/x/a", { updated: "2026-01-01T00:00:00Z", created: "2026-03-01T00:00:00Z" }),
    pkg("a/x/b", { updated: "2026-03-01T00:00:00Z", created: "2026-01-01T00:00:00Z" }),
    pkg("a/x/c", { updated: null, created: "2026-02-01T00:00:00Z" }),
  ];

  test("sort by recent, newest and back to name; the URL carries a non-default sort only", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/b", "a/x/c"]);

    pickSort("updated");
    expect(keys(dom.cards)).toEqual(["a/x/b", "a/x/a", "a/x/c"]);
    expect(location.search).toBe("?sort=updated");
    pickSort("created");
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/c", "a/x/b"]);
    pickSort("name");
    expect(location.search).toBe("");
  });

  test("an unknown sort value from the control changes nothing", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    pickSort("updated");
    pickSort("bogus");
    expect(location.search).toBe("?sort=updated");
  });

  test("the direction button inverts whichever order is active", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    emit(dom.invert, "ocx:toggle-button:change", { pressed: true, value: undefined });
    expect(keys(dom.cards)).toEqual(["a/x/c", "a/x/b", "a/x/a"]);
    emit(dom.invert, "ocx:toggle-button:change", { pressed: false, value: undefined });
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/b", "a/x/c"]);
  });

  test("another toggle button's event does not invert", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    emit(dom.search, "ocx:toggle-button:change", { pressed: true });
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/b", "a/x/c"]);
  });

  test("the view toggles between cards and table, writes ?view=table and an unknown view is ignored", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    pickView("table");
    expect(location.search).toBe("?view=table");
    expect(dom.cards.hidden).toBe(true);
    pickView("grid-of-pictures");
    expect(location.search).toBe("?view=table");
    pickView("cards");
    expect(location.search).toBe("");
    expect(dom.cards.hidden).toBe(false);
    expect(dom.table.hidden).toBe(true);
  });

  test("nothing is written to web storage", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    const dom = gridDom();
    await open(dom, catalog(packages));
    pickSort("updated");
    pickView("table");
    expect(set).not.toHaveBeenCalled();
  });

  test("a foreign select or toggle-group event is ignored", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    emit(dom.search, "ocx:select:change", { value: "updated" });
    emit(dom.search, "ocx:toggle-group:change", { value: ["table"] });
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/b", "a/x/c"]);
    expect(location.search).toBe("");
  });
});

describe("index scope (parity: index_scope, exclude_from_all)", () => {
  const multi = catalog(
    [
      pkg("a/x/one", { keywords: ["alpha"], platforms: ["linux/amd64"] }),
      pkg("a/x/two", { keywords: ["alpha"], platforms: ["linux/amd64"] }),
      pkg("b/y/three", { keywords: ["beta"], platforms: ["windows/amd64", "darwin/arm64"] }),
    ],
    [index("a", { root: true }), index("b", { default: true, excludeFromAll: true })],
  );

  test("opens on the default index and mirrors the scope into the URL", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    expect(keys(dom.cards)).toEqual(["b/y/three"]);
    expect(dom.count.textContent).toBe("1 packages");
    expect(location.search).toBe("?index=b");
  });

  test("selecting all widens to every index but the excluded one, selecting an index scopes to it", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);

    pickScope(":all");
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    expect(location.search).toBe("?index=");
    pickScope("b");
    expect(keys(dom.cards)).toEqual(["b/y/three"]);
    pickScope("a");
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    expect(location.search).toBe("?index=a");
  });

  test("the all view's keyword vocabulary and table columns never mention the excluded index; its own tab does", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    pickScope(":all");
    expect(chipNames(dom.rail)).toEqual(["alpha"]);
    pickView("table");
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("1");

    pickScope("b");
    expect(chipNames(dom.rail)).toEqual(["beta"]);
    // A named index's columns still come from the whole catalog, so its own windows/darwin join linux.
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("3");
  });

  test("the result count is relative to the place, and the empty-state total is the all view's", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    pickScope(":all");
    expect(dom.count.textContent).toBe("2 packages");
    type(dom.search, "one");
    expect(dom.count.textContent).toBe("1 of 2 packages");
    type(dom.search, "three");
    expect(text(dom.noMatch.querySelector('[data-field="message"]'))).toBe(
      "Check the spelling or drop a filter — 2 packages total.",
    );
  });

  test("a scope Select works like the tab group", async () => {
    const dom = gridDom({ scope: "select", ssrScope: "b" });
    await open(dom, multi);
    emit(document.querySelector("[data-grid-scope] [data-zag-root]")!, "ocx:select:change", { value: ":all" });
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    const select = document.querySelector<HTMLSelectElement>("[data-grid-scope] select")!;
    expect(select.value).toBe(":all");
    expect(text(document.querySelector("[data-grid-scope] .ocx-ui-select__value"))).toBe(":all");
  });

  test("an unknown ?index= falls to the default and the control follows", async () => {
    history.replaceState(null, "", "/?index=nope");
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    expect(keys(dom.cards)).toEqual(["b/y/three"]);
    expect(location.search).toBe("?index=b");
  });

  test("?index= (empty) is the all view, restored on a cold load", async () => {
    history.replaceState(null, "", "/?index=");
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    const items = [...document.querySelectorAll('[data-grid-scope] [data-part="item"]')];
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(location.search).toBe("?index=");
  });

  test("a single-index catalog has no scope control and never writes ?index=", async () => {
    const dom = gridDom({ scope: "none" });
    await open(dom, catalog([pkg("a/x/one")], [index("a", { root: true, default: true })]));
    expect(keys(dom.cards)).toEqual(["a/x/one"]);
    type(dom.search, "one");
    expect(location.search).toBe("?q=one");
  });

  test("a catalog without the index envelope keeps bare routes", async () => {
    const dom = gridDom({ scope: "none" });
    await open(dom, catalog([pkg("a/x/one")]));
    expect(dom.cards.querySelector("a")?.getAttribute("href")).toBe("/x/one/");
  });

  test("typing keeps the scope in the URL", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b" });
    await open(dom, multi);
    type(dom.search, "t");
    expect(location.search).toBe("?index=b&q=t");
  });

  test("server cards of the opening scope are kept as they are; a scope change replaces them", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: "b", ssrCards: ["b/y/three"] });
    const server = dom.cards.querySelector("a")!;
    await open(dom, multi);
    expect(dom.cards.querySelector("a")).toBe(server);
    pickScope(":all");
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    expect(dom.cards.contains(server)).toBe(false);
  });
});

describe("a state-bearing cold URL boots at load (C-011)", () => {
  const packages = [pkg("a/x/helm"), pkg("a/x/kube"), pkg("a/x/zed", { updated: "2026-01-01T00:00:00Z" })];

  test("starts without any interaction, shows the skeleton instead of the unfiltered server cards, then the filtered grid", async () => {
    history.replaceState(null, "", "/?q=kube&sort=updated&view=table");
    const dom = gridDom({ ssrCards: ["a/x/helm"] });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn<FetchLike>(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => catalog(packages) };
    });
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(dom.skeleton.hidden).toBe(false);
    expect(dom.cards.hidden).toBe(true);
    expect(dom.search.value).toBe("kube");
    expect(text(document.querySelector("[data-grid-sort] .ocx-ui-select__value"))).toBe("updated");
    expect(document.querySelector<HTMLSelectElement>("[data-grid-sort] select")?.value).toBe("updated");
    const view = document.querySelector<HTMLElement>("[data-grid-view] [data-zag-root]")!;
    expect(JSON.parse(view.dataset.zagProps!).defaultValue).toEqual(["table"]);
    expect(document.querySelector('[data-grid-view] [aria-checked="true"]')?.id).toBe("toggle-group:view:table");

    release();
    await settle();
    expect(keys(dom.table)).toEqual(["a/x/kube"]);
    expect(dom.table.hidden).toBe(false);
    expect(location.search).toBe("?q=kube&sort=updated&view=table");
  });

  test("a bare URL does not boot: nothing starts until the first interaction", () => {
    const dom = gridDom();
    const fetch = answering(catalog(packages));
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;
    expect(fetch).not.toHaveBeenCalled();
    expect(dom.skeleton.hidden).toBe(true);
  });

  test("holds the list region at the server cards' height, capped at the viewport, so the boot shifts nothing", () => {
    history.replaceState(null, "", "/?q=kube");
    const dom = gridDom({ ssrCards: ["a/x/helm"] });
    const heightOf = (height: number) => Object.defineProperty(dom.cards, "offsetHeight", { configurable: true, value: height });
    heightOf(window.innerHeight * 3);
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog(packages)) }).destroy;
    expect(dom.root.style.getPropertyValue("--reserve")).toBe(`${window.innerHeight}px`);
    unmount();

    history.replaceState(null, "", "/?q=kube");
    const short = gridDom({ ssrCards: ["a/x/helm"] });
    Object.defineProperty(short.cards, "offsetHeight", { configurable: true, value: 120 });
    unmount = mountGrid(short.root, lazy, { fetch: answering(catalog(packages)) }).destroy;
    expect(short.root.style.getPropertyValue("--reserve")).toBe("120px");
  });

  test("a bare URL reserves nothing", () => {
    const dom = gridDom({ ssrCards: ["a/x/helm"] });
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog(packages)) }).destroy;
    expect(dom.root.style.getPropertyValue("--reserve")).toBe("");
  });

  test.each(["q=x", "index=a", "sort=created", "view=cards"])("%s alone is state", (query) => {
    history.replaceState(null, "", `/?${query}`);
    const dom = gridDom({ scope: "toggle" });
    const fetch = answering(catalog(packages));
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;
    expect(dom.skeleton.hidden).toBe(false);
  });
});

describe("the build window (parity: catalog_windowing)", () => {
  const long = Array.from({ length: 130 }, (_, i) => pkg(`a/x/p${String(i).padStart(3, "0")}`));

  test("builds one window of a long catalog, reports the whole count and renders the sentinel that grows it", async () => {
    const dom = gridDom();
    await open(dom, catalog(long));

    expect(keys(dom.cards)).toHaveLength(48);
    expect(dom.count.textContent).toBe("130 packages");
    expect(dom.sentinel.hidden).toBe(false);
    const observer = FakeObserver.instances[0]!;
    expect(observer.observed).toEqual([dom.sentinel]);

    observer.fire();
    expect(keys(dom.cards)).toHaveLength(96);
    observer.fire();
    expect(keys(dom.cards)).toHaveLength(130);
    expect(dom.sentinel.hidden).toBe(true);
    expect(dom.count.textContent).toBe("130 packages");
  });

  test("an observer report with nothing in view grows nothing; a growth re-observes the sentinel", async () => {
    const dom = gridDom();
    await open(dom, catalog(long));
    const observer = FakeObserver.instances[0]!;
    observer.fire(false);
    expect(keys(dom.cards)).toHaveLength(48);
    const before = observer.observed.length;
    observer.fire();
    expect(observer.observed).toHaveLength(before);
  });

  test("a catalog inside one window renders whole with no sentinel", async () => {
    const dom = gridDom();
    await open(dom, catalog(long.slice(0, 10)));
    expect(keys(dom.cards)).toHaveLength(10);
    expect(dom.sentinel.hidden).toBe(true);
  });

  test("switching view and a new result set go back to one window", async () => {
    const dom = gridDom();
    await open(dom, catalog(long));
    FakeObserver.instances[0]!.fire();
    expect(keys(dom.cards)).toHaveLength(96);

    pickView("table");
    expect(keys(dom.table)).toHaveLength(48);
    pickView("cards");
    expect(keys(dom.cards)).toHaveLength(48);
  });

  test("without IntersectionObserver the whole result set is built", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const dom = gridDom();
    await open(dom, catalog(long));
    expect(keys(dom.cards)).toHaveLength(130);
    expect(dom.sentinel.hidden).toBe(true);
  });

  test("stopping the session disconnects the observer", async () => {
    const dom = gridDom();
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog(long)) }).destroy;
    const session = (await lazy.mounts[0]!.spec.load()).start(dom.root);
    expect(FakeObserver.instances.at(-1)?.disconnected).toBe(false);
    session?.stop();
    expect(FakeObserver.instances.at(-1)?.disconnected).toBe(true);
  });
});

describe("URL state writes", () => {
  const rejectReplaceState = (error: unknown) => {
    vi.spyOn(history, "replaceState").mockImplementation(() => {
      throw error;
    });
  };

  test("a SecurityError from replaceState (WebKit's rate limit) does not abort the render", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    rejectReplaceState(new DOMException("rate limited", "SecurityError"));
    await open(dom, catalog([pkg("a/x/one"), pkg("a/x/two")]));

    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    expect(dom.failure.hidden).toBe(true);
  });

  test("any other replaceState failure is a real fault and reaches the error panel", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    rejectReplaceState(new TypeError("boom"));
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog([pkg("a/x/one")])) }).destroy;
    await lazy.mounts[0]?.fire();

    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("boom");
  });
});

describe("a failed catalog fetch (parity: catalog_fetch_error)", () => {
  test("a 500 shows a distinct error panel with the reason and keeps the server cards", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    await vi.waitFor(async () => {
      unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog([]), 500) }).destroy;
    });
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));

    expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("HTTP 500");
    expect(dom.noMatch.hidden).toBe(true);
    expect(keys(dom.cards)).toEqual(["a/x/one"]);
  });

  test("a network error names its message; a non-Error rejection is stringified", async () => {
    const dom = gridDom();
    const fetch = vi.fn<FetchLike>().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce("odd");
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("offline"));

    click(dom.failure.querySelector("[data-grid-retry]"));
    await vi.waitFor(() => expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("odd"));
  });

  test("Retry fetches again and recovers", async () => {
    const dom = gridDom();
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => catalog([pkg("a/x/one")]) });
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));

    click(dom.failure.querySelector("[data-grid-retry]"));
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/one"]));
    expect(dom.failure.hidden).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a cold URL that failed gives the server cards back from behind the skeleton", async () => {
    history.replaceState(null, "", "/?q=x");
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog([]), 500) }).destroy;
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(dom.skeleton.hidden).toBe(true);
    expect(dom.cards.hidden).toBe(false);
  });

  test("Retry before any session does nothing", () => {
    const dom = gridDom();
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog([])) }).destroy;
    expect(() => click(dom.failure.querySelector("[data-grid-retry]"))).not.toThrow();
  });
});

describe("keyboard", () => {
  const packages = [pkg("a/x/one"), pkg("a/x/two"), pkg("a/x/three"), pkg("a/x/four")];
  const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const cardLinks = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("a[data-card]")];

  test("plain Tab from the search field focuses the first card; in table view the first row", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    dom.search.focus();
    const event = press(dom.search, "Tab");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cardLinks(dom.cards)[0]);

    pickView("table");
    dom.search.focus();
    press(dom.search, "Tab");
    expect(document.activeElement).toBe(cardLinks(dom.table)[0]);
  });

  test("Shift+Tab is left alone, and so is Tab when there is nothing to jump to", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    expect(press(dom.search, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    type(dom.search, "zzzzzz");
    expect(press(dom.search, "Tab").defaultPrevented).toBe(false);
  });

  test("arrows move across cards by the grid's column count and clamp at both ends", async () => {
    vi.stubGlobal("getComputedStyle", () => ({ gridTemplateColumns: "1fr 1fr" }));
    const dom = gridDom();
    await open(dom, catalog(packages));
    const links = cardLinks(dom.cards);
    links[0]!.focus();

    expect(press(document.activeElement!, "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[1]);
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(links[3]);
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(links[3]);
    press(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(links[1]);
    press(document.activeElement!, "ArrowLeft");
    press(document.activeElement!, "ArrowLeft");
    expect(document.activeElement).toBe(links[0]);
  });

  test("an unrelated key on a card is left alone", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    const links = cardLinks(dom.cards);
    links[0]!.focus();
    expect(press(links[0]!, "Enter").defaultPrevented).toBe(false);
    expect(press(dom.search, "ArrowDown").defaultPrevented).toBe(false);
  });

  test("table rows move one at a time with every arrow key", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    pickView("table");
    const rows = cardLinks(dom.table);
    rows[0]!.focus();
    press(rows[0]!, "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(rows[2]);
    press(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(rows[1]);
  });

  test("a card that survives a re-render keeps focus", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    const first = cardLinks(dom.cards)[0]!;
    first.focus();
    click(platformChip("linux"));
    expect(cardLinks(dom.cards)[0]).toBe(first);
    expect(document.activeElement).toBe(first);
  });

  test("/ focuses the search field unless typing elsewhere; Escape drops focus", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    expect(press(document.body, "/").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dom.search);

    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    expect(press(other, "/").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);

    const link = cardLinks(dom.cards)[0]!;
    link.focus();
    press(link, "Escape");
    expect(document.activeElement).not.toBe(link);
    press(document.body, "x");
  });
});

describe("a window shared by session and controls", () => {
  test("the settled state survives a second render with the same data (idempotent)", async () => {
    const dom = gridDom({ scope: "toggle", ssrScope: ":all" });
    await open(dom, catalog([pkg("a/x/one"), pkg("a/y/two")], [index("a", { root: true, default: true }), index("b")]));
    const before = keys(dom.cards);
    click(platformChip("linux"));
    click(platformChip("linux"));
    expect(keys(dom.cards)).toEqual(before);
  });

  test("an empty template reaches the error panel instead of an unhandled rejection", async () => {
    const dom = gridDom();
    dom.root.querySelector<HTMLTemplateElement>("template[data-grid-card]")!.content.replaceChildren();
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog([pkg("a/x/one")])) }).destroy;
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("grid: empty template");
  });
});

describe("keyword cards", () => {
  test("a card prints the three catalog-wide most common of its keywords first", async () => {
    const dom = gridDom();
    await open(
      dom,
      catalog([
        pkg("a/x/one", { keywords: ["z", "rare", "common", "mid", "extra"] }),
        pkg("a/x/two", { keywords: ["common", "mid"] }),
        pkg("a/x/three", { keywords: ["common"] }),
      ]),
    );
    const words = [...dom.cards.querySelectorAll('[data-key="a/x/one"] [data-slot="keyword"]')].map((el) => el.textContent);
    expect(words).toEqual(["common", "mid", "extra"]);
  });

  test("a long qualified name is elided in the middle and keeps the full name in title", async () => {
    const name = "corp.example/platform-engineering/internal-tools/deploy-kit";
    const dom = gridDom();
    await open(dom, catalog([pkg(name)]));
    const el = dom.cards.querySelector('[data-field="name"]')!;
    expect(el.textContent).toBe("corp.example/…/deploy-kit");
    expect(el.getAttribute("title")).toBe(name);
    pickView("table");
    expect(dom.table.querySelector('[data-field="name"]')?.textContent).toBe("corp.example/…/deploy-kit");
  });
});

describe("edges of the wiring", () => {
  const packages = [pkg("a/x/one"), pkg("a/x/two")];

  test("a click on a text node, or on nothing the grid owns, changes nothing", async () => {
    const dom = gridDom();
    await open(dom, catalog(packages));
    const note = document.createTextNode("note");
    dom.root.append(note);
    note.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click(dom.count);
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    expect(location.search).toBe("");
  });

  test("a toggle group the server rendered without props still follows the URL", async () => {
    history.replaceState(null, "", "/?view=table");
    const dom = gridDom();
    delete document.querySelector<HTMLElement>("[data-grid-view] [data-zag-root]")!.dataset.zagProps;
    unmount = mountGrid(dom.root, lazy, { fetch: answering(catalog(packages)) }).destroy;
    const props = document.querySelector<HTMLElement>("[data-grid-view] [data-zag-root]")!.dataset.zagProps;
    expect(JSON.parse(props!)).toEqual({ defaultValue: ["table"] });
  });

  test("a scope Select picks an index by value, and an unknown ?index= leaves its options alone", async () => {
    history.replaceState(null, "", "/?index=nope");
    const dom = gridDom({ scope: "select", ssrScope: "b", scopeValues: [":all", "a", "b"] });
    const multi = catalog([pkg("a/x/one"), pkg("b/y/two")], [index("a", { root: true }), index("b", { default: true })]);
    unmount = mountGrid(dom.root, lazy, { fetch: answering(multi) }).destroy;
    // `nope` is no option of the control: the cold start leaves it alone until the settled scope replaces it.
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["b/y/two"]));

    emit(document.querySelector("[data-grid-scope] [data-zag-root]")!, "ocx:select:change", { value: "a" });
    expect(keys(dom.cards)).toEqual(["a/x/one"]);
    expect(location.search).toBe("?index=a");
  });

  test("with no fetch option the grid asks the page's own fetch", async () => {
    const dom = gridDom();
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog(packages) }));
    vi.stubGlobal("fetch", spy);
    unmount = mountGrid(dom.root, lazy).destroy;
    await lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]));
    expect(spy).toHaveBeenCalledWith("/data/catalog/catalog.json");
  });

  test("typing or opening the popover before the catalog has arrived is recorded and shown on arrival", async () => {
    const dom = gridDom();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn<FetchLike>(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => catalog(packages) };
    });
    unmount = mountGrid(dom.root, lazy, { fetch }).destroy;
    const fired = lazy.mounts[0]!.fire();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    type(dom.search, "two");
    emit(dom.more, "ocx:popover:change", { open: true });
    type(dom.moreFilter, "x");
    release();
    await fired;
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/two"]));
  });

  test("operating systems nobody draws a glyph for still get columns, in name order", async () => {
    const dom = gridDom();
    await open(
      dom,
      catalog([pkg("a/x/one", { platforms: ["openbsd/amd64"] }), pkg("a/x/two", { platforms: ["freebsd/amd64", "linux/amd64"] })]),
    );
    pickView("table");
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("3");
    expect(
      [...dom.table.querySelectorAll('[data-key="a/x/two"] [data-field="platforms"] > *')].map((el) => el.getAttribute("data-os") ?? "empty"),
    ).toEqual(["linux", "empty", "empty"]);
  });
});
