// @vitest-environment happy-dom
//
// The grid and the palette are separate lazy chunks that both read
// `catalog.json`. They must meet in one shared loader: one request, one parsed
// array (so one MiniSearch index in `filterPackages`), and still nothing
// requested before the first interaction (C-011).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountGrid } from "../../../src/site/client/grid.js";
import { mountPalette } from "../../../src/site/client/palette.js";
import type { CatalogData, FetchLike } from "../../../src/site/lib/wireTypes.js";
import { gridDom } from "./grid_dom.js";
import { createLazyDouble } from "./lazy_double.js";

const CATALOG: CatalogData = {
  generated: null,
  packages: [
    {
      namespace: "x",
      package: "one",
      name: "a/x/one",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: null,
      updated: null,
      title: "one",
      description: "",
      keywords: [],
      latestVersion: "1.0.0",
      tagCount: 1,
      platforms: ["linux/amd64"],
      logoUrl: null,
      readmeUrl: null,
    },
  ],
};

let unmount: Array<() => void> = [];

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal("IntersectionObserver", undefined);
});

afterEach(() => {
  for (const stop of unmount) stop();
  unmount = [];
  vi.unstubAllGlobals();
});

function paletteRoot(): { root: HTMLElement; dialog: HTMLElement } {
  const root = document.createElement("div");
  root.dataset.base = "/";
  root.innerHTML = `
    <button type="button" data-palette-trigger></button>
    <div data-zag-root="dialog" data-zag-id="palette-dialog">
      <input type="search"><p data-palette-status></p><div data-zag-root="listbox"></div>
    </div>`;
  document.body.append(root);
  return { root, dialog: root.querySelector<HTMLElement>('[data-zag-root="dialog"]')! };
}

test("opening the palette after the grid has loaded fetches catalog.json once, not twice", async () => {
  const fetch = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => CATALOG }));
  const gridLazy = createLazyDouble();
  const paletteLazy = createLazyDouble();

  const grid = gridDom({ ssrCards: ["a/x/one"] });
  unmount.push(mountGrid(grid.root, gridLazy, { fetch }).destroy);
  const { root, dialog } = paletteRoot();
  unmount.push(mountPalette(root, paletteLazy, { fetch }).destroy);
  expect(fetch).not.toHaveBeenCalled();

  await gridLazy.mounts[0]?.fire();
  await vi.waitFor(() => expect(grid.skeleton.hidden).toBe(true));
  expect(fetch).toHaveBeenCalledTimes(1);

  await paletteLazy.mounts[0]?.fire();
  dialog.dispatchEvent(new CustomEvent("ocx:dialog:change", { detail: { open: true } }));
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetch).toHaveBeenCalledTimes(1);
});
