// @vitest-environment happy-dom
//
// The entry contract of the grid island (L.4): `mount` is the export a trigger
// wiring calls, `data-base` is read from the root, one trigger starts exactly
// one load, and an activation that came in before the load is delivered once.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LazyMount } from "../../../src/site/client/mount.js";
import { mount } from "../../../src/site/client/grid_entry.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { gridDom } from "./grid_dom.js";
import { createLazyDouble, type LazyDouble } from "./lazy_double.js";

const catalog = {
  generated: null,
  packages: [
    { namespace: "x", package: "one", name: "a/x/one", status: "active", deprecatedMessage: null, supersededBy: null, created: null, updated: null, title: "one", description: "", keywords: [], latestVersion: "1.0.0", tagCount: 1, platforms: ["linux/amd64"], logoUrl: null, readmeUrl: null },
    { namespace: "x", package: "two", name: "a/x/two", status: "active", deprecatedMessage: null, supersededBy: null, created: null, updated: null, title: "two", description: "", keywords: [], latestVersion: "1.0.0", tagCount: 1, platforms: ["windows/amd64"], logoUrl: null, readmeUrl: null },
  ],
};

let lazy: LazyDouble;
let destroy: (() => void) | undefined;

beforeEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  lazy = createLazyDouble();
});

afterEach(() => {
  destroy?.();
  destroy = undefined;
});

const answering = () => vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => catalog }));

test("mount takes the lazy seam in its options and registers one non-replaying interaction mount", () => {
  const dom = gridDom();
  destroy = mount(dom.root, { lazy, fetch: answering() }).destroy;
  expect(lazy.mounts).toHaveLength(1);
  expect(lazy.mounts[0]?.root).toBe(dom.root);
  expect(lazy.mounts[0]?.spec).toMatchObject({ trigger: "interaction", replay: false });
});

test("the base comes from data-base, so the catalog URL follows the deployment prefix", async () => {
  const dom = gridDom({ base: "/catalog/" });
  const fetch = answering();
  destroy = mount(dom.root, { lazy, fetch }).destroy;
  await lazy.mounts[0]?.fire();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/catalog/data/catalog/catalog.json"));
});

test("one trigger gives exactly one load and one catalog request, and nothing loads before it", async () => {
  const dom = gridDom();
  const fetch = answering();
  const loads = vi.fn();
  const counting: LazyMount = {
    mount: (root, spec) =>
      lazy.mount(root, {
        ...spec,
        load: () => {
          loads();
          return spec.load();
        },
      }),
  };
  destroy = mount(dom.root, { lazy: counting, fetch }).destroy;
  expect(loads).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  await lazy.mounts[0]?.fire();
  await vi.waitFor(() => expect(dom.cards.querySelectorAll("a[data-card]")).toHaveLength(2));
  expect(loads).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an activation before the load is delivered once: the eager handler took it, the mount does not replay it", async () => {
  const dom = gridDom();
  destroy = mount(dom.root, { lazy, fetch: answering() }).destroy;
  const linux = document.querySelector<HTMLElement>('[data-grid-platform="linux"]')!;
  linux.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await lazy.mounts[0]?.fire();
  await vi.waitFor(() => expect(dom.cards.querySelectorAll("a[data-card]")).toHaveLength(1));
  expect(linux.getAttribute("aria-pressed")).toBe("true");
  expect(dom.cards.querySelector("a[data-card]")?.getAttribute("data-key")).toBe("a/x/one");
});
