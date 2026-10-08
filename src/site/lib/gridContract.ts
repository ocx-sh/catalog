/**
 * Values the server-rendered toolbar (`components/Toolbar.astro`) and the grid
 * island (`client/grid.ts`) must agree on. One module, so a renamed option
 * cannot leave the markup and the listener reading different strings.
 */
import type { SortKey, ViewMode } from "./catalogState.js";

/** Scope control value of the "all" tab: a colon cannot occur in an index label (`^[A-Za-z0-9._-]+$`). */
export const ALL_SCOPE_VALUE = ":all";

/** Entries (all included) up to which the scope is a `ToggleGroup`; more become a `Select`. */
export const SCOPE_TABS_MAX = 5;

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  name: "name",
  updated: "recent",
  created: "newest",
};

export const VIEW_LABELS: Readonly<Record<ViewMode, { label: string; icon: "blocks" | "menu" }>> = {
  cards: { label: "Cards", icon: "blocks" },
  table: { label: "Table", icon: "menu" },
};
