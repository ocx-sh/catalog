/**
 * The grid island's lazy half (C-011): everything that needs the catalog. It is
 * imported by `grid.ts` on the first interaction (or at load when the URL
 * already carries state), so none of this, nor MiniSearch behind it, is parsed
 * before input. The markup contract is the header of `grid.ts`.
 */
import { joinBase, packageHref } from "../../viewmodel/url.js";
import { CATALOG_PATH, sharedCatalogLoader } from "../lib/catalogFetch.js";
import {
  ALL_INDEXES,
  excludedIndexNames,
  hasIndexScope,
  resolveIndexScope,
  serializeCatalogUrlState,
  sortPackages,
} from "../lib/catalogState.js";
import { everyEl, requireEl } from "../lib/dom.js";
import { elideMiddle } from "../lib/elideMiddle.js";
import { filterPackages } from "../lib/filterPackages.js";
import { ALL_SCOPE_VALUE } from "../lib/gridContract.js";
import { DEFAULT_INSTALL_FLAVORS, installCommand } from "../lib/installFlavors.js";
import { cardKeywords, keywordFrequency, selectRailKeywords } from "../lib/keywordRail.js";
import { monogramInitials } from "../lib/monogram.js";
import { concreteOses, displayOses, osRank } from "../lib/platformAgnostic.js";
import { nextWindowLimit, windowSlice } from "../lib/windowing.js";
import type { CatalogData, CatalogPackage } from "../lib/wireTypes.js";
import type { GridOptions, GridState } from "./grid.js";

/** Keyword chips on the rail, pinned ones included. */
const RAIL_LIMIT = 8;
const CARD_NAME_BUDGET = 38;
const ROW_NAME_BUDGET = 34;
const GROWTH_MARGIN = "600px 0px";
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
  link.setAttribute("href", packageHref(pkg.name, ctx.catalog.indexes, ctx.base));
  fillShared(li, pkg, ctx);
  const name = field(li, "name");
  name.textContent = elideMiddle(pkg.name, CARD_NAME_BUDGET);
  field(li, "keywords").replaceChildren(
    ...cardKeywords(pkg.keywords, ctx.frequency).map((keyword) => {
      const chip = stamp(ctx.keywordTemplate);
      chip.textContent = keyword;
      return chip;
    }),
  );
  field(li, "platforms").replaceChildren(...displayOses(pkg.platforms).map((os) => ctx.glyph(os)));
  field(li, "install").textContent = installCommand(FIRST_COMMAND, pkg.name);
}

function fillRow(li: HTMLElement, pkg: CatalogPackage, ctx: ItemContext): void {
  const link = requireEl<HTMLAnchorElement>(li, "a[data-card]");
  link.dataset.key = pkg.name;
  link.setAttribute("href", packageHref(pkg.name, ctx.catalog.indexes, ctx.base));
  fillShared(li, pkg, ctx);
  field(li, "name").textContent = elideMiddle(pkg.name, ROW_NAME_BUDGET);
  const oses = displayOses(pkg.platforms);
  // A package that ships `any` is one globe; the others get a slot per OS column, empty where unsupported.
  field(li, "platforms").replaceChildren(
    ...(oses[0] === "any"
      ? [ctx.glyph("any")]
      : ctx.osColumns.map((os) => {
          if (oses.includes(os)) return ctx.glyph(os);
          const empty = li.ownerDocument.createElement("span");
          empty.setAttribute("aria-hidden", "true");
          return empty;
        })),
  );
}

