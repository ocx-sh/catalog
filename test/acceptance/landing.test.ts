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
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogJsonMentions, createProject, pageScripts, readHtml, runBuild, site, type Project } from "./helpers.js";

interface CatalogJson {
  readonly indexes: readonly { readonly name: string; readonly root: boolean; readonly default: boolean }[];
  readonly packages: readonly { readonly name: string; readonly title: string; readonly status: string; readonly keywords: readonly string[] }[];
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
    expect(catalogJsonMentions(html)).toEqual([]);
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
    // The popover lists the whole vocabulary; what the rail left out is the "+N more" count (D-012).
    const vocabulary = new Set(catalog.packages.flatMap((pkg) => pkg.keywords));
    const railed = doc.querySelectorAll("[data-grid-keywords] [data-grid-chip]").length;
    expect(doc.querySelector("[data-grid-more]")?.hasAttribute("hidden")).toBe(vocabulary.size <= railed);
    expect(doc.querySelector("[data-grid-more-count]")?.textContent).toBe(String(Math.max(0, vocabulary.size - railed)));
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
    // The only svg in a logo tile is the theme's cube, and only the template's empty tile has one.
    expect(doc.querySelectorAll("[data-grid] [data-grid-cards] .ocx-logo-tile svg")).toHaveLength(0);
  });

  it("a package with a logo points its img at the base-joined catalog-root-relative path; one without hides it", async () => {
    const doc = await readHtml(site("root"), "/");
    const withLogo = doc.querySelector<HTMLImageElement>('[data-key="index-a/cloud/kubectl-lite"] .ocx-logo-tile__image')!;
    expect(withLogo.getAttribute("src")).toMatch(/^\/p\/cloud\/kubectl-lite\/o\/sha256\/[0-9a-f]{64}\.svg$/);
    expect(withLogo.hasAttribute("hidden")).toBe(false);
    const without = doc.querySelector<HTMLImageElement>('[data-key="index-a/cloud/helm-lite"] .ocx-logo-tile__image')!;
    expect(without.hasAttribute("src")).toBe(false);
    expect(without.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector('[data-key="index-a/cloud/helm-lite"] .ocx-logo-tile__initials')?.textContent).toBe("HL");
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
    expect(catalogJsonMentions(html)).toEqual([]);
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

  it("D-028 an empty catalog shows the no-data panel in place of the toolbar and cards, with the island root waiting for a catalog.json that fills", async () => {
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
    expect(doc.querySelector('[data-grid-empty="no-data"]')?.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector("[data-grid-toolbar]")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("[data-grid] [data-grid-cards] > li")).toBeNull();
    expect(catalogJsonMentions(await readFile(join(out, "index.html"), "utf8"))).toEqual([]);
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
  it("D-009 the page ships the logo tile's install() script: a logo that fails settles to its initials, which the island's clones rely on", async () => {
    const dir = site(name);
    const { scripts } = await pageScripts(dir, await readHtml(dir, "/"), base);
    // `install()` listens for the image's load and error in the capture phase, swaps in the image's data-fallback once, then falls back to the monogram.
    const installers = scripts.filter(({ code }) => code.includes(".ocx-logo-tile__image") && code.includes("data-retried") && code.includes("`fallback`"));
    expect(installers.map(({ src }) => src), "exactly one page script runs the logo tile install()").toHaveLength(1);
    expect(installers[0]!.src).toMatch(/LogoTile/);
    // Control: the detector can fail. The 404 page draws no logo tile, so no script there matches it.
    const notFound = await pageScripts(dir, await readHtml(dir, "/404.html"), base);
    expect(notFound.scripts.filter(({ code }) => code.includes("data-retried"))).toHaveLength(0);
  });

  it("ships the module script that mounts [data-grid] on the theme's lazy mount, no modulepreload and no catalog.json in the HTML", async () => {
    const dir = site(name);
    const { scripts, preloads, mentionsCatalog } = await pageScripts(dir, await readHtml(dir, "/"), base);

    const island = scripts.filter(({ code }) => code.includes("[data-grid-invert]") && code.includes("zagState"));
    expect(island.map(({ src }) => src), "a page script that mounts the island on the theme's lazy mount").toHaveLength(1);
    // MiniSearch (`fuzzyGet` is one of its methods) is the lazy chunk: not in the script or its static imports.
    expect(island[0]!.code).not.toContain("fuzzyGet");
    expect(preloads).toBe(0);
    expect(mentionsCatalog).toBe(false);
  });
});

describe("L-grid the toolbar and panels as built (SSR half of C11 to C15)", () => {
  it("D-012 the keyword rail is server-rendered for the opening scope: at most eight chips, each a filter button", async () => {
    const doc = await readHtml(site("root"), "/");
    const chips = [...doc.querySelectorAll("[data-grid-keywords] [data-grid-chip]")];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(8);
    for (const chip of chips) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      expect(chip.getAttribute("data-keyword")).toBeTruthy();
      expect(chip.querySelector('[data-field="keyword"]')?.textContent).toBe(chip.getAttribute("data-keyword"));
      expect(chip.hasAttribute("data-count")).toBe(false);
    }
  });

  it("D-019 the search field says what it searches and carries the slash hint", async () => {
    const doc = await readHtml(site("root"), "/");
    expect(doc.querySelector("[data-grid-search]")?.getAttribute("placeholder")).toBe("search packages — name, keyword, description…");
    expect(doc.querySelector(".toolbar-search kbd, .toolbar-search [class*='kbd']")?.textContent?.trim()).toBe("/");
  });

  it("D-020 the search field's clear button is named 'Clear search', as in 0.5.3 (not the theme's 'Clear Search packages')", async () => {
    const doc = await readHtml(site("root"), "/");
    const field = doc.querySelector("[data-grid-search]")!.closest(".ocx-ui-search-field")!;
    expect(field.querySelector("button[aria-label]")?.getAttribute("aria-label")).toBe("Clear search");
  });

  it("D-024 the loading skeleton waits hidden and empty, with one card-shaped item for the island to stamp and no accessible content", async () => {
    const doc = await readHtml(site("root"), "/");
    const skeleton = doc.querySelector("ul[data-grid-skeleton]")!;
    expect(skeleton.hasAttribute("hidden")).toBe(true);
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    // The placeholders (grid_states.test.ts counts them) are stamped by the island from one template: 100 nodes the page need not carry (C-017).
    expect(skeleton.children).toHaveLength(0);
    const item = doc.querySelector<HTMLTemplateElement>("template[data-grid-skeleton-item]")!;
    expect([...item.content.children].map((child) => child.tagName)).toEqual(["LI"]);
    expect(item.content.querySelector(".skeleton-card")).not.toBeNull();
    expect(item.content.textContent?.trim()).toBe("");
  });

  it("D-048 the clear control reads 'clear filters' in lower case and waits hidden", async () => {
    const clear = (await readHtml(site("root"), "/")).querySelector("[data-grid-clear]")!;
    expect(clear.textContent?.trim()).toBe("clear filters");
    expect(clear.hasAttribute("hidden")).toBe(true);
  });

  it("D-030 the no-match panel's message is filled by the server and offers both ways out", async () => {
    const dir = site("root");
    const catalog = await catalogJson(dir);
    const panel = (await readHtml(dir, "/")).querySelector('[data-grid-empty="no-match"]')!;
    expect(panel.querySelector('[data-field="message"]')?.textContent).toContain(`${catalog.packages.length} packages total`);
    expect(panel.querySelector("[data-grid-clear-search]")?.textContent?.trim()).toBe("clear search");
    expect(panel.querySelector("[data-grid-clear]")?.textContent?.trim()).toBe("clear filters");
  });

  it("D-047 the theme markup the island writes into is still the markup the island expects (drift pin)", async () => {
    const doc = await readHtml(site("catalog"), "/");
    for (const hook of ["[data-grid-view]", "[data-grid-scope]"]) {
      const group = doc.querySelector<HTMLElement>(`${hook} [data-zag-root="toggle-group"]`)!;
      expect(group, hook).not.toBeNull();
      expect(JSON.parse(group.dataset.zagProps ?? "null"), hook).toHaveProperty("defaultValue");
      const items = [...group.querySelectorAll<HTMLElement>('[data-part="item"]')];
      expect(items.length, hook).toBeGreaterThan(1);
      for (const item of items) {
        expect(item.id.startsWith(`${group.id}:`), `${hook} ${item.id}`).toBe(true);
        expect(["true", "false"]).toContain(item.getAttribute("aria-checked"));
        expect(["on", "off"]).toContain(item.getAttribute("data-state"));
      }
    }
    const sort = doc.querySelector("[data-grid-sort]")!;
    expect(sort.querySelector('[data-zag-root="select"] .ocx-ui-select__value')).not.toBeNull();
    expect(sort.querySelector("select option")).not.toBeNull();
  });

  it("D-003 the landing padding shrinks below 640px (space-4 around, space-6 below), above it stays space-5/6/8", async () => {
    const dirs = join(site("root"), "_astro");
    const css = (await Promise.all((await readdir(dirs)).filter((f) => f.endsWith(".css")).map((f) => readFile(join(dirs, f), "utf8")))).join("\n").replace(/\s+/g, "");
    const narrow = css.match(/@media\((?:max-width:639px|width<=639px)\)\{\.landing[^{]*\{[^}]*\}/g) ?? [];

    expect(narrow.some((rule) => rule.includes("padding:var(--ocx-space-4)var(--ocx-space-4)var(--ocx-space-6)"))).toBe(true);
    // Control: the unconditional rule is still there, with the wide padding.
    expect(css).toMatch(/\.landing[^{@]*\{[^}]*padding:var\(--ocx-space-5\)var\(--ocx-space-6\)var\(--ocx-space-8\)/);
  });

  it("D-046 content-visibility is applied to the card only in the built stylesheets, never to a row or list item", async () => {
    const dir = site("root");
    const dirs = join(dir, "_astro");
    const css = (await Promise.all((await readdir(dirs)).filter((f) => f.endsWith(".css")).map((f) => readFile(join(dirs, f), "utf8")))).join("\n");
    // The theme's own rules (a prose `details`) use the property too; ours name a catalog item.
    const ours = [...css.matchAll(/([^{}]+)\{([^{}]*content-visibility[^{}]*)\}/g)].filter(([, selector]) => /pkg-(card|row)|\.item\b/.test(selector!));
    expect(ours.length).toBeGreaterThan(0);
    for (const [, selector] of ours) expect(selector, selector).toContain("pkg-card");
  });
});

describe("view-switch cost: no glyph entrance animation inside the grid", () => {
  const builtCss = async () => {
    const dirs = join(site("root"), "_astro");
    return (await Promise.all((await readdir(dirs)).filter((f) => f.endsWith(".css")).map((f) => readFile(join(dirs, f), "utf8")))).join("\n");
  };
  // Specificity of a selector's `[attr]`/`.class` parts, which is all these two rules use.
  const specificity = (selector: string) => (selector.match(/\[[^\]]*\]|\.[\w-]+/g) ?? []).length;
  const rulesWithAnimation = (css: string, selectorPattern: RegExp) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*animation:[^{}]*)\}/g)].filter(([, selector]) => selectorPattern.test(selector!.trim()));

  it("the grid's glyph rule disables the theme's entrance animation and outranks it", async () => {
    const css = await builtCss();
    const theme = rulesWithAnimation(css, /^\.ocx-platform\[data-astro-cid-[\w-]+\]$/).filter(([, , body]) => body!.includes("ocx-platform-in"));
    const ours = rulesWithAnimation(css, /^\[data-grid\] \.ocx-platform/).filter(([, , body]) => /animation:\s*none/.test(body!));
    // Both must exist: if the theme drops its animation, this override is dead weight and the test says delete it.
    expect(theme).toHaveLength(1);
    expect(ours).toHaveLength(1);
    expect(specificity(ours[0]![1]!)).toBeGreaterThan(specificity(theme[0]![1]!));
  });

  it("the finder is red for a stylesheet without the override", () => {
    expect(rulesWithAnimation(".ocx-platform[data-astro-cid-x]{animation:ocx-platform-in 1s}", /^\[data-grid\] \.ocx-platform/)).toHaveLength(0);
  });
});

