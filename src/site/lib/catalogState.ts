import type { CatalogIndexInfo, CatalogPackage } from './wireTypes.js'

/** How "all indexes" is spelled in the URL: an EMPTY value, not an absent
 * param. Absent has to keep meaning "no scope chosen yet" — that is what a
 * first visit looks like, and what resolves to the default index — so if
 * "all" were also absent, a shared link to the all view would silently
 * reopen scoped to the default. An empty string can never collide with a
 * real index either: a label is `^[A-Za-z0-9._-]+$`, so it is never empty. */
export const ALL_INDEXES = ''

export const SORT_KEYS = ['name', 'updated', 'created'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const VIEW_MODES = ['cards', 'table'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/**
 * Everything the catalog page keeps in its address bar. `null` is "absent":
 * for `index` that means no scope chosen yet (see {@link ALL_INDEXES}), for
 * `sort`/`view` it means the default applies.
 */
export interface CatalogUrlState {
  /** The search text; `''` when absent. */
  q: string
  index: string | null
  sort: SortKey | null
  view: ViewMode | null
  /** Keyword facet values, one repeated `keyword=` param each. */
  keywords: string[]
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | null {
  return allowed.find((candidate) => candidate === value) ?? null
}

/** Reads a `location.search` string (leading `?` optional). Untrusted input:
 * an unknown `sort`/`view` value reads as absent, never as a made-up mode. */
export function parseCatalogUrlState(search: string): CatalogUrlState {
  const params = new URLSearchParams(search)
  return {
    q: params.get('q') ?? '',
    index: params.get('index'),
    sort: oneOf(SORT_KEYS, params.get('sort')),
    view: oneOf(VIEW_MODES, params.get('view')),
    keywords: params.getAll('keyword').filter(Boolean),
  }
}

/**
 * The query string (no leading `?`; `''` when there is nothing to say) for a
 * state. Every param is written from ONE URLSearchParams, so adding one never
 * drops another. Order is fixed — index, q, sort, view, keyword — so the same
 * state is always the same URL. Absent values write nothing; an empty `q`
 * writes nothing.
 */
export function serializeCatalogUrlState(state: Partial<CatalogUrlState>): string {
  const params = new URLSearchParams()
  if (state.index != null) params.set('index', state.index)
  if (state.q) params.set('q', state.q)
  if (state.sort) params.set('sort', state.sort)
  if (state.view) params.set('view', state.view)
  for (const keyword of state.keywords ?? []) params.append('keyword', keyword)
  return params.toString()
}

/**
 * Is there a scope to CHOOSE? Presence of `indexes` is NOT that question: the
 * envelope ships for every catalog, one source included, because the route
 * rule needs it; a one-entry envelope means exactly one place to be, so no tab
 * row and no scope to spell in the URL.
 */
export function hasIndexScope(indexes: readonly CatalogIndexInfo[] | undefined): boolean {
  return (indexes?.length ?? 0) > 1
}

/**
 * Indexes the "all" scope leaves out (`excludeFromAll`), as the names
 * `filterPackages` takes. `[]` for a catalog with no scope to choose: there is
 * no "all" tab to exclude from, so a lone index always shows.
 */
export function excludedIndexNames(indexes: readonly CatalogIndexInfo[] | undefined): string[] {
  if (!indexes || !hasIndexScope(indexes)) return []
  return indexes.filter((entry) => entry.excludeFromAll).map((entry) => entry.name)
}

/**
 * Settles the active scope (`null` is "all") from what the URL asked for and
 * the indexes the catalog turned out to have. `''` is "all"; a name the
 * catalog has is that index; anything else — absent, or an unknown name — falls
 * to the index marked `default`, and to "all" when none is.
 */
export function resolveIndexScope(urlIndex: string | null, indexes: readonly CatalogIndexInfo[]): string | null {
  if (urlIndex === ALL_INDEXES) return null
  if (urlIndex !== null && indexes.some((entry) => entry.name === urlIndex)) return urlIndex
  return indexes.find((entry) => entry.default)?.name ?? null
}

/**
 * Timestamp sorts are newest-first; `updated: null` (tagless) sinks to the
 * end. `name` keeps the catalog's own package-id order untouched. `inverted`
 * reverses whichever result that is.
 */
export function sortPackages(
  packages: CatalogPackage[],
  key: SortKey,
  inverted: boolean,
): CatalogPackage[] {
  const list = key === 'name' ? packages : [...packages].sort((a, b) => (b[key] ?? '').localeCompare(a[key] ?? ''))
  return inverted ? [...list].reverse() : list
}
