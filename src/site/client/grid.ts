/**
 * The catalog landing grid island (S-006, C-009, C-011, C-012, C-033). The
 * server renders the first window of cards and the whole toolbar
 * (`components/CatalogGrid.astro`, `Toolbar.astro`); this file takes over on
 * first interaction. It drives markup the theme already renders (`ToggleGroup`,
 * `Select`, `SearchField`, `ToggleButton`, `Popover`, `Tag`) through their
 * documented DOM events only and owns no widget logic of its own.
 *
 * Markup contract, all inside the mount root `[data-grid]`:
 *   - root attribute `data-base`        (`/` or `/seg/`), never a global
 *   - `input[data-grid-search]`         the query; `/` focuses it, Tab leaves
 *                                       it for the first card or row
 *   - `[data-grid-platform=<os>]`       platform chips (`button`, `aria-pressed`)
 *   - `[data-grid-status=<status>]`     `deprecated` / `yanked` chips
 *   - `[data-grid-keywords]`            the keyword rail, filled from
 *                                       `template[data-grid-chip]` (its
 *                                       `[data-field=keyword]` / `count`)
 *   - `[data-grid-more]`                the "+N more" popover wrapper, with
 *                                       `[data-grid-more-count]`,
 *                                       `input[data-grid-more-filter]` and
 *                                       `[data-grid-more-list]`
 *   - `[data-grid-scope]`, `[data-grid-sort]`, `[data-grid-view]`
 *                                       the theme's `ToggleGroup` / `Select`
 *   - `button[data-grid-invert]`        the sort-direction `ToggleButton`
 *   - `[data-grid-count]`               the `role=status` result count
 *   - `[data-grid-clear]`               clear-filters buttons (any number)
 *   - `[data-grid-empty=no-match|error]` hidden panels with a
 *                                       `[data-field=title|message]`; the
 *                                       `error` panel holds `[data-grid-retry]`
 *   - `[data-grid-skeleton]`            shown instead of the cards while a
 *                                       state-bearing cold URL loads
 *   - `ul[data-grid-cards]`, `ul[data-grid-table]`, `[data-grid-sentinel]`
 *   - `template[data-grid-card]`, `template[data-grid-row]`,
 *     `template[data-grid-card-keyword]`, `template[data-grid-os=<os>]`
 *     each item's fields are `[data-field=...]` (see `fillCard`/`fillRow`)
 *
 * Eager part (cheap, in the entry): listeners that only record state and drive
 * DOM that needs no data (chip pressed state, keyboard movement), so no
 * first activation is lost to the lazy load. Lazy part (behind `LazyMount.load`,
 * C-011): the catalog fetch, MiniSearch, rendering. `catalog.json` is fetched
 * once, on first interaction or at load when the URL already carries state; a
 * failure shows inline and Retry fetches again. The server cards stay.
 *
 * State lives in the URL only (`?q ?index ?sort ?view`, `replaceState`, no
 * history entry, no web storage): Back from a detail page restores it. Every
 * detail link is `packageHref` (C-009); DOM is written with `textContent`,
 * `setAttribute` and template clones only (C-041).
 */
import {
  ALL_INDEXES,
  SORT_KEYS,
  VIEW_MODES,
  parseCatalogUrlState,
  type SortKey,
  type ViewMode,
} from "../lib/catalogState.js";
import { everyEl, isEditableTarget, requireEl } from "../lib/dom.js";
import { ALL_SCOPE_VALUE } from "../lib/gridContract.js";
import { WINDOW_SIZE } from "../lib/windowing.js";
import type { FetchLike } from "../lib/wireTypes.js";
import type { Session } from "./grid_session.js";
import type { LazyMount } from "./mount.js";

export interface GridOptions {
  /** Catalog base (`/` or `/seg/`); defaults to the root's `data-base`. */
  readonly base?: string;
  /** Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
}

export interface GridState {
  q: string;
  /** The `?index=` value: `null` absent, `""` all, else an index name. Settled against the catalog on render. */
  urlIndex: string | null;
  sort: SortKey;
  inverted: boolean;
  view: ViewMode;
  platforms: string[];
  keywords: string[];
  deprecated: boolean;
  yanked: boolean;
  moreQuery: string;
  moreOpen: boolean;
  limit: number;
}


const within = (event: Event, selector: string): HTMLElement | null =>
  event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}


