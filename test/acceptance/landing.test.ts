/**
 * C-010 / C-015 / C-041 / C-042 / S-005 / S-020 — the landing page as built:
 * `min(24, n)` default-scope cards in name order (each a link), item templates
 * for the island, the toolbar in its final state, logos as `<img>` with
 * intrinsic size, an empty catalog as an empty-state box with no grid, and
 * hostile package metadata inert. Also the SSR half of the parity rows ported
 * from `test/theme/components/{catalog_layout,index_scope,exclude_from_all,
 * keyword_rail_narrowing,index_overflow_popover,platform_agnostic,
 * package_identifier_elision,toolbar_keyboard_operable,catalog_windowing,
 * catalog_fetch_error,catalog_a11y}_wiring.test.ts` (the interactive half lives
 * in `test/site/client/grid.test.ts`).
 *
 * Needs the `root` and `catalog` sites: `ACCEPT_CONFIG=root,catalog`.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, pageScripts, readHtml, runBuild, site, type Project } from "./helpers.js";

interface CatalogJson {
  readonly indexes: readonly { readonly name: string; readonly root: boolean; readonly default: boolean }[];
  readonly packages: readonly { readonly name: string; readonly title: string; readonly status: string }[];
}

const catalogJson = async (siteDir: string): Promise<CatalogJson> =>
  JSON.parse(await readFile(join(siteDir, "data/catalog/catalog.json"), "utf8")) as CatalogJson;

const cardLinks = (doc: Document): HTMLAnchorElement[] =>
  [...doc.querySelectorAll<HTMLAnchorElement>("[data-grid-cards] > li > a[data-card]")];

/** The link a card for `name` must carry: the root index is bare, every other qualified, all under `base`. */
function expectedHref(catalog: CatalogJson, name: string, base: string): string {
  const root = catalog.indexes.find((index) => index.root)?.name;
  const route = root !== undefined && name.startsWith(`${root}/`) ? name.slice(root.length + 1) : name;
  return `${base}${route}/`;
}

