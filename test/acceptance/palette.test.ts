/**
 * S-009 / C-019 server-rendered palette: every page carries the theme's `CommandPalette` — the header
 * trigger and a CLOSED "Search" dialog — inside the catalog's `.ocx-palette` wrapper (`data-base`, and
 * `data-docs` when a docs mount exists). Nothing references the search index before interaction
 * (C-011): the page script mounts the palette and the dialog machine, the filter and `catalog.json`
 * load on the first open. The behaviours of D-094..D-107 that need a browser are the real-browser
 * gate's (`scripts/quality-palette.mjs`); what is pinned here is the built markup, CSS and scripts
 * that carry them.
 *
 * Needs the `root` (base `/`) and `catalog` (base `/catalog/`) sites:
 * `ACCEPT_CONFIG=root,catalog`.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlRoutes, pageScripts, readHtml, site, type SiteName } from "./helpers.js";

const SITES: readonly (readonly [SiteName, string])[] = [
  ["root", "/"],
  ["catalog", "/catalog/"],
];

/** One page of each kind: landing, a package detail route, the 404 and (when mounted) a docs page. */
async function pages(name: SiteName): Promise<[string, string][]> {
  const routes = await htmlRoutes(site(name));
  const detail = routes.find((route) => route !== "docs" && !route.startsWith("docs/"));
  expect(detail, `${name}: a package route`).toBeDefined();
  const docs = routes.find((route) => route.startsWith("docs/"));
  return [
    ["landing", "/"],
    ["detail", `/${detail}`],
    ["404", "404.html"],
    ...(docs === undefined ? [] : [["docs", `/${docs}`] as [string, string]]),
  ];
}

/** Every built script other than the page script `src` (its static imports are loaded eagerly, so never lazy). */
async function lazyChunks(siteDir: string, src: string): Promise<string[]> {
  const dir = join(siteDir, "_astro");
  const own = src.split("/").pop();
  const names = (await readdir(dir)).filter((n) => n.endsWith(".js") && n !== own);
  return Promise.all(names.map((n) => readFile(join(dir, n), "utf8")));
}

const KINDS = (name: SiteName): string[] => (name === "root" ? ["landing", "detail", "404", "docs"] : ["landing", "detail", "404"]);

