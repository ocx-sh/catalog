import { ALL_INDEXES, type CatalogUrlState, type SortKey } from './catalogState.js'
import type { CatalogIndexInfo, CatalogPackage } from './wireTypes.js'

// The catalog's view of itself: what the URL says back, which indexes the "all" tab covers, which scope is
// active, and the order of the list. Kept apart from `catalogState.ts` (what the URL may say, parsed) because the
// grid's eager entry parses the address and nothing else here; a bundler places a module whole, so every function
// here would otherwise ride in the entry chunk that loads before the first input.

/**
 * The query string (no leading `?`; `''` when there is nothing to say) for a
 * state. Every param is written from ONE URLSearchParams, so adding one never
 * drops another. Order is fixed — index, q, sort, view, keyword, platform, status, invert — so the same
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
  for (const platform of state.platforms ?? []) params.append('platform', platform)
  if (state.deprecated) params.append('status', 'deprecated')
  if (state.yanked) params.append('status', 'yanked')
  if (state.inverted) params.set('invert', '1')
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
