/**
 * Shared scaffolding for the grid island suites that sit beside `grid.test.ts`
 * (D-tagged parity rows). Each suite imports what it needs and keeps its own
 * assertions inline; only the builders and the lifecycle live here.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
// The theme's own idle setters: the page registers them on the document (ToggleGroup.astro, Select.astro), so a control
// the grid sets by event changes here exactly as it does there. The package exports no path to this module.
import { onSelectSet, onToggleGroupSet } from "../../../node_modules/@ocx-sh/theme/src/components/ui/value-set.mjs";
import { mountGrid, type GridOptions } from "../../../src/site/client/grid.js";
import type { CatalogData, CatalogIndexInfo, CatalogPackage, FetchLike } from "../../../src/site/lib/wireTypes.js";
import type { Dom } from "./grid_dom.js";
import { createLazyDouble, type LazyDouble } from "./lazy_double.js";

export function pkg(name: string, overrides: Partial<CatalogPackage> = {}): CatalogPackage {
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

export const index = (name: string, overrides: Partial<CatalogIndexInfo> = {}): CatalogIndexInfo => ({
  name,
  root: false,
  default: false,
  count: 0,
  ...overrides,
});

export const catalog = (packages: CatalogPackage[], indexes?: CatalogIndexInfo[]): CatalogData => ({
  generated: null,
  packages,
  ...(indexes && { indexes }),
});

/** A fetch answering every URL with `body`. */
export const answering = (body: CatalogData, status = 200) =>
  vi.fn<FetchLike>(async () => ({ ok: status < 400, status, json: async () => body }));

export const keys = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("a[data-card]")].map((a) => a.dataset.key);
export const text = (el: Element | null | undefined) => el?.textContent?.trim();
export const chipsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-grid-chip]")];
export const chipNames = (el: HTMLElement) => chipsOf(el).map((chip) => chip.dataset.keyword);
export const pressed = (el: Element | null) => el?.getAttribute("aria-pressed") === "true";

export function emit(target: Element, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}
export const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
export const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
export const platformChip = (os: string) => document.querySelector<HTMLElement>(`[data-grid-platform="${os}"]`)!;
export const statusChip = (status: string) => document.querySelector<HTMLElement>(`[data-grid-status="${status}"]`)!;
export const pickView = (view: string) => emit(document.querySelector("[data-grid-view] [data-zag-root]")!, "ocx:toggle-group:change", { value: [view] });
export const pickSort = (sort: string) => emit(document.querySelector("[data-grid-sort] [data-zag-root]")!, "ocx:select:change", { value: sort });
export const pickScope = (value: string) =>
  emit(document.querySelector("[data-grid-scope] [data-zag-root]")!, "ocx:toggle-group:change", { value: [value] });

/** Lets the lazy `import()` and the fetch/render promise chain settle after a trigger. */
export const settle = async () => {
  await vi.waitFor(() => expect(document.querySelector("[data-grid-skeleton]")?.hasAttribute("hidden")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** An IntersectionObserver that records what it is asked to do, in order. */
export class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly calls: string[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: (entries: { isIntersecting: boolean }[]) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.calls.push("observe");
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.calls.push("unobserve");
    this.observed = this.observed.filter((entry) => entry !== el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting = true) {
    this.callback([{ isIntersecting }]);
  }
}

export interface GridRun {
  lazy: LazyDouble;
  /** Mounts the grid, fires the first interaction and waits for the first render. */
  open(dom: Dom, data: CatalogData | FetchLike, options?: GridOptions): Promise<ReturnType<typeof answering>>;
  /** Mounts without firing anything. */
  mount(dom: Dom, data: CatalogData | FetchLike, options?: GridOptions): ReturnType<typeof answering>;
}

/** Registers the per-test lifecycle every grid suite needs and returns the run handle. */
export function useGridRun(): GridRun {
  const run = { lazy: createLazyDouble() } as GridRun;
  let unmount: (() => void) | undefined;
  const mount: GridRun["mount"] = (dom, data, options = {}) => {
    const fetch = typeof data === "function" ? data : answering(data);
    unmount = mountGrid(dom.root, run.lazy, { fetch, ...options }).destroy;
    return fetch as ReturnType<typeof answering>;
  };
  run.mount = mount;
  run.open = async (dom, data, options) => {
    const fetch = mount(dom, data, options);
    await run.lazy.mounts[0]?.fire();
    await settle();
    return fetch;
  };
  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    delete document.documentElement.dataset.catalogView;
    delete document.documentElement.dataset.catalogWait;
    history.replaceState(null, "", "/");
    localStorage.clear();
    run.lazy = createLazyDouble();
    FakeObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    document.addEventListener("ocx:toggle-group:set", onToggleGroupSet);
    document.addEventListener("ocx:select:set", onSelectSet);
  });
  afterEach(() => {
    document.removeEventListener("ocx:toggle-group:set", onToggleGroupSet);
    document.removeEventListener("ocx:select:set", onSelectSet);
    unmount?.();
    unmount = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  return run;
}