describe("D-034 many indexes: the scope bar keeps six tabs and the rest sit behind a +N popover", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  it("D-034 nine indexes render all plus six tabs, and three options in the popover that carry the same labels and counts", async () => {
    const project = await createProject();
    projects.push(project);
    const labels = Array.from({ length: 8 }, (_, i) => `ix${i + 1}`);
    for (const label of labels) {
      await cp(join(project.dir, "index"), join(project.dir, label), { recursive: true });
      // A source's label is the prefix its package names carry.
      for (const root of (await readdir(join(project.dir, label, "p"), { recursive: true })).filter((f) => /^[^/]+\/[^/]+\.json$/.test(f.split("\\").join("/")))) {
        const file = join(project.dir, label, "p", root);
        await writeFile(file, (await readFile(file, "utf8")).replace('"name": "ocx.sh/', `"name": "${label}/`));
      }
    }
    const config = JSON.parse(await readFile(project.config, "utf8")) as { sources: unknown[] };
    config.sources = [{ path: "./index", root: true }, ...labels.map((label) => ({ path: `./${label}`, label }))];
    await writeFile(project.config, JSON.stringify(config));
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);

    const doc = await readHtml(project.out, "/");
    const tabs = [...doc.querySelectorAll("[data-grid-scope] [data-part='item']")].map((item) => item.textContent?.trim());
    expect(tabs).toHaveLength(7);
    expect(tabs[0]).toMatch(/^all \(/);
    const options = [...doc.querySelectorAll("[data-grid-scope-option]")];
    expect(options).toHaveLength(3);
    expect(doc.querySelector("[data-grid-scope-more]")?.textContent).toContain("+3");
    for (const option of options) expect(option.textContent).toMatch(/^\s*ix\d+/);
  }, 180_000);
});

