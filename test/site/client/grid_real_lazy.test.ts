// @vitest-environment happy-dom
//
// The grid island on the REAL `@ocx-sh/theme/lazy` (L.4, C-011): the double in the other grid tests
// plays the trigger by hand; this file lets the theme's own trigger layer arm, load and start the
// island, so a drift between our `LazyMount` shape and the theme's shows up here.
import { mount as themeMount } from "@ocx-sh/theme/lazy";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mount } from "../../../src/site/client/grid_entry.js";
import type { LazyMount } from "../../../src/site/client/mount.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { gridDom } from "./grid_dom.js";

const catalog = {
  generated: null,
  packages: [
    { namespace: "x", package: "one", name: "a/x/one", status: "active", deprecatedMessage: null, supersededBy: null, created: null, updated: null, title: "one", description: "", keywords: [], latestVersion: "1.0.0", tagCount: 1, platforms: ["linux/amd64"], logoUrl: null, readmeUrl: null },
    { namespace: "x", package: "two", name: "a/x/two", status: "active", deprecatedMessage: null, supersededBy: null, created: null, updated: null, title: "two", description: "", keywords: [], latestVersion: "1.0.0", tagCount: 1, platforms: ["windows/amd64"], logoUrl: null, readmeUrl: null },
  ],
};

let destroy: (() => void) | undefined;
let loads: ReturnType<typeof vi.fn>;
let fetch: ReturnType<typeof vi.fn<FetchLike>>;
/** The theme's `mount`, counting how often the island's lazy part is asked for. */
let lazy: LazyMount;

beforeEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  loads = vi.fn();
  fetch = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => catalog }));
  lazy = {
    mount: (root, spec) =>
      themeMount(root, {
        ...spec,
        load: () => {
          loads();
          return spec.load();
        },
      }),
  };
});

afterEach(() => {
  destroy?.();
  destroy = undefined;
});

test("nothing loads before the first interaction, then one load and one catalog request, however many events follow", async () => {
  const dom = gridDom();
  destroy = mount(dom.root, { lazy, fetch }).destroy;
  expect(dom.root.dataset.zagState).toBeUndefined();
  expect(loads).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  dom.root.dispatchEvent(new Event("pointerenter"));
  dom.root.dispatchEvent(new Event("focusin"));
  dom.root.dispatchEvent(new Event("touchstart"));
  await vi.waitFor(() => expect(dom.cards.querySelectorAll("a[data-card]")).toHaveLength(2));

  expect(dom.root.dataset.zagState).toBe("live");
  expect(loads).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an activation before the load reaches the island once: the eager handler took it and the theme does not replay it", async () => {
  const dom = gridDom();
  destroy = mount(dom.root, { lazy, fetch }).destroy;
  const linux = document.querySelector<HTMLElement>('[data-grid-platform="linux"]')!;

  dom.root.dispatchEvent(new Event("pointerenter"));
  linux.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(dom.cards.querySelectorAll("a[data-card]")).toHaveLength(1));

  expect(linux.getAttribute("aria-pressed")).toBe("true");
  expect(loads).toHaveBeenCalledTimes(1);
});

test("a cold URL that carries state boots at load without any interaction", async () => {
  history.replaceState(null, "", "/?q=one");
  const dom = gridDom();
  destroy = mount(dom.root, { lazy, fetch }).destroy;

  await vi.waitFor(() => expect(dom.cards.querySelectorAll("a[data-card]")).toHaveLength(1));
  expect(loads).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
