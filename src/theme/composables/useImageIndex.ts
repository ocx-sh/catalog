import { ref } from 'vue'
import { createImageIndexLoader, readImageIndexDetail } from '../../site/lib/imageIndexFetch'
import { createRequestGate } from '../../site/lib/requestGate'
import type { CatalogPackageDetail } from '../../viewmodel/types.js'

export type { ImageIndex, ManifestDescriptor, Platform } from '../../site/lib/wireTypes'
import type { ImageIndex } from '../../site/lib/wireTypes'

// Module-level loader: its cache + in-flight dedup are shared across every
// component instance and every `useImageIndex()` call — this is the point
// (repeat hovers over an already-fetched digest hit the cache, not the
// network). Core: `site/lib/imageIndexFetch.ts`; `fetch` is resolved per call
// so a swapped `globalThis.fetch` is honoured.
const loadImageIndex = createImageIndexLoader((url) => fetch(url))

/**
 * Lazy fetch of the OCI image index a tag resolved to
 * (`<wireBase>/p/<ns>/<pkg>/o/sha256/<hex>.json` — stored verbatim as the
 * registry served it). `ns`/`pkg` are the bare route params (same CAS gotcha
 * as `usePackageRoot` — never `root.name`); `digest` is a tag's
 * `tags[tag].content` value (`sha256:<hex>`), which is the image index's own
 * digest; `wireBase` is the mount prefix of the source the package came from
 * (see `site/lib/cas.ts`'s `wirePrefix`).
 *
 * The module-level cache stays keyed by `digest` ALONE, deliberately: a
 * digest is a content address, so the same digest under two sources is the
 * same bytes. Only the URL a miss is fetched from varies by `wireBase`.
 *
 * Pure fetch + module-level cache only — no grouping/version logic here
 * (that's `site/lib/version.ts`'s `buildVersionTable`). Callers that trigger
 * `load()` from a hover interaction own their own debounce (~150-200ms);
 * this composable's cache makes repeated calls for the same digest free.
 */
export function useImageIndex() {
  const imageIndex = ref<ImageIndex | null>(null)
  const loading = ref(false)
  // C-600: license/source/revision derived from `imageIndex`'s own
  // `annotations`, kept in lockstep with it (same token guard below) rather
  // than a separate computed a consumer could read one tick out of sync
  // with which digest `imageIndex` itself currently reflects.
  const detail = ref<CatalogPackageDetail>({})

  // Request gate scoped to this composable instance — guards against a
  // rapid double-`load()` (e.g. two hover targets in quick succession)
  // resolving out of order, which would otherwise let the first (now
  // stale) call's response overwrite the second's.
  const gate = createRequestGate()

  async function load(ns: string, pkg: string, digest: string, wireBase = '') {
    const isCurrent = gate.begin()
    loading.value = true
    const result = await loadImageIndex(ns, pkg, digest, wireBase)
    if (!isCurrent()) return
    imageIndex.value = result
    detail.value = result ? readImageIndexDetail(result, digest) : {}
    loading.value = false
  }

  return { imageIndex, loading, detail, load }
}
