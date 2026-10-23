/**
 * The grid island's lazy half (C-011): everything that needs the catalog. It is
 * imported by `grid.ts` on the first interaction (or at load when the URL
 * already carries state), so none of this, nor the search behind it, is parsed
 * before input. The markup contract is the header of `grid.ts`.
 */
import { fillLogoTile } from "@ocx-sh/theme/logo-tile";
import { joinBase, packageHref } from "../../viewmodel/url.js";
import { CATALOG_PATH, sharedCatalogLoader } from "../lib/catalogFetch.js";
import { ALL_INDEXES } from "../lib/catalogState.js";
import { excludedIndexNames, hasIndexScope, resolveIndexScope, serializeCatalogUrlState, sortPackages } from "../lib/catalogView.js";
import { cardCopyData } from "../lib/cardCopy.js";
import { everyEl, requireEl } from "../lib/dom.js";
import { CARD_NAME_BUDGET, ROW_NAME_BUDGET, elideMiddle } from "../lib/elideMiddle.js";
import { filterPackages } from "../lib/filterPackages.js";
import { byRelevance, scorePackages } from "../lib/packageSearch.js";
import { plural } from "../lib/plural.js";
import { ALL_SCOPE_VALUE } from "../lib/gridContract.js";
import { DEFAULT_INSTALL_FLAVORS, installCommand } from "../lib/installFlavors.js";
import { RAIL_LIMIT, cardKeywords, keywordFrequency, selectRailKeywords } from "../lib/keywordRail.js";
import { concreteOses, displayOses, osRank } from "../lib/platformAgnostic.js";
import { nextWindowLimit, windowSlice } from "../lib/windowing.js";
import type { CatalogData, CatalogIndexInfo, CatalogPackage } from "../lib/wireTypes.js";
import type { GridOptions, GridState } from "./grid.js";
import { animateRail } from "./rail_motion.js";

/** The next slice is built a screen and a half before the reader reaches it, so the list reads as complete. */
const GROWTH_MARGIN = "150% 0px";
const LOAD_FAILED = "Failed to load catalog";
const LOAD_FAILED_DETAIL = "Something went wrong fetching package data.";
// The flavor list is a non-empty constant: its first entry is the card's one-line shorthand.
const FIRST_COMMAND = DEFAULT_INSTALL_FLAVORS[0]!.command;

const field = (item: ParentNode, name: string): HTMLElement => requireEl(item, `[data-field="${name}"]`);

function stamp(template: HTMLTemplateElement): HTMLElement {
  const node = template.content.firstElementChild?.cloneNode(true);
  if (!(node instanceof HTMLElement)) throw new Error("grid: empty template");
  return node;
}


/**
 * Brings `parent`'s children to exactly `nodes`, in order, touching only what
 * differs: a node already in place is never moved, so a focused card survives
 * a re-render that keeps it.
 */
