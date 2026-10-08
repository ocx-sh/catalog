import { ref } from 'vue'

export type { CatalogData, CatalogIndexInfo, CatalogPackage } from '../../site/lib/wireTypes'
import type { CatalogData } from '../../site/lib/wireTypes'
import { createCatalogLoader, EMPTY_CATALOG } from '../../site/lib/catalogFetch'

// Module-level loader — the catalog is one global resource, shared across
// every consumer (`CatalogPage`, the command palette). The cache/dedup core
// lives in `site/lib/catalogFetch.ts`; `fetch` is resolved per call so a
// test (or polyfill) swapping `globalThis.fetch` is honoured.
const catalogLoader = createCatalogLoader((url) => fetch(url))

/**
 * Fetches `/data/catalog/catalog.json`, module-level cached + in-flight
 * deduped. A 404 degrades to the empty catalog (`error` stays `null`) — any
 * other failure (5xx, network error, malformed JSON) instead sets `error`
 * and leaves `catalog` at the empty catalog, mirroring `usePackageRoot.ts`'s
 * `notFound`-vs-`error` split (C-604) so a caller can render a distinct
 * "failed to load" state instead of "no packages published yet" (S-02). A
 * failed fetch is never cached (the core caches only on the success path),
 * so the next `load()` call always retries.
 *
 * Pure fetch + cache only — no auto-fetch on mount (mirrors
 * `useImageIndex.ts`). Callers decide when to trigger `load()`: eager
 * consumers (`CatalogPage`, which IS the catalog) call it from
 * `onMounted`; lazy consumers (the command palette, mounted globally on
 * every page but only needs catalog data once actually opened) call it
 * from their own later trigger.
 */
export function useCatalog() {
  const cached = catalogLoader.peek()
  const catalog = ref<CatalogData>(cached ?? EMPTY_CATALOG)
  const loading = ref(!cached)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      catalog.value = await catalogLoader.load()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load catalog'
      catalog.value = EMPTY_CATALOG
    } finally {
      loading.value = false
    }
  }

  return { catalog, loading, error, load }
}