/** The value of the control (`ToggleGroup` item or `Select` option) `wrapper` holds, written back without events. */
function syncControl(wrapper: HTMLElement, value: string): void {
  const group = wrapper.querySelector<HTMLElement>('[data-zag-root="toggle-group"]');
  if (group) {
    const items = everyEl(group, '[data-part="item"]');
    const id = (item: HTMLElement) => item.id.slice(group.id.length + 1);
    if (!items.some((item) => id(item) === value)) return;
    // A machine that has not started yet boots from `data-zag-props`, so the default moves with the DOM.
    group.dataset.zagProps = JSON.stringify({ ...JSON.parse(group.dataset.zagProps ?? "{}"), defaultValue: [value] });
    for (const item of items) {
      const on = id(item) === value;
      item.setAttribute("aria-checked", String(on));
      item.dataset.state = on ? "on" : "off";
    }
    return;
  }
  const select = requireEl<HTMLSelectElement>(wrapper, "select");
  const option = [...select.options].find((entry) => entry.value === value);
  if (!option) return;
  select.value = value;
  requireEl(wrapper, ".ocx-ui-select__value").textContent = option.text.trim();
}


/**
 * Wires the grid onto `root`. `Mod`-less and data-less behaviour (state
 * recording, chip pressed state, keyboard movement) is live at once; the
 * catalog, the search index and every rendering step start with the first
 * interaction, or at once when the URL already carries state.
 */