function reconcile(parent: Element, nodes: readonly Element[]): void {
  let cursor = parent.firstElementChild;
  for (const node of nodes) {
    if (node === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(node, cursor);
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
}


function fillCard(li: HTMLElement, pkg: CatalogPackage, ctx: ItemContext): void {
  const link = requireEl<HTMLAnchorElement>(li, "a[data-card]");
  link.dataset.key = pkg.name;
  const href = packageHref(pkg.name, ctx.catalog.indexes, ctx.base);
  link.setAttribute("href", href);
  fillShared(li, pkg, ctx, href);
  const version = field(li, "version");
  version.textContent = pkg.latestVersion;
  version.hidden = pkg.latestVersion === null;
  const name = field(li, "name");
  name.textContent = elideMiddle(pkg.name, CARD_NAME_BUDGET);
  field(li, "keywords").replaceChildren(
    ...cardKeywords(pkg.keywords, ctx.frequency).map((keyword) => {
      const chip = stamp(ctx.keywordTemplate);
      chip.textContent = keyword;
      chip.dataset.keyword = keyword;
      return chip;
    }),
  );
  field(li, "platforms").replaceChildren(...displayOses(pkg.platforms).map((os) => ctx.glyph(os)));
  field(li, "install").textContent = installCommand(FIRST_COMMAND, pkg.name);
}

function fillRow(li: HTMLElement, pkg: CatalogPackage, ctx: ItemContext): void {
  const link = requireEl<HTMLAnchorElement>(li, "a[data-card]");
  link.dataset.key = pkg.name;
  const href = packageHref(pkg.name, ctx.catalog.indexes, ctx.base);
  link.setAttribute("href", href);
  fillShared(li, pkg, ctx, href);
  field(li, "name").textContent = elideMiddle(pkg.name, ROW_NAME_BUDGET);
  // The cell stays whatever the package has to say: a hidden one would pull platforms and tag count a track left (D-039).
  field(li, "version").textContent = pkg.latestVersion ?? "—";
  const oses = displayOses(pkg.platforms);
  // A package that ships `any` is one italic label across the slots (D-040); the others get a slot per OS column, empty where unsupported.
  field(li, "platforms").replaceChildren(
    ...(oses[0] === "any"
      ? [anyPlatformLabel(li)]
      : ctx.osColumns.map((os) => {
          if (oses.includes(os)) return ctx.glyph(os);
          const empty = li.ownerDocument.createElement("span");
          empty.setAttribute("aria-hidden", "true");
          return empty;
        })),
  );
}

function anyPlatformLabel(li: HTMLElement): HTMLElement {
  const label = li.ownerDocument.createElement("span");
  label.className = "row-any";
  label.textContent = "any platform";
  return label;
}

/** The fields a card and a row share. */
function fillShared(li: HTMLElement, pkg: CatalogPackage, ctx: ItemContext, href: string): void {
  const title = field(li, "title");
  title.textContent = pkg.title;
  title.setAttribute("title", pkg.title);
  field(li, "name").setAttribute("title", pkg.name);
  field(li, "description").textContent = pkg.description;
  field(li, "deprecated").hidden = pkg.status !== "deprecated";
  field(li, "yanked").hidden = pkg.status !== "yanked";
  field(li, "tags").textContent = plural(pkg.tagCount, "tag");
  // The texts the card offers its copy menu, the detail link among them.
  requireEl<HTMLAnchorElement>(li, "a[data-card]").dataset.copy = JSON.stringify(cardCopyData(pkg.name, pkg.latestVersion, DEFAULT_INSTALL_FLAVORS, href));
  fillLogoTile(requireEl(li, ".ocx-logo-tile"), {
    name: pkg.package,
    seed: `${pkg.namespace}/${pkg.package}`,
    src: pkg.logoUrl === null ? null : joinBase(ctx.base, pkg.logoUrl),
  });
}

interface ItemContext {
  readonly base: string;
  readonly catalog: CatalogData;
  /** Catalog-wide keyword frequency, the order a card cuts its keywords by. */
  readonly frequency: ReturnType<typeof keywordFrequency>;
  readonly osColumns: readonly string[];
  readonly keywordTemplate: HTMLTemplateElement;
  glyph(os: string): HTMLElement;
}


export interface Session {
  render(): void;
  renderMore(): void;
  load(): void;
  stop(): void;
  /** The catalog has arrived: until then `render` has nothing to draw. */
  readonly loaded: boolean;
}

/** What one render computed, kept so growing the window does not recompute the result set. */
interface ListView {
  readonly sorted: CatalogPackage[];
  readonly ctx: ItemContext;
  readonly vocabulary: KeywordCount[];
  readonly scopeKey: string;
}

interface KeywordCount {
  readonly keyword: string;
  readonly count: number;
}

/** What the catalog and scope alone decide, whatever the query. */
interface ScopeFacts {
  readonly scopedTotal: number;
  readonly allTotal: number;
  readonly frequency: ReturnType<typeof keywordFrequency>;
  readonly osColumns: string[];
}

/** What the eager half lends the session: it owns the controls and the loading state of the lists. */
export interface SessionHooks {
  syncControls(scope?: string): void;
}

export function startSession(
  root: HTMLElement,
  state: GridState,
  base: string,
  options: GridOptions,
  { syncControls }: SessionHooks,
): Session {
  const loader = sharedCatalogLoader(`${base}${CATALOG_PATH}`, options.fetch);
  const toolbar = requireEl<HTMLElement>(root, "[data-grid-toolbar]");
  const cardList = requireEl<HTMLElement>(root, "[data-grid-cards]");
  const tableList = requireEl<HTMLElement>(root, "[data-grid-table]");
  const sentinel = requireEl<HTMLElement>(root, "[data-grid-sentinel]");
  const skeleton = requireEl<HTMLElement>(root, "[data-grid-skeleton]");
  const noData = requireEl<HTMLElement>(root, '[data-grid-empty="no-data"]');
  const noMatch = requireEl<HTMLElement>(root, '[data-grid-empty="no-match"]');
  const failure = requireEl<HTMLElement>(root, '[data-grid-empty="error"]');
  const count = requireEl<HTMLElement>(root, "[data-grid-count]");
  const rail = requireEl<HTMLElement>(root, "[data-grid-keywords]");
  const more = requireEl<HTMLElement>(root, "[data-grid-more]");
  const moreCount = requireEl<HTMLElement>(more, "[data-grid-more-count]");
  const moreList = requireEl<HTMLElement>(root, "[data-grid-more-list]");
  const moreEmpty = requireEl<HTMLElement>(root, "[data-grid-more-empty]");
  const cardTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-card]");
  const rowTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-row]");
  const chipTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-chip]");
  const keywordTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-card-keyword]");
  const glyph = (os: string) => stamp(requireEl<HTMLTemplateElement>(root, `template[data-grid-os="${os}"]`));

  let current: CatalogData | null = null;
  // What the last render computed, so growing the window does not recompute the result set.
  let last: ListView | null = null;
  // The first render keeps the reserved height (the cold boot shifts nothing); the next one releases it (D-026).
  let rendered = false;
  let observer: IntersectionObserver | null = null;
  // What the built items were made for: the server cards were made for the scope the page opened on.
  let builtFor = { cards: String(root.dataset.scope), table: "" };

  /** The built items of `list` by package name. */
  const builtItems = (list: HTMLElement) =>
    new Map(Array.from(list.children, (item) => [String(requireEl<HTMLElement>(item, "a[data-card]").dataset.key), item]));

  /** Reads first, writes after: one layout for all strips. ponytail: not re-run on resize; the CSS clip still holds, only the tab stop lags. */
  function fitChips(chips: readonly HTMLElement[]): void {
    const fits = chips.map((chip) => chip.offsetTop - (chip.parentElement as HTMLElement).offsetTop < chip.offsetHeight);
    chips.forEach((chip, i) => {
      chip.inert = !fits[i];
    });
  }

  /** Active state of the cards' keyword chips, and (until the observer takes over) their fit: a chip wrapped below the strip's one line is inert. */
  function markCardChips(): void {
    const chips = everyEl(cardList, "[data-slot=keyword]");
    chips.forEach((chip) => chip.setAttribute("aria-pressed", String(state.keywords.includes(String(chip.dataset.keyword)))));
    if (chipObserver) everyEl(cardList, "a[data-card]").forEach((card) => chipObserver.observe(card));
    else fitChips(chips);
  }

  function renderList({ sorted, ctx, scopeKey }: ListView): void {
    const table = state.view === "table";
    // Without an observer nothing could ever grow the window, so the whole result set is built.
    const visible = windowSlice(sorted, observer === null ? Infinity : state.limit);
    const target = table ? tableList : cardList;
    // Items are reused only while what they were made for still holds: the scope (keyword cut, columns).
    const key = table ? `${scopeKey}|${ctx.osColumns.join(",")}` : scopeKey;
    const existing = key === (table ? builtFor.table : builtFor.cards) ? builtItems(target) : new Map<string, Element>();
    builtFor = table ? { ...builtFor, table: key } : { ...builtFor, cards: key };
    reconcile(
      target,
      visible.map((pkg) => {
        const kept = existing.get(pkg.name);
        if (kept) return kept;
        const item = stamp(table ? rowTemplate : cardTemplate);
        (table ? fillRow : fillCard)(item, pkg, ctx);
        return item;
      }),
    );
    cardList.hidden = table;
    tableList.hidden = !table;
    markCardChips();
    tableList.style.setProperty("--os-cols", String(ctx.osColumns.length));
    const hasMore = sorted.length > visible.length;
    sentinel.hidden = !hasMore;
    if (hasMore) {
      // An observer reports transitions, not states: observe again so a sentinel still in view fires.
      observer?.unobserve(sentinel);
      observer?.observe(sentinel);
    }
  }

  /** The keyword chips of `entries` in `container`, reusing the ones already there. */
  function chips(container: HTMLElement, entries: readonly KeywordCount[], withCount: boolean): void {
    const existing = new Map(everyEl(container, "[data-grid-chip]:not([data-leaving])").map((el) => [String(el.dataset.keyword), el]));
    const change = () =>
      reconcile(
        container,
        entries.map((entry) => {
          const el = existing.get(entry.keyword) ?? stamp(chipTemplate);
          el.dataset.keyword = entry.keyword;
          el.setAttribute("aria-pressed", String(state.keywords.includes(entry.keyword)));
          field(el, "keyword").textContent = entry.keyword;
          if (withCount) el.dataset.count = String(entry.count);
          else delete el.dataset.count;
          return el;
        }),
      );
    // Only the rail moves, and only once the page has settled: the first render adopts the server's chips.
    if (container === rail && rendered) animateRail(rail, change);
    else change();
  }

  /** The popover lists the whole vocabulary, but only while it is open: it can be thousands of chips. */
  function renderMore(): void {
    if (last === null) return;
    const query = state.moreQuery.trim().toLowerCase();
    const shown = state.moreOpen ? last.vocabulary.filter((entry) => entry.keyword.toLowerCase().includes(query)) : [];
    chips(moreList, shown, true);
    moreEmpty.hidden = !state.moreOpen || shown.length > 0;
  }

  // Query-independent work, kept for the last (packages, scope) so a keystroke does not redo it.
  let facts: { packages: CatalogPackage[]; scope: string | null; value: ScopeFacts } | undefined;
  function scopeFacts(packages: CatalogPackage[], indexes: readonly CatalogIndexInfo[], scope: string | null, excluded: string[]): ScopeFacts {
    if (facts?.packages === packages && facts.scope === scope) return facts.value;
    // Vocabulary and platform columns describe the "all" view as the grid does, whatever the tab,
    // so they never disagree with it.
    const population = filterPackages(packages, { excludeIndexes: excluded });
    const value: ScopeFacts = {
      scopedTotal: filterPackages(packages, { index: scope ?? undefined, excludeIndexes: excluded }).length,
      allTotal: filterPackages(packages, { excludeIndexes: excludedIndexNames(indexes) }).length,
      frequency: keywordFrequency(population),
      osColumns: [...new Set(population.flatMap((pkg) => concreteOses(pkg.platforms)))].sort(
        (x, y) => osRank(x) - osRank(y) || x.localeCompare(y),
      ),
    };
    facts = { packages, scope, value };
    return value;
  }

  function render(): void {
    if (current === null) return;
    const catalog = current;
    const indexes = catalog.indexes ?? [];
    const packages = catalog.packages;
    failure.hidden = true;
    skeleton.hidden = true;
    delete document.documentElement.dataset.catalogWait;
    // A catalog with no package (a genuine 404 included) is the no-data panel alone, as the build renders one.
    noData.hidden = packages.length > 0;
    toolbar.hidden = packages.length === 0;
    if (packages.length === 0) {
      noMatch.hidden = true;
      cardList.hidden = true;
      tableList.hidden = true;
      sentinel.hidden = true;
      return;
    }
    const hasScope = hasIndexScope(indexes);
    const scope = hasScope ? resolveIndexScope(state.urlIndex, indexes) : null;
    const excluded = scope === null ? excludedIndexNames(indexes) : [];
    const filtered = filterPackages(packages, {
      query: state.q,
      platforms: state.platforms,
      keywords: state.keywords,
      deprecatedOnly: state.deprecated,
      yankedOnly: state.yanked,
      index: scope ?? undefined,
      excludeIndexes: excluded,
    });
    const { scopedTotal, allTotal, frequency, osColumns } = scopeFacts(packages, indexes, scope, excluded);
    // The popover stays a complete vocabulary; each count is scored against the survivors (0 is a dead end).
    const survivors = new Map(keywordFrequency(filtered).map((entry) => [entry.keyword, entry.count]));
    const view: ListView = {
      // A query ranks best match first; the chosen sort only orders equal scores, so it never buries the typed name.
      sorted: state.q.trim()
        ? byRelevance(sortPackages(filtered, state.sort, state.inverted), scorePackages(packages, state.q.trim()))
        : sortPackages(filtered, state.sort, state.inverted),
      ctx: { base, catalog, frequency, osColumns, keywordTemplate, glyph },
      vocabulary: frequency.map(({ keyword }) => ({ keyword, count: survivors.get(keyword) ?? 0 })),
      scopeKey: scope ?? ALL_SCOPE_VALUE,
    };
    last = view;

    // Rail: the active keywords pinned first, in click order and never scored (the chip that lifts a filter
    // must always be there), then the chips that best split the survivors.
    const pinned = state.keywords.map((keyword) => ({ keyword, count: filtered.length }));
    const slots = RAIL_LIMIT - pinned.length;
    const shown = [
      ...pinned,
      ...selectRailKeywords(filtered, RAIL_LIMIT)
        .filter((entry) => !state.keywords.includes(entry.keyword))
        .slice(0, Math.max(0, slots)),
    ];
    chips(rail, shown, false);
    const hidden = Math.max(0, frequency.length - shown.length);
    more.hidden = hidden === 0;
    moreCount.textContent = String(hidden);

    const labels = [...state.platforms, ...state.keywords, ...(state.deprecated ? ["deprecated"] : []), ...(state.yanked ? ["yanked"] : [])];
    // A live region announces on a rewrite, not on a change: leave the text alone when the count is the same (D-007).
    const summary = filtered.length === scopedTotal ? plural(scopedTotal, "package") : `${filtered.length} of ${plural(scopedTotal, "package")}`;
    if (count.textContent !== summary) count.textContent = summary;
    // "clear filters" shows beside the count while anything narrows; the panel offers the one cut that fits what emptied it.
    for (const button of everyEl(root, "[data-grid-clear]")) {
      button.hidden = noMatch.contains(button) ? state.q !== "" || labels.length === 0 : labels.length === 0 && state.q === "";
    }
    requireEl<HTMLElement>(noMatch, "[data-grid-clear-search]").hidden = state.q === "";
    noMatch.hidden = filtered.length > 0;
    field(noMatch, "title").textContent =
      state.q !== ""
        ? `No matches for “${state.q}”`
        : labels.length > 0
          ? `No packages match ${labels.join(" · ")}`
          : "No packages in this view";
    field(noMatch, "message").textContent =
      state.q !== ""
        ? `Check the spelling or drop a filter — ${allTotal} packages total.`
        : `${allTotal} packages total${labels.length > 0 ? " — try dropping a filter." : "."}`;

    // The settled scope: an unknown `?index=` has fallen to the default.
    syncControls(hasScope ? (scope ?? ALL_SCOPE_VALUE) : undefined);
    renderList(view);
    renderMore();
    // Releasing on the first render moves the footer on a cold filtered URL (CLS > 0); keeping it past the second
    // leaves a short result list in a viewport-tall box.
    if (rendered) root.style.removeProperty("--reserve");
    rendered = true;

    const query = serializeCatalogUrlState({
      index: hasScope ? (scope ?? ALL_INDEXES) : null,
      q: state.q,
      sort: state.sort === "name" ? null : state.sort,
      view: state.view === "cards" ? null : state.view,
      keywords: state.keywords,
      platforms: state.platforms,
      deprecated: state.deprecated,
      yanked: state.yanked,
      inverted: state.inverted,
    });
    try {
      history.replaceState(history.state, "", query ? `${location.pathname}?${query}` : location.pathname);
    } catch (error) {
      // WebKit throws SecurityError past 100 calls per 30 s; the address bar missing one update
      // must not abort the render. Anything else is a real fault.
      if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
    }
  }

  function load(): void {
    failure.hidden = true;
    loader
      .load()
      .then((catalog) => {
        current = catalog;
        render();
      })
      .catch((error: unknown) => {
        // A failed fetch or a render that threw: the toolbar goes (its controls would filter nothing until Retry),
        // the server cards come back from behind the skeleton, and the panel says why.
        const builtTable = state.view === "table" && tableList.children.length > 0;
        toolbar.hidden = true;
        skeleton.hidden = true;
        delete document.documentElement.dataset.catalogWait;
        cardList.hidden = builtTable;
        tableList.hidden = !builtTable;
        const detail = error instanceof Error ? error.message || LOAD_FAILED_DETAIL : LOAD_FAILED;
        field(failure, "message").textContent = `${detail} Try reloading.`;
        failure.hidden = false;
      });
  }

  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // An observer only exists once renderList has observed the sentinel, and renderList runs after `last` is set.
        // A record that arrives after the last slice was built (a stale one) grows nothing.
        if (state.limit >= last!.sorted.length) return;
        state.limit = nextWindowLimit(state.limit);
        renderList(last!);
      },
      { rootMargin: GROWTH_MARGIN },
    );
  }
  // Cards are `content-visibility: auto`: reading a chip's offset inside an off-screen card forces that card's layout,
  // every card of the window at once on a view switch (a third of its cost). So a card's chips are fitted when the
  // card scrolls into view, after the frame that laid it out.
  const chipObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) =>
          fitChips(entries.filter((entry) => entry.isIntersecting).flatMap((entry) => everyEl(entry.target as HTMLElement, "[data-slot=keyword]"))),
        )
      : null;

  // A logo that fails to load leaves the monogram showing: the theme's LogoTile script listens for it on the document.
  load();
  return {
    render,
    renderMore,
    load,
    get loaded() {
      return current !== null;
    },
    stop: () => {
      observer?.disconnect();
      chipObserver?.disconnect();
    },
  };
}
