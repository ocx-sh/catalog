import { readImageIndexAnnotations } from '../../viewmodel/catalog.js'
import type { CatalogPackageDetail } from '../../viewmodel/types.js'
import { wirePrefix } from './cas.js'
import type { FetchLike, ImageIndex } from './wireTypes.js'

/**
 * C-600: reuses `readImageIndexAnnotations` (`src/viewmodel/catalog.ts`)
 * rather than hand-rolling a second annotation reader here (the
 * install-command drift class `subsystem-theme.md` warns about). That
 * parser is deliberately strict (throws naming the digest on a malformed
 * `annotations` value) because a build-time failure should abort the build
 * loudly. A malformed value reaching the BROWSER at runtime is different:
 * this is a third-party registry's own CAS bytes, fetched directly by an
 * end user's browser, with no build-time gate to catch it first — a crash
 * here would take down the whole detail page over a decoration field, so
 * this wrapper degrades a malformed value to "omitted" instead of
 * propagating the throw (same posture as `casUrl`'s malformed-digest ->
 * `null`, never a broken request).
 */
export function readImageIndexDetail(index: ImageIndex, digest: string): CatalogPackageDetail {
  try {
    return readImageIndexAnnotations(index, digest)
  } catch {
    return {}
  }
}

/**
 * Builds the loader for an OCI image index
 * (`<wireBase>/p/<ns>/<pkg>/o/sha256/<hex>.json`, stored verbatim as the
 * registry served it). The cache and the in-flight map live in the returned
 * closure: shared by every caller of ONE loader, which is the point (repeat
 * hovers over an already-fetched digest hit the cache, not the network).
 *
 * The cache stays keyed by `digest` ALONE, deliberately: a digest is a
 * content address, so the same digest under two sources is the same bytes.
 * Only the URL a miss is fetched from varies by `wireBase`. Any failure
 * (non-ok, network error, malformed JSON) resolves `null` and is not cached.
 *
 * ponytail: plain Map, no eviction — image indices are small and a single
 * detail page touches at most a few dozen distinct digests; add an LRU cap
 * if a long-lived SPA session ever fetches hundreds.
 */
export function createImageIndexLoader(
  fetchFn: FetchLike,
): (ns: string, pkg: string, digest: string, wireBase: string) => Promise<ImageIndex | null> {
  const cache = new Map<string, ImageIndex>()
  const inFlight = new Map<string, Promise<ImageIndex | null>>()

  return function loadImageIndex(ns, pkg, digest, wireBase) {
    const cached = cache.get(digest)
    if (cached) return Promise.resolve(cached)

    const pending = inFlight.get(digest)
    if (pending) return pending

    const hex = digest.replace(/^sha256:/, '')
    const promise = (async (): Promise<ImageIndex | null> => {
      try {
        const resp = await fetchFn(`${wirePrefix(wireBase)}/p/${ns}/${pkg}/o/sha256/${hex}.json`)
        if (!resp.ok) return null
        const data: ImageIndex = await resp.json()
        cache.set(digest, data)
        return data
      } catch {
        return null
      }
    })().finally(() => inFlight.delete(digest))
    inFlight.set(digest, promise)
    return promise
  }
}