export function mountGrid(root: HTMLElement, lazy: LazyMount, options: GridOptions = {}): { destroy(): void } {
  const base = options.base ?? root.dataset.base;
  if (base === undefined) throw new Error("grid: no base (set data-base on the root or pass options.base)");
  const search = requireEl<HTMLInputElement>(root, "input[data-grid-search]");
  const moreFilter = requireEl<HTMLInputElement>(root, "input[data-grid-more-filter]");
  const scopeControl = root.querySelector<HTMLElement>("[data-grid-scope]");
  const sortControl = requireEl<HTMLElement>(root, "[data-grid-sort]");
  const viewControl = requireEl<HTMLElement>(root, "[data-grid-view]");
  const cardList = requireEl<HTMLElement>(root, "[data-grid-cards]");
  const tableList = requireEl<HTMLElement>(root, "[data-grid-table]");
  const url = parseCatalogUrlState(location.search);
  const state: GridState = {
    q: url.q,
    urlIndex: url.index,
    sort: url.sort ?? "name",
    inverted: false,
    view: url.view ?? "cards",
    platforms: [],
    keywords: [],
    deprecated: false,
    yanked: false,
    moreQuery: "",
    moreOpen: false,
    limit: WINDOW_SIZE,
  };
  let session: Session | null = null;

  const syncChips = () => {
    const pressed = (el: HTMLElement, on: boolean) => el.setAttribute("aria-pressed", String(on));
    for (const chip of everyEl(root, "[data-grid-platform]")) pressed(chip, state.platforms.includes(String(chip.dataset.gridPlatform)));
    for (const chip of everyEl(root, "[data-grid-status]")) {
      pressed(chip, chip.dataset.gridStatus === "deprecated" ? state.deprecated : state.yanked);
    }
  };
  /** Writes state back into the controls without events; `scope` is the scope control's value, when known. */
  const syncControls = (scope?: string) => {
    if (search.value !== state.q) search.value = state.q;
    syncControl(sortControl, state.sort);
    syncControl(viewControl, state.view);
    if (scopeControl && scope !== undefined) syncControl(scopeControl, scope);
  };
  const update = (resetWindow = true) => {
    if (resetWindow) state.limit = WINDOW_SIZE;
    syncChips();
    session?.render();
  };

  const stops: (() => void)[] = [];
  // One cast: addEventListener types `handler` for a plain Event, every listener here names the event it gets.
  const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void) => {
    const listener = handler as (event: Event) => void;
    target.addEventListener(type, listener);
    stops.push(() => target.removeEventListener(type, listener));
  };

  listen(root, "input", (event) => {
    if (event.target === search) {
      state.q = search.value;
      update();
    } else if (event.target === moreFilter) {
      state.moreQuery = moreFilter.value;
      session?.renderMore();
    }
  });
  listen(root, "click", (event) => {
    const platform = within(event, "[data-grid-platform]");
    const status = within(event, "[data-grid-status]");
    const chip = within(event, "[data-grid-chip]");
    if (platform) state.platforms = toggled(state.platforms, String(platform.dataset.gridPlatform));
    else if (status) {
      const key = status.dataset.gridStatus === "deprecated" ? "deprecated" : "yanked";
      state[key] = !state[key];
    }
    else if (chip) state.keywords = toggled(state.keywords, String(chip.dataset.keyword));
    else if (within(event, "[data-grid-clear]")) {
      Object.assign(state, { q: "", platforms: [], keywords: [], deprecated: false, yanked: false });
      search.value = "";
    } else if (within(event, "[data-grid-retry]")) {
      session?.load();
      return;
    } else return;
    update();
  });
  listen(root, "ocx:select:change", (event: CustomEvent<{ value: string }>) => {
    const { value } = event.detail;
    if (within(event, "[data-grid-sort]")) state.sort = SORT_KEYS.find((key) => key === value) ?? state.sort;
    else if (within(event, "[data-grid-scope]")) state.urlIndex = value === ALL_SCOPE_VALUE ? ALL_INDEXES : value;
    else return;
    update();
  });
  listen(root, "ocx:toggle-group:change", (event: CustomEvent<{ value: string[] }>) => {
    const [value = ""] = event.detail.value;
    if (within(event, "[data-grid-view]")) state.view = VIEW_MODES.find((mode) => mode === value) ?? state.view;
    else if (within(event, "[data-grid-scope]")) state.urlIndex = value === ALL_SCOPE_VALUE ? ALL_INDEXES : value;
    else return;
    update();
  });
  listen(root, "ocx:toggle-button:change", (event: CustomEvent<{ pressed: boolean }>) => {
    if (!within(event, "[data-grid-invert]")) return;
    state.inverted = event.detail.pressed;
    update();
  });
  listen(root, "ocx:popover:change", (event: CustomEvent<{ open: boolean }>) => {
    if (!within(event, "[data-grid-more]")) return;
    state.moreOpen = event.detail.open;
    session?.renderMore();
  });

  // Keyboard: Tab leaves the search field for the first result, arrows move across cards and rows.
  listen(root, "keydown", (event: KeyboardEvent) => {
    if (event.target === search && event.key === "Tab" && !event.shiftKey) {
      const first = (state.view === "cards" ? cardList : tableList).querySelector<HTMLElement>("a[data-card]");
      // Nothing to jump to (empty or erroring grid): Tab stays untouched rather than trapping focus.
      if (!first) return;
      event.preventDefault();
      first.focus();
      return;
    }
    const current = within(event, "a[data-card]");
    const list = current?.closest<HTMLElement>("[data-grid-cards], [data-grid-table]");
    if (!current || !list) return;
    const items = everyEl(list, "a[data-card]");
    const columns = list === cardList ? getComputedStyle(list).gridTemplateColumns.split(" ").length : 1;
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : 0;
    if (step === 0) return;
    event.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, items.indexOf(current) + step))]?.focus();
  });
  // "/" focuses the search field, Escape drops card or control focus (the field keeps its own two-stage Escape).
  listen(document, "keydown", (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return;
    if (event.key === "/") {
      event.preventDefault();
      search.focus();
    } else if (event.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
  });

  const handle = lazy.mount(root, {
    trigger: "interaction",
    // Every handler above is live from the start; a replayed activation would run it twice.
    replay: false,
    load: async () => {
      // The whole rendering half (and MiniSearch behind it) is one lazy chunk: nothing of it is parsed before input.
      const { startSession } = await import("./grid_session.js");
      return {
        start: () => {
          session = startSession(root, state, base, options, syncControls);
          return { api: session, stop: () => session?.stop() };
        },
      };
    },
  });

  // A URL that already carries state boots now, with the controls showing it and a skeleton in place of
  // the unfiltered server cards.
  if (url.q !== "" || url.index !== null || url.sort !== null || url.view !== null) {
    syncControls(state.urlIndex === null ? undefined : state.urlIndex === ALL_INDEXES ? ALL_SCOPE_VALUE : state.urlIndex);
    // The skeleton and then the results replace the server cards in a list region that keeps the cards' height
    // (capped at the viewport), so the footer is not pulled into view and back: the cold boot shifts nothing.
    root.style.setProperty("--reserve", `${Math.min(cardList.offsetHeight, window.innerHeight)}px`);
    requireEl<HTMLElement>(root, "[data-grid-skeleton]").hidden = false;
    cardList.hidden = true;
    void handle.start();
  }

  return {
    destroy: () => {
      for (const stop of stops.splice(0)) stop();
      handle.destroy();
    },
  };
}
