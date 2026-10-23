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
  /** Platform facet values (OS names), one repeated `platform=` param each. */
  platforms: string[]
  /** The two status chips: `status=deprecated` and `status=yanked`. */
  deprecated: boolean
  yanked: boolean
  /** `invert=1`: the sort key's direction reversed. */
  inverted: boolean
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
    platforms: params.getAll('platform').filter(Boolean),
    deprecated: params.getAll('status').includes('deprecated'),
    yanked: params.getAll('status').includes('yanked'),
    inverted: params.get('invert') === '1',
  }
}