describe("L-grid wave B: logo tile, install button and copy menu as built", () => {
  it("D-009 D-035 a server card paints its initials under the logo, which is lazy and carries no inline handler", async () => {
    const doc = await readHtml(site("root"), "/");
    const tile = doc.querySelector('[data-key="index-a/cloud/kubectl-lite"] .ocx-logo-tile')!;
    expect(tile.getAttribute("data-state")).toBe("loading");
    expect(tile.querySelector(".ocx-logo-tile__initials")?.textContent).toBe("KL");
    const image = tile.querySelector(".ocx-logo-tile__image")!;
    expect(image.getAttribute("loading")).toBe("lazy");
    expect([...image.attributes].filter((attr) => attr.name.startsWith("on"))).toEqual([]);
    expect(doc.querySelector('[data-key="index-a/cloud/helm-lite"] .ocx-logo-tile')?.getAttribute("data-state")).toBe("fallback");
  });

  it("D-011 every tile carries a hue index, and the built stylesheets resolve the theme's monogram tokens", async () => {
    const dir = site("root");
    const doc = await readHtml(dir, "/");
    const hues = [...doc.querySelectorAll("[data-grid-cards] .ocx-logo-tile")].map((tile) => tile.getAttribute("data-hue"));
    expect(hues.length).toBeGreaterThan(0);
    for (const hue of hues) expect(hue).toMatch(/^[0-3]$/);
    const css = (await Promise.all((await readdir(join(dir, "_astro"))).filter((f) => f.endsWith(".css")).map((f) => readFile(join(dir, "_astro", f), "utf8")))).join("\n");
    for (const n of [0, 1, 2, 3]) expect(css, `monogram ${n}`).toContain(`--ocx-color-monogram-${n}`);
  });

  it("D-038 the card and row templates carry the empty tile, with the cube", async () => {
    const doc = await readHtml(site("root"), "/");
    for (const name of ["data-grid-card", "data-grid-row"]) {
      const tile = doc.querySelector<HTMLTemplateElement>(`template[${name}]`)!.content.querySelector(".ocx-logo-tile")!;
      expect(tile.getAttribute("data-state"), name).toBe("empty");
      expect(tile.querySelector(".ocx-logo-tile__cube svg"), name).not.toBeNull();
    }
  });

  it("D-001 every server card ends in a copy button for its command: a real Tab stop with the hint, the command and one copy icon", async () => {
    const doc = await readHtml(site("root"), "/");
    const card = doc.querySelector('[data-key="index-a/cloud/helm-lite"]')!;
    const button = card.querySelector<HTMLButtonElement>("button[data-grid-install]")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("tabindex")).toBe(false);
    expect(button.getAttribute("title")).toBe("Click to copy install command · right-click for more");
    // The `$` prompt is drawn by the stylesheet (grid_styles.test.ts), not an element: a card is a node lighter.
    expect(button.querySelector(".install-prefix")).toBeNull();
    expect(button.querySelector('[data-field="install"]')?.textContent).toBe("ocx add index-a/cloud/helm-lite");
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(doc.querySelectorAll("[data-grid-cards] a[data-card]")).toHaveLength(doc.querySelectorAll("[data-grid-cards] [data-grid-install]").length);
  });

  it("D-002 one copy menu wraps both lists, offers the seven entries, and every card carries its texts", async () => {
    const doc = await readHtml(site("root"), "/");
    const menus = doc.querySelectorAll('[data-zag-root="copy-menu"][data-context]');
    expect(menus).toHaveLength(1);
    const menu = menus[0]!;
    expect(menu.querySelector("[data-grid-cards]")).not.toBeNull();
    expect(menu.querySelector("[data-grid-table]")).not.toBeNull();
    expect([...menu.querySelectorAll('[data-part="item"]')].map((item) => item.textContent?.trim())).toEqual([
      "Copy identifier",
      "Copy tag",
      "Copy link",
      "Add to project",
      "Add globally",
      "Run without installing",
      "Install package",
    ]);
    const hosts = [...doc.querySelectorAll<HTMLElement>("[data-grid-cards] a[data-card]")];
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      const texts = JSON.parse(host.dataset.copy!) as Record<string, string>;
      expect(texts["project"], host.dataset.key).toMatch(new RegExp(`^ocx add ${host.dataset.key}(:|$)`));
      expect(texts["identifier"]!.startsWith(host.dataset.key!)).toBe(true);
    }
    // The server knows no origin: the link is the island's to add.
    expect(Object.keys(JSON.parse(hosts[0]!.dataset.copy!))).not.toContain("link");
    for (const name of ["data-grid-card", "data-grid-row"]) {
      expect(doc.querySelector<HTMLTemplateElement>(`template[${name}]`)!.content.querySelector("a[data-card][data-copy]"), name).not.toBeNull();
    }
  });
});