/** The fields a card and a row share. */
function fillShared(li: HTMLElement, pkg: CatalogPackage, ctx: ItemContext): void {
  const title = field(li, "title");
  title.textContent = pkg.title;
  title.setAttribute("title", pkg.title);
  field(li, "name").setAttribute("title", pkg.name);
  field(li, "description").textContent = pkg.description;
  const version = li.querySelector<HTMLElement>('[data-field="version"]');
  if (version) {
    version.textContent = pkg.latestVersion;
    version.hidden = pkg.latestVersion === null;
  }
  field(li, "deprecated").hidden = pkg.status !== "deprecated";
  field(li, "yanked").hidden = pkg.status !== "yanked";
  field(li, "tags").textContent = `${pkg.tagCount} tags`;
  field(li, "initials").textContent = monogramInitials(pkg.package);
  const logo = field(li, "logo");
  if (pkg.logoUrl === null) {
    logo.removeAttribute("src");
    logo.hidden = true;
  } else {
    logo.setAttribute("src", joinBase(ctx.base, pkg.logoUrl));
    logo.hidden = false;
  }
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

export function startSession(
  root: HTMLElement,
  state: GridState,
  base: string,
  options: GridOptions,
  syncControls: (scope?: string) => void,
): Session {
  const loader = sharedCatalogLoader(`${base}${CATALOG_PATH}`, options.fetch);
  const cardList = requireEl<HTMLElement>(root, "[data-grid-cards]");
  const tableList = requireEl<HTMLElement>(root, "[data-grid-table]");
  const sentinel = requireEl<HTMLElement>(root, "[data-grid-sentinel]");
  const skeleton = requireEl<HTMLElement>(root, "[data-grid-skeleton]");
  const noMatch = requireEl<HTMLElement>(root, '[data-grid-empty="no-match"]');
  const failure = requireEl<HTMLElement>(root, '[data-grid-empty="error"]');
  const count = requireEl<HTMLElement>(root, "[data-grid-count]");
  const rail = requireEl<HTMLElement>(root, "[data-grid-keywords]");
  const more = requireEl<HTMLElement>(root, "[data-grid-more]");
  const moreCount = requireEl<HTMLElement>(more, "[data-grid-more-count]");
  const moreList = requireEl<HTMLElement>(root, "[data-grid-more-list]");
  const cardTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-card]");
  const rowTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-row]");
  const chipTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-chip]");
  const keywordTemplate = requireEl<HTMLTemplateElement>(root, "template[data-grid-card-keyword]");
  const glyph = (os: string) => stamp(requireEl<HTMLTemplateElement>(root, `template[data-grid-os="${os}"]`));

  let current: CatalogData | null = null;
  // What the last render computed, so growing the window does not recompute the result set.
  let last: ListView | null = null;
  let observer: IntersectionObserver | null = null;
  // What the built items were made for: the server cards were made for the scope the page opened on.
  let builtFor = { cards: String(root.dataset.scope), table: "" };

  /** The built items of `list` by package name. */
  const builtItems = (list: HTMLElement) =>
    new Map(Array.from(list.children, (item) => [String(requireEl<HTMLElement>(item, "a[data-card]").dataset.key), item]));

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
    const existing = new Map(everyEl(container, "[data-grid-chip]").map((el) => [String(el.dataset.keyword), el]));
    reconcile(
      container,
      entries.map((entry) => {
        const el = existing.get(entry.keyword) ?? stamp(chipTemplate);
        el.dataset.keyword = entry.keyword;
        el.setAttribute("aria-pressed", String(state.keywords.includes(entry.keyword)));
        field(el, "keyword").textContent = entry.keyword;
        const badge = field(el, "count");
        badge.hidden = !withCount;
        badge.textContent = String(entry.count);
        return el;
      }),
    );
  }

  /** The popover lists the whole vocabulary, but only while it is open: it can be thousands of chips. */
  function renderMore(): void {
    if (last === null) return;
    const query = state.moreQuery.trim().toLowerCase();
    chips(moreList, state.moreOpen ? last.vocabulary.filter((entry) => entry.keyword.toLowerCase().includes(query)) : [], true);
  }

  function render(): void {
    if (current === null) return;
    const catalog = current;
    const indexes = catalog.indexes ?? [];
    const hasScope = hasIndexScope(indexes);
    const scope = hasScope ? resolveIndexScope(state.urlIndex, indexes) : null;
    const excluded = scope === null ? excludedIndexNames(indexes) : [];
    const packages = catalog.packages;
    const filtered = filterPackages(packages, {
      query: state.q,
      platforms: state.platforms,
      keywords: state.keywords,
      deprecatedOnly: state.deprecated,
      yankedOnly: state.yanked,
      index: scope ?? undefined,
      excludeIndexes: excluded,
    });
    const scopedTotal = filterPackages(packages, { index: scope ?? undefined, excludeIndexes: excluded }).length;
    const allTotal = filterPackages(packages, { excludeIndexes: excludedIndexNames(indexes) }).length;
    // Vocabulary and platform columns describe the "all" view as the grid does, whatever the tab,
    // so they never disagree with it.
    const population = filterPackages(packages, { excludeIndexes: excluded });
    const frequency = keywordFrequency(population);
    const osColumns = [...new Set(population.flatMap((pkg) => concreteOses(pkg.platforms)))].sort(
      (a, b) => osRank(a) - osRank(b) || a.localeCompare(b),
    );
    // The popover stays a complete vocabulary; each count is scored against the survivors (0 is a dead end).
    const survivors = new Map(keywordFrequency(filtered).map((entry) => [entry.keyword, entry.count]));
    const view: ListView = {
      sorted: sortPackages(filtered, state.sort, state.inverted),
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
    count.textContent = filtered.length === scopedTotal ? `${scopedTotal} packages` : `${filtered.length} of ${scopedTotal} packages`;
    for (const button of everyEl(root, "[data-grid-clear]")) button.hidden = labels.length === 0 && state.q === "";
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
    failure.hidden = true;
    skeleton.hidden = true;

    // The settled scope: an unknown `?index=` has fallen to the default.
    syncControls(hasScope ? (scope ?? ALL_SCOPE_VALUE) : undefined);
    renderList(view);
    renderMore();

    const query = serializeCatalogUrlState({
      index: hasScope ? (scope ?? ALL_INDEXES) : null,
      q: state.q,
      sort: state.sort === "name" ? null : state.sort,
      view: state.view === "cards" ? null : state.view,
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
        // A failed fetch or a render that threw: the server cards stay, a cold URL that hid them
        // for the skeleton gets them back, and the panel says why.
        skeleton.hidden = true;
        cardList.hidden = state.view === "table";
        field(failure, "message").textContent = error instanceof Error ? error.message : String(error);
        failure.hidden = false;
      });
  }

  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        state.limit = nextWindowLimit(state.limit);
        // An observer only exists once renderList has observed the sentinel, and renderList runs after `last` is set.
        renderList(last!);
      },
      { rootMargin: GROWTH_MARGIN },
    );
  }
  // A logo that fails to load leaves the initials showing instead of a broken-image glyph.
  const onImageError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) event.target.hidden = true;
  };
  root.addEventListener("error", onImageError, true);

  load();
  return {
    render,
    renderMore,
    load,
    stop: () => {
      observer?.disconnect();
      root.removeEventListener("error", onImageError, true);
    },
  };
}

