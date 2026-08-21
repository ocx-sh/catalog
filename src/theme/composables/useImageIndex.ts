import { ref } from 'vue'

// Shape mirrors the OCI image-index spec (v1.1.1) 1:1 — the `platform`
// object's dotted keys — `os.version`, `os.features` — are OCI image-spec
// property names verbatim, not a nested `os` object.

export interface Platform {
  architecture: string
  os: string
  'os.version'?: string
  'os.features'?: string[]
  variant?: string
  features?: string[]
}

export interface ManifestDescriptor {
  mediaType: string
  digest: string
  size: number
  platform?: Platform
}

export interface ImageIndex {
  schemaVersion: number
  mediaType: string
  manifests: ManifestDescriptor[]
}

// Module-level cache + in-flight dedup, shared across every component
// instance and every `useImageIndex()` call — this is the point (repeat
// hovers over an already-fetched digest hit the cache, not the network).
// ponytail: plain Map, no eviction — image indices are small and a single
// detail page touches at most a few dozen distinct digests; add an LRU cap
// if a long-lived SPA session ever fetches hundreds.
const cache = new Map<string, ImageIndex>()
const inFlight = new Map<string, Promise<ImageIndex | null>>()

async function fetchImageIndex(ns: string, pkg: string, digest: string): Promise<ImageIndex | null> {
  const cached = cache.get(digest)
  if (cached) return cached

  const pending = inFlight.get(digest)
  if (pending) return pending

  const hex = digest.replace(/^sha256:/, '')
  const promise = (async (): Promise<ImageIndex | null> => {
    try {
      const resp = await fetch(`/p/${ns}/${pkg}/o/sha256/${hex}.json`)
      if (!resp.ok) return null
      const data: ImageIndex = await resp.json()
      cache.set(digest, data)
      return data
    } catch {
      return null
    } finally { /* v8 ignore next -- WP-03: v8-to-istanbul instruments this bare-statement finally header as a synthetic branch; every real statement/branch in this try/catch/finally is covered (test/theme/composables/useImageIndex.test.ts) */
      inFlight.delete(digest)
    }
  })()
  inFlight.set(digest, promise)
  return promise
}

/**
 * Lazy fetch of the OCI image index a tag resolved to (`/p/<ns>/<pkg>/o/
 * sha256/<hex>.json` — stored verbatim as the registry served it). `ns`/
 * `pkg` are the bare route params (same CAS gotcha as `usePackageRoot` —
 * never `root.name`); `digest` is a tag's `tags[tag].content` value
 * (`sha256:<hex>`), which is the image index's own digest.
 *
 * Pure fetch + module-level cache only — no grouping/version logic here
 * (that's `utils/version.ts`'s `buildVersionTable`). Callers that trigger
 * `load()` from a hover interaction own their own debounce (~150-200ms);
 * this composable's cache makes repeated calls for the same digest free.
 */
export function useImageIndex() {
  const imageIndex = ref<ImageIndex | null>(null)
  const loading = ref(false)

  // Sequence token scoped to this composable instance — guards against a
  // rapid double-`load()` (e.g. two hover targets in quick succession)
  // resolving out of order, which would otherwise let the first (now
  // stale) call's response overwrite the second's.
  let requestToken = 0

  async function load(ns: string, pkg: string, digest: string) {
    const token = ++requestToken
    loading.value = true
    const result = await fetchImageIndex(ns, pkg, digest)
    if (token !== requestToken) return
    imageIndex.value = result
    loading.value = false
  }

  return { imageIndex, loading, load }
}
