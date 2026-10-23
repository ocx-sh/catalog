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
 *   - `[data-grid-toolbar]`             the toolbar's wrapper; hidden while the catalog failed to load or is empty
 *   - `[data-grid-platform=<os>]`       platform chips (`button`, `aria-pressed`)
 *   - `[data-grid-status=<status>]`     `deprecated` / `yanked` chips
 *   - `[data-grid-keywords]`            the keyword rail, filled from
 *                                       `template[data-grid-chip]` (its
 *                                       `[data-field=keyword]`; the popover's
 *                                       chips also get `data-count`)
 *   - `[data-grid-more]`                the "+N more" popover wrapper, with
 *                                       `[data-grid-more-count]`,
 *                                       `input[data-grid-more-filter]`,
 *                                       `[data-grid-more-list]` and the
 *                                       `[data-grid-more-empty]` status line
 *   - `[data-grid-scope]`               the scope tabs (a `ToggleGroup`); indexes
 *                                       past the inline ones are
 *                                       `[data-grid-scope-option=<index>]`
 *                                       buttons behind a "+N" popover
 *   - `[data-grid-sort]`, `[data-grid-view]`
 *                                       the theme's `Select` / `ToggleGroup`
 *   - `button[data-grid-invert]`        the sort-direction `ToggleButton`
 *   - `[data-grid-count]`               the `role=status` result count
 *   - `[data-grid-clear]`               clear-filters buttons (any number)
 *   - `[data-grid-clear-search]`        the no-match panel's clear-search button
 *   - `[data-grid-empty=no-data|no-match|error]`
 *                                       hidden panels; `no-match` and `error`
 *                                       have `[data-field=title|message]`, the
 *                                       `error` panel holds `[data-grid-retry]`
 *   - `[data-grid-skeleton]`            a `ul` shown instead of the cards for as
 *                                       long as the catalog is loading
 *   - `ul[data-grid-cards]`, `ul[data-grid-table]`, `[data-grid-sentinel]`
 *   - `template[data-grid-card]`, `template[data-grid-row]`,
 *     `template[data-grid-card-keyword]`, `template[data-grid-os=<os>]`
 *     each item's fields are `[data-field=...]` (see `fillCard`/`fillRow`)
 *
 * Eager part (cheap, in the entry): listeners that only record state and drive
 * DOM that needs no data (chip pressed state, keyboard movement), so no
 * first activation is lost to the lazy load. Lazy part (behind `LazyMount.load`,
 * C-011): the catalog fetch, search, rendering. `catalog.json` is fetched
 * once, on first interaction (a first scroll counts: the server renders one
 * window and nothing else would grow it) or at load when the URL already
 * carries state; the skeleton stands in for the cards until it resolves, a
 * failure shows inline and Retry fetches again.
 *
 * State lives in the URL (`?q ?index ?sort ?view ?keyword ?platform ?status
 * ?invert`, `replaceState`, no history entry): Back from a detail page restores
 * it. The view and sort key are also remembered (`lib/viewPrefs.ts`); a URL that
 * names them wins. Every detail link is `packageHref` (C-009); DOM is written
 * with `textContent`, `setAttribute` and template clones only (C-041).
 */
import {
  ALL_INDEXES,
  SORT_KEYS,
  VIEW_MODES,
  parseCatalogUrlState,
  type SortKey,
  type ViewMode,
} from "../lib/catalogState.js";
import { addCopyLink, everyEl, isEditableTarget, requireEl } from "../lib/dom.js";
import { ALL_SCOPE_VALUE, OS_ORDER, SKELETON_COUNT, WINDOW_SIZE } from "../lib/gridContract.js";
import { readViewPrefs, writeViewPrefs } from "../lib/viewPrefs.js";
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


/** How long a card's install button shows it has copied. */
const COPIED_MS = 1500;

const within = (event: Event, selector: string): HTMLElement | null =>
  event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** The value of a `ToggleGroup` item: the item's id is the group's id, a colon and the value. */
const itemValue = (group: HTMLElement, item: HTMLElement): string => item.id.slice(group.id.length + 1);

const scopeIndex = (value: string): string => (value === ALL_SCOPE_VALUE ? ALL_INDEXES : value);

/**
 * Sets the value of the control (`ToggleGroup` or `Select`) `wrapper` holds, through the theme's setter event: no
 * change event comes back, and it works before and after the control's machine starts. A group value no item
 * carries (a scope that sits behind the "+N" popover) leaves every item off.
 */