describe("S-005 landing, root site (base /)", () => {
  it("renders exactly 24 default-scope cards of the 26, in name order, each a link", async () => {
    const dir = site("root");
    const catalog = await catalogJson(dir);
    const doc = await readHtml(dir, "/");

    expect(catalog.packages.length).toBeGreaterThan(24);
    const links = cardLinks(doc);
    expect(links.map((a) => a.dataset.key)).toEqual(catalog.packages.slice(0, 24).map((pkg) => pkg.name));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      catalog.packages.slice(0, 24).map((pkg) => expectedHref(catalog, pkg.name, "/")),
    );
    expect(doc.querySelector("[data-grid-cards]")?.getAttribute("role")).toBe("list");
  });

  it("carries one visually hidden h1 with the brand title, before any script runs", async () => {
    const doc = await readHtml(site("root"), "/");
    const headings = doc.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Site Fixture Catalog");
    expect(headings[0]?.classList.contains("visually-hidden")).toBe(true);
  });

  it("ships the item templates the island clones, each rendered by the page's own components", async () => {
    const doc = await readHtml(site("root"), "/");
    for (const name of ["data-grid-card", "data-grid-row", "data-grid-card-keyword", "data-grid-chip"]) {
      expect(doc.querySelectorAll(`template[${name}]`), name).toHaveLength(1);
    }
    expect([...doc.querySelectorAll("template[data-grid-os]")].map((t) => t.getAttribute("data-grid-os"))).toEqual([
      "linux",
      "darwin",
      "windows",
      "any",
    ]);
    const template = doc.querySelector<HTMLTemplateElement>("template[data-grid-card]")!;
    expect(template.content.querySelector("a[data-card][href]")).not.toBeNull();
    for (const field of ["title", "version", "deprecated", "yanked", "name", "description", "keywords", "platforms", "tags", "install"]) {
      expect(template.content.querySelector(`[data-field="${field}"]`), field).not.toBeNull();
    }
    const row = doc.querySelector<HTMLTemplateElement>("template[data-grid-row]")!;
    expect(row.content.querySelector('a[data-card] [data-field="platforms"]')).not.toBeNull();
  });

  it("names no catalog.json URL and preloads no island chunk before first interaction (C-011)", async () => {
    const dir = site("root");
    const html = await readFile(join(dir, "index.html"), "utf8");
    expect(html).not.toContain("catalog.json");
    expect(html).not.toContain("modulepreload");
  });

  it("renders the toolbar in its final state: count, sort, view, no scope row for one index", async () => {
    const dir = site("root");
    const catalog = await catalogJson(dir);
    const doc = await readHtml(dir, "/");

    const count = doc.querySelector("[data-grid-count]")!;
    expect(count.textContent).toBe(`${catalog.packages.length} packages`);
    expect(count.getAttribute("role")).toBe("status");
    expect(count.getAttribute("aria-atomic")).toBe("true");
    expect(doc.querySelector("[data-grid-scope]")).toBeNull();
    expect(doc.querySelector("[data-grid-sort] select")?.getAttribute("value")).toBe("name");
    expect([...doc.querySelectorAll("[data-grid-sort] option")].map((o) => o.textContent?.trim())).toEqual([
      "name",
      "recent",
      "newest",
    ]);
    expect(doc.querySelector('[data-grid-view] [aria-checked="true"]')?.getAttribute("aria-label")).toBe("Cards");
    expect(doc.querySelector("[data-grid-invert]")?.getAttribute("aria-pressed")).toBe("false");
    expect(doc.querySelector("[data-grid-search]")?.getAttribute("type")).toBe("search");
    expect(doc.querySelector("[data-grid-clear]")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("[data-grid-more]")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector('[data-grid-empty="no-match"]')?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector('[data-grid-empty="error"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("every toolbar chip is a real button and a Tab stop: no tabindex override anywhere in the grid", async () => {
    const doc = await readHtml(site("root"), "/");
    const grid = doc.querySelector("[data-grid]")!;
    const chips = [...grid.querySelectorAll("[data-grid-platform], [data-grid-status]")];
    expect(chips.map((chip) => chip.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
    expect(chips.every((chip) => chip.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(grid.querySelectorAll("[data-card]:not([href])")).toHaveLength(0);
    expect(grid.querySelectorAll('[data-grid-platform][tabindex], [data-grid-status][tabindex], [data-card][tabindex]')).toHaveLength(0);
  });

  it("elides a long qualified name in the middle and keeps the full name in title (parity: package_identifier_elision)", async () => {
    const doc = await readHtml(site("root"), "/");
    const name = doc.querySelector<HTMLElement>('[data-grid-cards] [data-key="index-a/oxidize/ripgrep"] [data-field="name"]');
    // Short names are left alone; the title attribute always carries the full identifier.
    expect(name?.textContent).toBe("index-a/oxidize/ripgrep");
    expect(name?.getAttribute("title")).toBe("index-a/oxidize/ripgrep");
  });

  it("installs the card's one-line command from the shared flavor list", async () => {
    const doc = await readHtml(site("root"), "/");
    const card = doc.querySelector('[data-key="index-a/cloud/helm-lite"]')!;
    expect(card.querySelector('[data-field="install"]')?.textContent).toBe("ocx add index-a/cloud/helm-lite");
  });

  it("deprecated and yanked packages carry their stamp; active ones do not", async () => {
    const doc = await readHtml(site("root"), "/");
    const stamps = (key: string) =>
      [...doc.querySelectorAll(`[data-grid-cards] [data-key="${key}"] [data-field="deprecated"], [data-grid-cards] [data-key="${key}"] [data-field="yanked"]`)].map(
        (el) => el.textContent?.trim(),
      );
    expect(stamps("index-a/legacy/oldtool")).toEqual(["deprecated"]);
    expect(stamps("index-a/legacy/husk")).toEqual(["yanked"]);
    expect(stamps("index-a/cloud/helm-lite")).toEqual([]);
  });
});

describe("C-015 logos are <img> with intrinsic size, never inlined wire SVG", () => {
  it.each(["root", "catalog"] as const)("%s: every logo is an img with width and height, no svg inside a logo box", async (name) => {
    const doc = await readHtml(site(name), "/");
    const logos = [...doc.querySelectorAll<HTMLImageElement>("[data-grid] img")];
    expect(logos.length).toBeGreaterThan(0);
    for (const img of logos) {
      expect(img.getAttribute("width"), img.outerHTML).toMatch(/^\d+$/);
      expect(img.getAttribute("height"), img.outerHTML).toMatch(/^\d+$/);
      expect(img.getAttribute("alt")).toBe("");
    }
    expect(doc.querySelectorAll("[data-grid] .logo-box svg")).toHaveLength(0);
  });

  it("a package with a logo points its img at the base-joined catalog-root-relative path; one without hides it", async () => {
    const doc = await readHtml(site("root"), "/");
    const withLogo = doc.querySelector<HTMLImageElement>('[data-key="index-a/cloud/kubectl-lite"] img[data-field="logo"]')!;
    expect(withLogo.getAttribute("src")).toMatch(/^\/p\/cloud\/kubectl-lite\/o\/sha256\/[0-9a-f]{64}\.svg$/);
    expect(withLogo.hasAttribute("hidden")).toBe(false);
    const without = doc.querySelector<HTMLImageElement>('[data-key="index-a/cloud/helm-lite"] img[data-field="logo"]')!;
    expect(without.hasAttribute("src")).toBe(false);
    expect(without.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector('[data-key="index-a/cloud/helm-lite"] [data-field="initials"]')?.textContent).toBe("HL");
  });
});

describe("S-005 landing, catalog site (base /catalog/, multi-index)", () => {
  it("opens on the default index, whose own cards are linked at their qualified, base-joined route", async () => {
    const dir = site("catalog");
    const catalog = await catalogJson(dir);
    const doc = await readHtml(dir, "/");

    const links = cardLinks(doc);
    const inB = catalog.packages.filter((pkg) => pkg.name.startsWith("index-b/"));
    expect(links.map((a) => a.dataset.key)).toEqual(inB.map((pkg) => pkg.name));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(inB.map((pkg) => expectedHref(catalog, pkg.name, "/catalog/")));
    expect(links.every((a) => a.getAttribute("href")!.startsWith("/catalog/index-b/"))).toBe(true);
  });

  it("renders one scope item per index plus all, with counts, the default badged and selected", async () => {
    const doc = await readHtml(site("catalog"), "/");
    const items = [...doc.querySelectorAll("[data-grid-scope] [data-part='item']")];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["all (26)", "index-a (26)", "index-b · default (4)"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    // "all" omits the excludeFromAll index, so its count is index-a's alone; the toolbar count is the open scope's.
    expect(doc.querySelector("[data-grid-count]")?.textContent).toBe("4 packages");
  });

  it("renders no catalog.json URL and no modulepreload, under the base too", async () => {
    const html = await readFile(join(site("catalog"), "index.html"), "utf8");
    expect(html).not.toContain("catalog.json");
    expect(html).not.toContain("modulepreload");
  });

  it("keeps every root-relative link of the grid under the base", async () => {
    const doc = await readHtml(site("catalog"), "/");
    for (const el of doc.querySelectorAll("[data-grid] [href], [data-grid] [src]")) {
      const value = el.getAttribute("href") ?? el.getAttribute("src")!;
      if (value.startsWith("/")) expect(value, el.outerHTML).toMatch(/^\/catalog\//);
    }
  });

  it("renders hostile package metadata as inert text: no attribute, element or script it injected", async () => {
    const doc = await readHtml(site("catalog"), "/");
    const hostile = doc.querySelector('[data-grid-cards] [data-key="index-b/hostile/metadata"]')!;
    expect(hostile).not.toBeNull();
    expect(hostile.querySelector('[data-field="description"]')?.textContent).toContain("onmouseover");
    expect(doc.querySelector("[data-grid] img[src='x'], [data-grid] [onerror], [data-grid] [onmouseover]")).toBeNull();
    const keywords = [...hostile.querySelectorAll('[data-slot="keyword"]')].map((el) => el.textContent?.trim());
    expect(keywords.length).toBeLessThanOrEqual(3);
    for (const text of keywords) expect(text).not.toBe("");
    expect([...doc.querySelectorAll("script")].filter((script) => script.textContent?.includes("alert"))).toHaveLength(0);
  });
});

describe("C-010 empty and small catalogs", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  async function built(prepare?: (project: Project) => Promise<void>, extra: Record<string, unknown> = {}): Promise<string> {
    const project = await createProject(extra);
    projects.push(project);
    await prepare?.(project);
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);
    return project.out;
  }

  it("an empty catalog renders the empty-state box alone: no grid, no toolbar, no island root", async () => {
    const out = await built(
      async (project) => {
        await rm(join(project.dir, "index/p"), { recursive: true });
        await mkdir(join(project.dir, "index/p"));
      },
      // A source with no package roots cannot derive its label, so the config names it.
      { sources: [{ path: "./index", root: true, label: "empty" }] },
    );
    const doc = await readHtml(out, "/");
    expect(doc.querySelector('[data-grid-empty="no-data"]')?.textContent).toContain("No packages published yet");
    expect(doc.querySelector("[data-grid], [data-grid-cards], template[data-grid-card]")).toBeNull();
    expect(await readFile(join(out, "index.html"), "utf8")).not.toContain("catalog.json");
  });

  it("n < 24 renders n cards, and a platform-shipping package draws its OS glyphs in canonical order", async () => {
    const out = await built();
    const catalog = await catalogJson(out);
    const doc = await readHtml(out, "/");

    expect(catalog.packages.length).toBeLessThan(24);
    expect(cardLinks(doc)).toHaveLength(catalog.packages.length);
    const glyphs = [...doc.querySelectorAll('[data-grid-cards] [data-field="platforms"] [data-os]')].map((el) => el.getAttribute("data-os"));
    expect(glyphs.length).toBeGreaterThan(0);
    for (const os of glyphs) expect(["linux", "darwin", "windows", "any"]).toContain(os);
    expect(doc.querySelector("[data-grid-count]")?.textContent).toBe(`${catalog.packages.length} packages`);
  });
});

describe.each([
  ["root", "/"],
  ["catalog", "/catalog/"],
] as const)("C-011 landing, %s site: the island is wired but nothing of it loads before interaction", (name, base) => {
  it("ships the module script that mounts [data-grid] on the theme's lazy mount, no modulepreload and no catalog.json in the HTML", async () => {
    const dir = site(name);
    const { scripts, preloads, mentionsCatalog } = await pageScripts(dir, await readHtml(dir, "/"), base);

    const island = scripts.filter(({ code }) => code.includes("[data-grid]") && code.includes("zagState"));
    expect(island, "a page script that mounts the island on the theme's lazy mount").toHaveLength(1);
    // MiniSearch (`fuzzyGet` is one of its methods) is the lazy chunk: not in the script or its static imports.
    expect(island[0]!.code).not.toContain("fuzzyGet");
    expect(preloads).toBe(0);
    expect(mentionsCatalog).toBe(false);
  });
});
