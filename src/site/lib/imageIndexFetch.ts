import { casUrl } from './cas.js'
import type { FetchLike, ImageIndex } from './wireTypes.js'

function isImageIndex(data: unknown): data is ImageIndex {
  return typeof data === 'object' && data !== null && Array.isArray((data as { manifests?: unknown }).manifests)
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
 * (non-ok, network error, malformed JSON, JSON that is not an image index, a
 * digest or name `casUrl` refuses) resolves `null` and is not cached.
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
    // The URL is built by the validating builder here, not trusted from the caller.
    const url = casUrl(`${ns}/${pkg}`, digest, 'json', wireBase)
    if (url === null) return Promise.resolve(null)

    const cached = cache.get(digest)
    if (cached) return Promise.resolve(cached)

    const pending = inFlight.get(digest)
    if (pending) return pending

    const promise = (async (): Promise<ImageIndex | null> => {
      try {
        const resp = await fetchFn(url)
        if (!resp.ok) return null
        // The mirrored tree is untrusted: check the one field every consumer iterates.
        const data: unknown = await resp.json()
        if (!isImageIndex(data)) return null
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
