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

/** One configured index, as the catalog's scope control sees it. Present
 * only when the deployment aggregates MORE than one — a single-source
 * catalog carries no envelope at all, which is what makes "render no scope
 * control" a fact about the data rather than a count the theme has to keep
 * in sync. */
export interface CatalogIndexInfo {
  /** The index's own name — the first `/`-segment of every package name it
   * publishes, and what the scope tab shows. */
  name: string
  /** The default index: preselected on arrival, and the only one whose
   * packages keep bare routes. No entry has it when no source is `root`. */
  root: boolean
  /** Packages this index contributes to the merged catalog. */
  count: number
}

export interface CatalogData {
  generated: string | null
  indexes?: CatalogIndexInfo[]
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

  // C-604: a genuine 404 (render pipeline hasn't run yet, or a fresh deploy
  // before the first run) is the only failure degraded to the empty catalog
  // HERE — a real "no packages published yet" state. Every other failure
  // (5xx, network error, malformed JSON) REJECTS instead of degrading, so
  // `useCatalog()` below can tell "genuinely empty" apart from "broken" and
  // never mislabels a broken deploy as an empty index (S-02).
  inFlight = (async (): Promise<CatalogData> => {
    try {
      const resp = await fetch('/data/catalog/catalog.json')
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
}

/**
 * Fetches `/data/catalog/catalog.json`, module-level cached + in-flight
 * deduped. A 404 degrades to the empty catalog (`error` stays `null`) — any
 * other failure (5xx, network error, malformed JSON) instead sets `error`
 * and leaves `catalog` at the empty catalog, mirroring `usePackageRoot.ts`'s
 * `notFound`-vs-`error` split (C-604) so a caller can render a distinct
 * "failed to load" state instead of "no packages published yet" (S-02). A
 * failed fetch is never cached (`cache` is only set on the success path),
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
  const catalog = ref<CatalogData>(cache ?? EMPTY_CATALOG)
  const loading = ref(!cache)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      catalog.value = await fetchCatalog()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load catalog'
      catalog.value = EMPTY_CATALOG
    } finally {
      loading.value = false
    }
  }

  return { catalog, loading, error, load }
}
