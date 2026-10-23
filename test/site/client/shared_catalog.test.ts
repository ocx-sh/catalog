// @vitest-environment happy-dom
//
// The grid and the palette source are separate lazy chunks that both read
// `catalog.json`. They must meet in one shared loader: one request, one parsed
// array (so one MiniSearch index in `filterPackages`), and still nothing
// requested before the first interaction (C-011).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountGrid } from "../../../src/site/client/grid.js";
import { createPaletteSource } from "../../../src/site/client/palette_source.js";
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

test("opening the palette after the grid has loaded fetches catalog.json once, not twice", async () => {
  const fetch = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => CATALOG }));
  const gridLazy = createLazyDouble();

  const grid = gridDom({ ssrCards: ["a/x/one"] });
  unmount.push(mountGrid(grid.root, gridLazy, { fetch }).destroy);
  const palette = createPaletteSource({ base: "/", docs: false, fetch });
  expect(fetch).not.toHaveBeenCalled();

  await gridLazy.mounts[0]?.fire();
  await vi.waitFor(() => expect(grid.skeleton.hidden).toBe(true));
  expect(fetch).toHaveBeenCalledTimes(1);

  await palette.warm();
  await palette.search("one", new AbortController().signal);

  expect(fetch).toHaveBeenCalledTimes(1);
});
