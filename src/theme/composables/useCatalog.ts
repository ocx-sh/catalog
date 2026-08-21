import { ref } from 'vue'

// Shape of `/data/catalog/catalog.json` per the plan's frozen "Site fetch
// layer" contract — NOT the wire contract (that's `/config.json` +
// `/p/**`, see `usePackageRoot`/`useImageIndex`). Render-pipeline-owned,
// camelCase, free to evolve between deploys.

export interface CatalogPackage {
  namespace: string
  package: string
  name: string
  status: 'active' | 'deprecated' | 'yanked'
  deprecatedMessage: string | null
  supersededBy: string | null
  /** Root's `created` date — the "newest" sort key. */
  created: string
  /** Last tag activity (max `observed`/`yanked.at`), null when tagless —
   * the "recently updated" sort key. */
  updated: string | null
  title: string
  description: string
  keywords: string[]
  latestVersion: string | null
  /** Variant names the package ships, derived by `core/render.py` from the
   * root's own `tags` (`version_order.variant_names`). Absent when the
   * package ships only the default variant — which is also why
   * `latestVersion` can be non-null while this is undefined: that field
   * deliberately ignores variant-prefixed tags. */
  variants?: string[]
  tagCount: number
  /** `os/arch` strings, e.g. `linux/amd64` — union across all non-yanked tags. */
  platforms: string[]
  logoUrl: string | null
  readmeUrl: string | null
}

export interface CatalogData {
  generated: string | null
  packages: CatalogPackage[]
}

const EMPTY_CATALOG: CatalogData = { generated: null, packages: [] }

// Module-level cache — the catalog is one global resource, shared across
// every consumer (`CatalogPage`, the command palette), same
// cache-once/dedupe-in-flight pattern as `useImageIndex.ts`.
let cache: CatalogData | null = null
let inFlight: Promise<CatalogData> | null = null

async function fetchCatalog(): Promise<CatalogData> {
  if (cache) return cache
  if (inFlight) return inFlight

  inFlight = (async (): Promise<CatalogData> => {
    try {
      const resp = await fetch('/data/catalog/catalog.json')
      if (resp.status === 404) return EMPTY_CATALOG
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: CatalogData = await resp.json()
      cache = data
      return data
    } catch {
      return EMPTY_CATALOG
    } finally { /* v8 ignore next -- WP-03: v8-to-istanbul instruments this bare-statement finally header as a synthetic branch; every real statement/branch in this try/catch/finally is covered (test/theme/composables/useCatalog.test.ts) */
      inFlight = null
    }
  })()
  return inFlight
}

/**
 * Fetches `/data/catalog/catalog.json`, module-level cached + in-flight
 * deduped. A 404 (render pipeline hasn't run yet, or a fresh deploy before
 * the first run) and any other fetch failure both degrade to the same
 * empty catalog — this composable never throws to the render tree.
 *
 * Pure fetch + cache only — no auto-fetch on mount (mirrors
 * `useImageIndex.ts`). Callers decide when to trigger `load()`: eager
 * consumers (`CatalogPage`, which IS the catalog) call it from
 * `onMounted`; lazy consumers (the command palette, mounted globally on
 * every page but only needs catalog data once actually opened) call it
 * from their own later trigger.
 */
export function useCatalog() {
  const catalog = ref<CatalogData>(cache ?? EMPTY_CATALOG)
  const loading = ref(!cache)

  async function load() {
    loading.value = true
    catalog.value = await fetchCatalog()
    loading.value = false
  }

  return { catalog, loading, load }
}
