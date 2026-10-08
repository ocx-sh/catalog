import type { CatalogData, FetchLike } from './wireTypes.js'

/**
 * Where `catalog.json` lives, relative to the site `base` (which always ends in
 * `/`): fetch `${base}${CATALOG_PATH}`. Deliberately no leading slash — a
 * whole-string `/…` literal in emitted JS reads as a root-relative ref to the
 * base-containment scan (C-005), and every caller has a `base` to join onto.
 */
export const CATALOG_PATH = 'data/catalog/catalog.json'

export const EMPTY_CATALOG: CatalogData = { generated: null, packages: [] }

/**
 * Builds the loader for `/data/catalog/catalog.json`: cached once on success
 * and in-flight deduped, so every caller of ONE loader shares one request. The
 * cache lives in the returned closure, so each loader is independent; the
 * islands get the page-wide one from `sharedCatalogLoader`.
 *
 * C-604: a genuine 404 (render pipeline hasn't run yet, or a fresh deploy
 * before the first run) is the only failure degraded to the empty catalog — a
 * real "no packages published yet" state. Every other failure (5xx, network
 * error, malformed JSON or JSON that is not a catalog) REJECTS, so a caller can tell "genuinely empty" apart
 * from "broken" and never mislabels a broken deploy as an empty index (S-02).
 * Neither the empty catalog nor a failure is cached: the next call retries.
 */
export function createCatalogLoader(
  fetchFn: FetchLike,
  url: string,
): CatalogLoader {
  let cache: CatalogData | null = null
  let inFlight: Promise<CatalogData> | null = null

  return {
    load(): Promise<CatalogData> {
      if (cache) return Promise.resolve(cache)
      if (inFlight) return inFlight

      inFlight = (async (): Promise<CatalogData> => {
        try {
          const resp = await fetchFn(url)
          if (resp.status === 404) return EMPTY_CATALOG
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          // The mirrored tree is untrusted: check the one field every consumer iterates.
          const data: unknown = await resp.json()
          if (!isCatalogData(data)) throw new Error('catalog.json is not a catalog')
          cache = data
          return data
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    },
  }
}

export interface CatalogLoader {
  load(): Promise<CatalogData>
}

function isCatalogData(data: unknown): data is CatalogData {
  return typeof data === 'object' && data !== null && Array.isArray((data as { packages?: unknown }).packages)
}

const defaultFetch: FetchLike = url => globalThis.fetch(url)
const sharedLoaders = new WeakMap<FetchLike, Map<string, CatalogLoader>>()

/**
 * The page-wide loader for `url`: the grid and the palette are separate lazy
 * chunks, and each building its own loader would fetch and parse `catalog.json`
 * twice and hand `filterPackages` two arrays (so two MiniSearch indexes). Both
 * ask here instead. Created on first use — nothing is requested before an
 * island's first interaction (C-011). Keyed by `fetchFn` first so a caller
 * injecting its own (a test) never sees another's cache; the default is one
 * module-level function, so production callers all meet in the same entry.
 */
export function sharedCatalogLoader(url: string, fetchFn: FetchLike = defaultFetch): CatalogLoader {
  let byUrl = sharedLoaders.get(fetchFn)
  if (!byUrl) sharedLoaders.set(fetchFn, (byUrl = new Map()))
  let loader = byUrl.get(url)
  if (!loader) byUrl.set(url, (loader = createCatalogLoader(fetchFn, url)))
  return loader
}
