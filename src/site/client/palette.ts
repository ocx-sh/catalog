/**
 * The ⌘K command palette, eager half (S-009, C-019). Markup, Mod+K and "/",
 * focus, the listbox and every a11y attribute belong to the theme's
 * `CommandPalette` and its `mountCommandPalette` (`@ocx-sh/theme/command-palette`);
 * this file only binds the catalog's two decisions to it: where the search
 * lives (`palette_source.ts`, a dynamic `import()` so the dialog machine, the
 * filter and `catalog.json` all wait for the first open, C-011) and when "/"
 * is the palette's (never on the page whose grid already claims it).
 *
 * The binding is passed in: `Palette.astro` hands over the real
 * `mountCommandPalette`; the option types are the theme's own.
 */
import type { PaletteOptions } from "@ocx-sh/theme/command-palette";
import { requireEl } from "../lib/dom.js";

export type MountCommandPalette = (root: HTMLElement, options: PaletteOptions) => { destroy(): void };

/** The grid island's root: the landing page, where "/" focuses the grid's filter instead. */
const GRID = "[data-grid]";

/** Wires the `.ocx-palette` wrapper's `CommandPalette` through the theme's `mountCommandPalette`. */
export function mountPalette(wrapper: HTMLElement, mountCommandPalette: MountCommandPalette): { destroy(): void } {
  return mountCommandPalette(requireEl<HTMLElement>(wrapper, ".ocx-cmdpalette", "palette"), {
    source: () => import("./palette_source.js"),
    slash: () => document.querySelector(GRID) === null,
  });
}
