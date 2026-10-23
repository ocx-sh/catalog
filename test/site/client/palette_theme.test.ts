// @vitest-environment jsdom
//
// Drift guard against the REAL theme: `mountPalette` hands the theme's actual `mountCommandPalette`
// (from `node_modules`, not a double) the `{ source, slash }` shape, and the whole path runs on the
// theme's real dialog machine and session — open, type, rows from the catalog's own source module.
// The markup mirrors `CommandPalette.astro`'s SSR (the theme's `ui-command-palette.dom.test.ts` pins
// the same), so a theme change to the option shape, the source contract or the machine fails here
// rather than only in the browser gate (`scripts/quality-palette.mjs`).
import { mountCommandPalette } from "@ocx-sh/theme/command-palette";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mountPalette } from "../../../src/site/client/palette.js";
// The theme exports no path to its Zag machine; the markup helper needs the same SSR attributes the Astro component emits.
import { connect, machine, parts } from "../../../node_modules/@ocx-sh/theme/src/components/ui/dialog.zag.mjs";
import { ssrApi, ssrAttrs } from "../../../node_modules/@ocx-sh/theme/src/components/ui/zag-runtime.mjs";

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const attrs = (a: Record<string, unknown>) =>
  Object.entries(ssrAttrs(a) as Record<string, string | true>)
    .map(([k, v]) => (v === true ? k : `${k}="${String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`))
    .join(" ");

function pkg(name: string, title: string) {
  const [, namespace, ...rest] = name.split("/");
  return {
    namespace,
    package: rest.join("/"),
    name,
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: null,
    updated: null,
    title,
    description: "",
    keywords: [],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}
const CATALOG = { generated: null, packages: [pkg("ocx.sh/tools/widget", "Widget")] };
const DOCS = [
  { id: "guide/widget", href: "/catalog/docs/guide/widget/", title: "Widget guide", crumbs: ["guide"], headings: [], text: "" },
];

function place(extra = ""): void {
  const p = parts(ssrApi(machine, connect, { defaultOpen: false, modal: true, id: "pal" })) as Record<string, Record<string, unknown>>;
  document.body.innerHTML = `${extra}<div class="ocx-palette" data-base="/catalog/" data-docs="">
  <div class="ocx-cmdpalette" data-zag-root="dialog" data-zag-state="idle" data-zag-id="pal"
    data-zag-props='{"defaultOpen":false,"modal":true}' data-zag-trigger="manual"
    data-no-results="No results for “{query}”" data-count="{count} results" data-error="Could not load results. Try again.">
    <button type="button" data-cmdpalette-trigger aria-label="Search packages" aria-expanded="false">Search</button>
    <div ${attrs(p.backdrop!)}></div>
    <div ${attrs(p.positioner!)}>
      <div ${attrs(p.content!)}>
        <h2 ${attrs(p.title!)}>Search</h2>
        <p ${attrs(p.description!)}>Type to search.</p>
        <input type="text" id="pal-input" data-cmdpalette-input role="combobox" aria-expanded="false" aria-controls="pal-list">
        <button type="button" data-cmdpalette-close>Esc</button>
        <p data-cmdpalette-hint>hint</p>
        <p data-cmdpalette-status role="status"></p>
        <div id="pal-list" data-cmdpalette-list role="listbox" hidden></div>
      </div>
    </div>
  </div></div>`;
}

const content = () => document.querySelector<HTMLElement>('[data-part="content"]')!;
const isOpen = () => !content().hasAttribute("hidden");
const key = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

let mounted: { destroy(): void } | undefined;
const fetchStub = vi.fn(async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => (String(url).endsWith("docs-index.json") ? DOCS : CATALOG),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  fetchStub.mockClear();
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("the real theme palette opens, loads the catalog source lazily and lists packages and docs as links", async () => {
  place();
  mounted = mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette);
  expect(fetchStub).not.toHaveBeenCalled();

  document.querySelector<HTMLElement>("[data-cmdpalette-trigger]")!.click();
  await until(isOpen);
  await until(() => fetchStub.mock.calls.length === 2);
  const input = document.querySelector<HTMLInputElement>("[data-cmdpalette-input]")!;
  input.value = "widget";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => document.querySelectorAll('a[role="option"]').length === 2);

  expect(fetchStub.mock.calls.map(([url]) => url).sort()).toEqual([
    "/catalog/data/catalog/catalog.json",
    "/catalog/data/catalog/docs-index.json",
  ]);
  expect([...document.querySelectorAll(".ocx-cmdpalette__group-label")].map((el) => el.textContent)).toEqual(["Packages", "Docs"]);
  expect([...document.querySelectorAll<HTMLAnchorElement>('a[role="option"]')].map((a) => a.getAttribute("href"))).toEqual([
    "/catalog/tools/widget/",
    "/catalog/docs/guide/widget/",
  ]);
});

test("D-107 on a mac the theme names the shortcut Meta+K, and leaves the markup's Control+K elsewhere", () => {
  place();
  document.querySelector("[data-cmdpalette-trigger]")!.setAttribute("aria-keyshortcuts", "Control+K");
  document.documentElement.dataset.platform = "mac";
  mounted = mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette);
  expect(document.querySelector("[data-cmdpalette-trigger]")!.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
  mounted.destroy();

  delete document.documentElement.dataset.platform;
  place();
  document.querySelector("[data-cmdpalette-trigger]")!.setAttribute("aria-keyshortcuts", "Control+K");
  mounted = mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette);
  expect(document.querySelector("[data-cmdpalette-trigger]")!.getAttribute("aria-keyshortcuts")).toBe("Control+K");
});

test('D-094 the real theme opens on "/" when the page has no grid, and leaves it alone when [data-grid] is present', async () => {
  place();
  mounted = mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette);
  expect(key(document.body, { key: "/" }).defaultPrevented).toBe(true);
  await until(isOpen);
  await until(() => fetchStub.mock.calls.length === 2); // the open's warm-up, settled before the page is torn down
  mounted.destroy();

  place(`<section data-grid></section>`);
  mounted = mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette);
  expect(key(document.body, { key: "/" }).defaultPrevented).toBe(false);
  expect(isOpen()).toBe(false);
});