describe.each(SITES)("%s: the server-rendered palette", (name, base) => {
  it.each(KINDS(name))("%s page: one closed CommandPalette, no index reference", async (kind) => {
    const urlPath = (await pages(name)).find(([k]) => k === kind)![1];
    const doc = await readHtml(site(name), urlPath);

    const wrapper = doc.querySelector<HTMLElement>(".ocx-palette");
    expect(doc.querySelectorAll(".ocx-palette")).toHaveLength(1);
    expect(wrapper?.dataset.base).toBe(base);
    expect(wrapper?.hasAttribute("data-docs")).toBe(name === "root");

    expect(doc.querySelectorAll(".ocx-cmdpalette")).toHaveLength(1);
    const palette = wrapper!.querySelector<HTMLElement>(".ocx-cmdpalette")!;
    expect(palette.dataset.zagRoot).toBe("dialog");
    expect(palette.dataset.zagTrigger).toBe("manual");
    expect(palette.dataset.zagId).toBeTruthy();
    expect(JSON.parse(palette.dataset.zagProps!)).toMatchObject({ defaultOpen: false });
    expect(palette.querySelector('[data-part="content"]')?.hasAttribute("hidden")).toBe(true);
    expect(palette.querySelectorAll('[role="option"]')).toHaveLength(0);

    // The trigger sits in the header row (the Shell `header-search` slot).
    expect(palette.querySelector("[data-cmdpalette-trigger]")?.closest(".ocx-header")).not.toBeNull();
    // C-011: no search index or catalog URL in the palette (the footer's "catalog json" link is a plain link).
    expect(wrapper!.outerHTML).not.toContain("catalog.json");
    expect(doc.documentElement.outerHTML).not.toContain("docs-index.json");
  });

  it.each(KINDS(name))("D-094 %s page: the palette carries no \"/\" opt-out in markup; the grid root is on the landing page only", async (kind) => {
    const urlPath = (await pages(name)).find(([k]) => k === kind)![1];
    const doc = await readHtml(site(name), urlPath);

    // `mountPalette` answers false to "/" exactly when `[data-grid]` is on the page (unit-tested); the
    // built pages must put that root on the landing page and nowhere else.
    expect(doc.querySelectorAll("[data-grid]").length > 0).toBe(kind === "landing");
  });

  it("D-096 the dialog is named \"Search\" with a visually hidden description", async () => {
    const doc = await readHtml(site(name), "/");
    const palette = doc.querySelector<HTMLElement>(".ocx-cmdpalette")!;

    const title = palette.querySelector('[data-part="title"]');
    expect(title?.textContent?.trim()).toBe("Search");
    expect(title?.classList.contains("ocx-cmdpalette__sr")).toBe(true);
    const description = palette.querySelector('[data-part="description"]');
    expect(description?.classList.contains("ocx-cmdpalette__sr")).toBe(true);
    expect(description?.textContent).toContain("Use the arrow keys and Enter");
    expect(palette.querySelector('[data-part="content"]')?.getAttribute("aria-describedby")).toBe(description?.id);
  });

  it("D-097 D-107 the trigger has a viewport-independent name, the shortcut and an OS-aware keycap", async () => {
    const doc = await readHtml(site(name), "/");
    const trigger = doc.querySelector<HTMLElement>("[data-cmdpalette-trigger]")!;

    expect(trigger.getAttribute("aria-label")).toBe("Search packages");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    const keycap = trigger.querySelector(".ocx-kbd-group");
    expect(keycap?.textContent).toContain("K");
    expect(keycap?.querySelector('[data-os="mac"]')?.textContent).toContain("⌘");
    expect(keycap?.querySelector('[data-os="windows"]')?.textContent).toContain("Ctrl");
  });

  it("D-107 every page sets data-platform before paint, with iPhone and iPad counted as Apple platforms", async () => {
    const doc = await readHtml(site(name), "/");
    const inline = [...doc.querySelectorAll("script:not([src])")].map((el) => el.textContent ?? "").join("\n");

    expect(inline).toContain("mac|iphone|ipad|ipod");
  });

  it("D-100 the empty-query hint is rendered and visible", async () => {
    const doc = await readHtml(site(name), "/");
    const hint = doc.querySelector<HTMLElement>("[data-cmdpalette-hint]");

    expect(hint?.textContent?.trim()).toBe("Search packages by name or keyword, or documentation by title.");
    expect(hint?.hasAttribute("hidden")).toBe(false);
  });

  it("D-103 D-174 the input is a combobox that does not autocorrect, with the packages-and-docs placeholder", async () => {
    const doc = await readHtml(site(name), "/");
    const input = doc.querySelector<HTMLInputElement>("[data-cmdpalette-input]")!;

    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("placeholder")).toBe("Search packages and docs…");
  });

  it("D-101 results are rendered into a listbox of real links (none server-side, role=option rows come from the theme)", async () => {
    const doc = await readHtml(site(name), "/");
    const list = doc.querySelector("[data-cmdpalette-list]");

    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.hasAttribute("hidden")).toBe(true);
    expect(list?.children).toHaveLength(0);
  });

  it("D-104 the close button reads \"Esc\"", async () => {
    const doc = await readHtml(site(name), "/");

    expect(doc.querySelector("[data-cmdpalette-close]")?.textContent?.trim()).toBe("Esc");
  });

  it("D-105 the built stylesheet seats the card 12vh from the top at min(90vw, 560px), results scrolling alone", async () => {
    const dir = join(site(name), "_astro");
    const css = (await Promise.all((await readdir(dir)).filter((n) => n.endsWith(".css")).map((n) => readFile(join(dir, n), "utf8")))).join("\n");

    expect(css).toMatch(/12vh/);
    expect(css).toMatch(/min\(90vw,\s*560px\)/);
    expect(css).toMatch(/\.ocx-cmdpalette__results\s*\{[^}]*overflow/);
  });

  it.each(KINDS(name))("D-106 %s page: Mod+K lives in the page script; the dialog machine, the filter and the catalog wait for the first open", async (kind) => {
    const urlPath = (await pages(name)).find(([k]) => k === kind)![1];
    const dir = site(name);
    const { scripts, preloads } = await pageScripts(dir, await readHtml(dir, urlPath), base);

    const island = scripts.filter(({ code }) => code.includes(".ocx-palette") && code.includes("data-cmdpalette-trigger"));
    expect(island, "a page script that mounts the palette").toHaveLength(1);
    // MiniSearch (`fuzzyGet` is one of its methods) and the dialog machine are lazy chunks.
    expect(island[0]!.code).not.toContain("fuzzyGet");
    expect(island[0]!.code).not.toContain("trapFocus");
    // Control: the markers do exist in the build, in lazy chunks, so their absence above is a real result.
    const chunks = await lazyChunks(dir, island[0]!.src);
    expect(chunks.some((code) => code.includes("fuzzyGet")), "MiniSearch ships in a lazy chunk").toBe(true);
    expect(chunks.some((code) => code.includes("trapFocus")), "the dialog machine ships in a lazy chunk").toBe(true);
    expect(island[0]!.code).toContain("keydown");
    expect(island[0]!.code).not.toContain("catalog.json");
    expect(island[0]!.code).not.toContain("docs-index.json");
    expect(preloads).toBe(0);
  });

  it("no page repeats an id (the palette adds ids to every shell page)", async () => {
    for (const [kind, urlPath] of await pages(name)) {
      const doc = await readHtml(site(name), urlPath);
      const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), `${name} ${kind}`).toEqual([]);
    }
  });
});
