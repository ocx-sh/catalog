/**
 * S-009 / C-019 server-rendered palette (plan step K.2): every page carries the
 * header trigger (`ui/Kbd` Mod+K) and a CLOSED theme dialog holding the
 * SearchField and async List the island (`client/palette.ts`) drives, with
 * `data-base` on the mount root. Nothing references the search index before
 * interaction (C-011): the island fetches `catalog.json` itself, on first open.
 *
 * Needs the `root` (base `/`) and `catalog` (base `/catalog/`) sites:
 * `ACCEPT_CONFIG=root,catalog`.
 */
import { describe, expect, it } from "vitest";
import { htmlRoutes, pageScripts, readHtml, site, type SiteName } from "./helpers.js";

const SITES: readonly (readonly [SiteName, string])[] = [
  ["root", "/"],
  ["catalog", "/catalog/"],
];

/** One page of each kind: landing, a package detail route, the 404. */
async function pages(name: SiteName): Promise<[string, string][]> {
  const detail = (await htmlRoutes(site(name))).find((route) => route !== "docs" && !route.startsWith("docs/"));
  expect(detail, `${name}: a package route`).toBeDefined();
  return [
    ["landing", "/"],
    ["detail", `/${detail}`],
    ["404", "404.html"],
  ];
}

describe.each(SITES)("%s: the server-rendered palette", (name, base) => {
  it.each(["landing", "detail", "404"])("%s page: trigger, closed dialog, async list, no index reference", async (kind) => {
    const urlPath = (await pages(name)).find(([k]) => k === kind)![1];
    const doc = await readHtml(site(name), urlPath);

    const root = doc.querySelector<HTMLElement>(".ocx-palette");
    expect(doc.querySelectorAll(".ocx-palette")).toHaveLength(1);
    expect(root?.dataset.base).toBe(base);

    // The trigger sits in the header row (the Shell `header-search` slot) with the Mod+K keycap.
    const trigger = root!.querySelector<HTMLElement>("[data-palette-trigger]");
    expect(trigger?.closest(".ocx-header")).not.toBeNull();
    expect(trigger?.querySelector(".ocx-kbd-group")?.textContent).toContain("K");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");

    // The dialog exists once, keyed by data-zag-id, and renders closed.
    const dialogs = root!.querySelectorAll<HTMLElement>('[data-zag-root="dialog"]');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0]!;
    expect(dialog.dataset.zagId).toBeTruthy();
    expect(JSON.parse(dialog.dataset.zagProps!)).toMatchObject({ defaultOpen: false });
    expect(dialog.querySelector('[data-part="content"]')?.hasAttribute("hidden")).toBe(true);

    // The island's other contract elements live inside the dialog.
    expect(dialog.querySelector('input[type="search"][data-autofocus]')).not.toBeNull();
    const list = dialog.querySelector<HTMLElement>('[data-zag-root="listbox"]');
    expect(list?.hasAttribute("data-ocx-async")).toBe(true);
    expect(list?.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(list?.querySelector(".ocx-list__empty")?.textContent).toBe("");
    const status = dialog.querySelector("[data-palette-status]");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("");

    // C-011: no search index or catalog URL in the page before interaction.
    expect(doc.documentElement.outerHTML).not.toContain("catalog.json");
  });

  it.each(["landing", "detail", "404"])("%s page: the module script mounts the palette on the theme's lazy mount, with no modulepreload", async (kind) => {
    const urlPath = (await pages(name)).find(([k]) => k === kind)![1];
    const dir = site(name);
    const { scripts, preloads, mentionsCatalog } = await pageScripts(dir, await readHtml(dir, urlPath), base);

    const island = scripts.filter(({ code }) => code.includes(".ocx-palette") && code.includes("zagState"));
    expect(island, "a page script that mounts the palette on the theme's lazy mount").toHaveLength(1);
    // MiniSearch (`fuzzyGet` is one of its methods) is the lazy chunk: not in the script or its static imports.
    expect(island[0]!.code).not.toContain("fuzzyGet");
    expect(preloads).toBe(0);
    expect(mentionsCatalog).toBe(false);
  });

  it("no page repeats an id (the palette adds ids to every shell page)", async () => {
    for (const [kind, urlPath] of await pages(name)) {
      const doc = await readHtml(site(name), urlPath);
      const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), `${name} ${kind}`).toEqual([]);
    }
  });
});
