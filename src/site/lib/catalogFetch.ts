import type { CatalogData, FetchLike } from './wireTypes.js'

export const CATALOG_URL = '/data/catalog/catalog.json'

export const EMPTY_CATALOG: CatalogData = { generated: null, packages: [] }

/**
 * Builds the loader for `/data/catalog/catalog.json`: cached once on success
 * and in-flight deduped, so every consumer (`CatalogPage`, the command
 * palette) shares one request. The cache lives in the returned closure, not
 * in this module, so each loader is independent.
 *
 * C-604: a genuine 404 (render pipeline hasn't run yet, or a fresh deploy
 * before the first run) is the only failure degraded to the empty catalog — a
 * real "no packages published yet" state. Every other failure (5xx, network
 * error, malformed JSON) REJECTS, so a caller can tell "genuinely empty" apart
 * from "broken" and never mislabels a broken deploy as an empty index (S-02).
 * Neither the empty catalog nor a failure is cached: the next call retries.
 */
export function createCatalogLoader(
  fetchFn: FetchLike,
  url: string = CATALOG_URL,
): { load(): Promise<CatalogData>; peek(): CatalogData | null } {
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
          const data: CatalogData = await resp.json()
          cache = data
          return data
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    },
    /** The cached catalog, or null before the first successful load — lets a
     * late consumer start from data instead of an empty flash. */
    peek: () => cache,
  }
}