function syncControl(wrapper: HTMLElement, value: string): void {
  const root = requireEl<HTMLElement>(wrapper, "[data-zag-root]");
  root.dispatchEvent(new CustomEvent(`ocx:${root.dataset.zagRoot}:set`, { bubbles: true, detail: { value } }));
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
  const invertButton = requireEl<HTMLElement>(root, "[data-grid-invert]");
  const cardList = requireEl<HTMLElement>(root, "[data-grid-cards]");
  const tableList = requireEl<HTMLElement>(root, "[data-grid-table]");
  const skeleton = requireEl<HTMLElement>(root, "[data-grid-skeleton]");
  const url = parseCatalogUrlState(location.search);
  const stored = readViewPrefs();
  // What the URL names is also what is remembered, so a reload or Back cannot let an older stored value win (0.5.3 stored
  // every change); the URL still decides this visit.
  if (url.sort !== null || url.view !== null) writeViewPrefs({ ...(url.sort && { sort: url.sort }), ...(url.view && { view: url.view }) });
  const state: GridState = {
    q: url.q,
    urlIndex: url.index,
    // The URL names what a link shows; the remembered choice fills in only what it leaves open.
    sort: url.sort ?? stored.sort ?? "name",
    inverted: url.inverted,
    view: url.view ?? stored.view ?? "cards",
    platforms: url.platforms.filter((os) => OS_ORDER.includes(os)),
    keywords: url.keywords,
    deprecated: url.deprecated,
    yanked: url.yanked,
    moreQuery: "",
    moreOpen: false,
    limit: WINDOW_SIZE,
  };
  let session: Session | null = null;
  // The server knows no origin: the cards it rendered get their absolute "copy link" text now (D-002).
  everyEl(cardList, "a[data-card]").forEach(addCopyLink);

  const syncChips = () => {
    const pressed = (el: HTMLElement, on: boolean) => el.setAttribute("aria-pressed", String(on));
    for (const chip of everyEl(root, "[data-grid-platform]")) pressed(chip, state.platforms.includes(String(chip.dataset.gridPlatform)));
    for (const chip of everyEl(root, "[data-grid-status]")) {
      pressed(chip, chip.dataset.gridStatus === "deprecated" ? state.deprecated : state.yanked);
    }
  };
  /** The direction button shows the order in force: pressed is inverted, and its tooltip names the next click. */
  const syncInvert = () => {
    invertButton.setAttribute("aria-pressed", String(state.inverted));
    invertButton.setAttribute("title", state.inverted ? "natural order" : "invert order");
  };
  /** Writes state back into the controls without events; `scope` is the scope control's value, when known. */
  const syncControls = (scope?: string) => {
    if (search.value !== state.q) search.value = state.q;
    syncControl(sortControl, state.sort);
    syncControl(viewControl, state.view);
    syncInvert();
    if (scopeControl && scope !== undefined) {
      syncControl(scopeControl, scope);
      for (const option of everyEl(scopeControl, "[data-grid-scope-option]")) {
        option.setAttribute("aria-pressed", String(option.dataset.gridScopeOption === scope));
      }
    }
  };
  const skeletonItem = requireEl<HTMLTemplateElement>(root, "template[data-grid-skeleton-item]");
  /**
   * The skeleton stands in for the cards while the catalog loads, for a page whose server cards are the wrong ones
   * (a URL, a remembered view or sort, or a query or filter just typed). A page that asked for nothing keeps its cards:
   * they are links to read and click while the catalog loads. Focus inside a list keeps it too: replacing the focused
   * card would drop focus to the page.
   */
  const showLoading = () => {
    if (cardList.contains(document.activeElement) || tableList.contains(document.activeElement)) return;
    // The remembered table view hid the cards before paint (the head script); from here the lists' own `hidden` rules.
    delete document.documentElement.dataset.catalogView;
    // The skeleton and then the results replace the list in a region that keeps its height (capped at the viewport),
    // so the footer is not pulled into view and back: the load shifts nothing.
    const shown = [cardList, tableList].find((list) => !list.hidden);
    if (shown) root.style.setProperty("--reserve", `${Math.min(shown.offsetHeight, window.innerHeight)}px`);
    if (skeleton.childElementCount === 0) {
      skeleton.append(...Array.from({ length: SKELETON_COUNT }, () => skeletonItem.content.cloneNode(true)));
    }
    skeleton.hidden = false;
    cardList.hidden = true;
    tableList.hidden = true;
  };
  const update = (resetWindow = true) => {
    if (resetWindow) state.limit = WINDOW_SIZE;
    syncChips();
    syncInvert();
    // Until the catalog is here the server cards cannot show what was just asked for.
    if (session?.loaded) session.render();
    else showLoading();
  };

  const stops: (() => void)[] = [];
  // One cast: addEventListener types `handler` for a plain Event, every listener here names the event it gets.
  const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, capture = false) => {
    const listener = handler as (event: Event) => void;
    target.addEventListener(type, listener, capture);
    stops.push(() => target.removeEventListener(type, listener, capture));
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
    // A card's keyword chip sits inside the card's link: toggling is not navigating. The CopyMenu around the cards
    // replays its first click untrusted once its code loads, which would toggle the chip straight back: only the real one counts.
    if (chip?.closest("a[data-card]")) {
      event.preventDefault();
      if (!event.isTrusted) return;
    }
    const scopeOption = within(event, "[data-grid-scope-option]");
    const scopeTab = within(event, '[data-grid-scope] [data-part="item"]');
    if (platform) state.platforms = toggled(state.platforms, String(platform.dataset.gridPlatform));
    else if (status) {
      const key = status.dataset.gridStatus === "deprecated" ? "deprecated" : "yanked";
      state[key] = !state[key];
    } else if (chip) state.keywords = toggled(state.keywords, String(chip.dataset.keyword));
    else if (scopeOption) state.urlIndex = String(scopeOption.dataset.gridScopeOption);
    else if (scopeTab) {
      // A tab chosen again after a "+N" pick is the machine's current value, so it raises no change event: the click itself says it.
      const group = scopeTab.closest<HTMLElement>('[data-zag-root="toggle-group"]');
      if (group) state.urlIndex = scopeIndex(itemValue(group, scopeTab));
    } else if (within(event, "[data-grid-clear-search]")) {
      state.q = "";
      search.value = "";
    } else if (within(event, "[data-grid-clear]")) {
      Object.assign(state, { q: "", platforms: [], keywords: [], deprecated: false, yanked: false });
      search.value = "";
    } else if (within(event, "[data-grid-retry]")) {
      // No session means the code never loaded: only a reload can fetch it again.
      if (!session) {
        location.reload();
        return;
      }
      showLoading();
      session?.load();
      return;
    } else return;
    update();
  });
  listen(root, "ocx:select:change", (event: CustomEvent<{ value: string }>) => {
    const sort = SORT_KEYS.find((key) => key === event.detail.value);
    if (!within(event, "[data-grid-sort]")) return;
    if (sort) {
      // Each key has a natural order: picking another starts from it, with the direction button released.
      state.sort = sort;
      state.inverted = false;
      writeViewPrefs({ sort });
    }
    update();
  });
  listen(root, "ocx:toggle-group:change", (event: CustomEvent<{ value: string[] }>) => {
    const [value = ""] = event.detail.value;
    if (within(event, "[data-grid-view]")) {
      state.view = VIEW_MODES.find((mode) => mode === value) ?? state.view;
      writeViewPrefs({ view: state.view });
    } else if (within(event, "[data-grid-scope]")) state.urlIndex = scopeIndex(value);
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

  // Re-entering the field with text selects it, so typing starts a fresh query. The first mouseup is held back so the
  // click does not collapse the selection into a caret again; later ones keep caret and drag selection working.
  let selectOnMouseup = false;
  listen(search, "focus", () => {
    search.select();
    selectOnMouseup = true;
  });
  listen(search, "mouseup", (event: MouseEvent) => {
    if (selectOnMouseup) event.preventDefault();
    selectOnMouseup = false;
  });
  // The theme's search field clears on Escape and stops it there. In the popover's filter the first Escape must
  // also close the popover, so the text is emptied one step earlier, on the way down: the theme then sees an empty
  // field and lets the Escape through to the popover.
  listen(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target !== moreFilter || moreFilter.value === "") return;
      moreFilter.value = "";
      state.moreQuery = "";
      session?.renderMore();
    },
    true,
  );

  // Keyboard: Tab leaves the search field for the first result, arrows move across cards and rows.
  listen(root, "keydown", (event: KeyboardEvent) => {
    if (event.target === search && event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const list = state.view === "cards" ? cardList : tableList;
      // A list that is hidden (the cold URL's server cards behind the skeleton) has nothing focusable to jump to.
      const first = list.hidden ? null : list.querySelector<HTMLElement>("a[data-card]");
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
  // "/" focuses the search field, Escape drops card or control focus. In the search field itself a first Escape
  // clears the text (the theme's search field, which stops it there); a second, on the empty field, blurs it.
  listen(document, "keydown", (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      if (event.target === search && event.key === "Escape" && search.value === "") search.blur();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      search.focus();
    } else if (event.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
  });

  // The install command on a card copies itself (D-001). The card is a link, so the click must not follow it. The
  // copy code is its own chunk: it is parsed on the first click only.
  const copiedTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  stops.push(() => copiedTimers.forEach(clearTimeout));
  listen(root, "click", (event) => {
    const button = within(event, "[data-grid-install]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const command = String(requireEl(button, '[data-field="install"]').textContent);
    void import("@ocx-sh/theme/copy").then(async ({ copyWithToast }) => {
      if (!(await copyWithToast(button, command, "install command"))) return;
      button.setAttribute("data-copied", "");
      clearTimeout(copiedTimers.get(button));
      copiedTimers.set(
        button,
        setTimeout(() => button.removeAttribute("data-copied"), COPIED_MS),
      );
    });
  });

  // The detail page is fetched ahead of the click, on the first hover or focus of its link (D-153). Eager, so the very
  // first approach counts: the session that would otherwise own it only exists after that same hover has loaded it.
  const hinted = new Set<string>();
  const onApproach = (event: Event) => {
    const href = within(event, "a[data-card]")?.getAttribute("href");
    if (!href || hinted.has(href)) return;
    hinted.add(href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.setAttribute("href", href);
    document.head.append(hint);
  };
  listen(root, "pointerover", onApproach);
  listen(root, "focusin", onApproach);
  // The session chunk itself can fail to load (a stale hash after a deploy, offline): nothing of the island is then live,
  // so the page must not be left behind its own loading state. Same outcome as a catalog.json failure.
  const chunkFailed = () => {
    delete document.documentElement.dataset.catalogWait;
    delete document.documentElement.dataset.catalogView;
    requireEl<HTMLElement>(root, "[data-grid-toolbar]").hidden = true;
    skeleton.hidden = true;
    cardList.hidden = false;
    tableList.hidden = true;
    const failure = requireEl<HTMLElement>(root, '[data-grid-empty="error"]');
    requireEl(failure, '[data-field="message"]').textContent = "The catalog code did not load. Try reloading.";
    failure.hidden = false;
  };
  const handle = lazy.mount(root, {
    trigger: "interaction",
    // Every handler above is live from the start; a replayed activation would run it twice.
    replay: false,
    load: async () => {
      // The whole rendering half (and the search behind it) is one lazy chunk: nothing of it is parsed before input.
      const { startSession } = await import("./grid_session.js").catch((error: unknown) => {
        chunkFailed();
        throw error;
      });
      return {
        start: () => {
          session = startSession(root, state, base, options, { syncControls });
          return { api: session, stop: () => session?.stop() };
        },
      };
    },
  });
  // The pointer, focus and touch triggers cannot see a reader who only scrolls (the scrollbar, End or Space with no
  // focus in the grid): the server rendered one window, so a first scroll starts the island that grows it.
  listen(window, "scroll", () => void handle.start());

  // A URL that already carries state, or a remembered view or sort that is not the default, boots now: the controls
  // show it and a skeleton stands in for the unfiltered server cards.
  if (
    url.q !== "" ||
    url.index !== null ||
    url.sort !== null ||
    url.view !== null ||
    url.keywords.length > 0 ||
    url.platforms.length > 0 ||
    url.deprecated ||
    url.yanked ||
    url.inverted ||
    state.sort !== "name" ||
    state.view !== "cards"
  ) {
    syncChips();
    syncControls(state.urlIndex === null ? undefined : state.urlIndex === ALL_INDEXES ? ALL_SCOPE_VALUE : state.urlIndex);
    showLoading();
    void handle.start();
  }

  return {
    destroy: () => {
      for (const stop of stops.splice(0)) stop();
      handle.destroy();
    },
  };
}
