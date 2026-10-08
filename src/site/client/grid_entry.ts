/**
 * The grid island's entry (L.4, C-033). `CatalogGrid.astro` renders `[data-grid]`
 * and its script calls `mount(el, { lazy })` with the theme's `mount`. `base` comes
 * from the root's `data-base` unless `opts.base` says otherwise.
 */
import { mountGrid, type GridOptions } from "./grid.js";
import type { LazyMount } from "./mount.js";

export interface GridEntryOptions extends GridOptions {
  readonly lazy: LazyMount;
}

export function mount(el: HTMLElement, { lazy, ...options }: GridEntryOptions): { destroy(): void } {
  return mountGrid(el, lazy, options);
}
