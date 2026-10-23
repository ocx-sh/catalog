/**
 * Values the server-rendered toolbar (`components/Toolbar.astro`) and the grid
 * island (`client/grid.ts`) must agree on. One module, so a renamed option
 * cannot leave the markup and the listener reading different strings.
 */
import type { SortKey, ViewMode } from "./catalogState.js";

/** Scope control value of the "all" tab: a colon cannot occur in an index label (`^[A-Za-z0-9._-]+$`). */
export const ALL_SCOPE_VALUE = ":all";

/** Indexes shown as tabs after "all"; the rest sit behind the "+N" popover (D-034). */
export const SCOPE_INLINE_MAX = 6;

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  name: "name",
  updated: "recent",
  created: "newest",
};

export const VIEW_LABELS: Readonly<Record<ViewMode, { label: string; icon: "blocks" | "menu" }>> = {
  cards: { label: "Cards", icon: "blocks" },
  table: { label: "Table", icon: "menu" },
};

/** How many placeholders the loading skeleton stamps (D-024). */
export const SKELETON_COUNT = 9;

/** Canonical display order of the OSes with a glyph (the toolbar's platform chips, the cards' glyphs). */
export const OS_ORDER = ["linux", "darwin", "windows"];

/**
 * How many items the catalog builds at a time.
 *
 * 48 covers a tall viewport of either shape with room over: table rows are ~40px, and the card grid is three or
 * four across at the 300px minimum track. Small enough that the first paint is cheap, large enough that a reader
 * on an ordinary screen never sees the second slice arrive. Here, not in `windowing.ts`: the grid's eager entry
 * needs this number and nothing else of that module, and a bundler places a module whole.
 */
export const WINDOW_SIZE = 48;
