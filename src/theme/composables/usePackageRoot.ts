import type { MaybeRefOrGetter } from 'vue'
import { onMounted, ref, toValue, watch } from 'vue'
import { fetchPackageRoot } from '../../site/lib/packageRootFetch'
import { createRequestGate } from '../../site/lib/requestGate'

export type { Desc, Owner, PackageRoot, TagEntry, Upstream, Yanked } from '../../site/lib/wireTypes'
import type { PackageRoot } from '../../site/lib/wireTypes'

// `fetch` resolved per call so a swapped `globalThis.fetch` is honoured.
const fetchWire = (url: string) => fetch(url)

/**
 * Fetches the wire package root — `<wireBase>/p/<ns>/<pkg>/_root.json`, the
 * ad-blocker-safe alias `sources/mirror.ts` writes beside the canonical
 * `<wireBase>/p/<ns>/<pkg>.json`, which is used as the 404 fallback (schema:
 * `root.schema.json` either way; the two are byte-identical; the alias-first
 * fetch itself is `site/lib/packageRootFetch.ts`). `wireBase` is the mount
 * prefix of the source this package came from — `''` (the site root) for the `root: true` source,
 * `index/<label>` for every other; the detail page reads it off its own
 * frontmatter. See `site/lib/cas.ts`'s `wirePrefix`.
 *
 * CAS gotcha: build any CAS asset URL (`casUrl()` from `site/lib/cas.ts`) from
 * the bare `<ns>/<pkg>` route params passed in here — NEVER from
 * `root.name`, which carries the `ocx.sh/` prefix and 404s every CAS
 * request built from it.
 *
 * `ns`/`pkg` accept refs/getters and are re-fetched on change (post-mount
 * only, per the SSR-safety constraint) — a dynamic-route detail page's
 * component instance can be reused by VitePress's client router across a
 * navigation between two different packages, so a plain one-shot
 * `onMounted` fetch would leave stale data on screen after such a nav.
 */
export function usePackageRoot(
  ns: MaybeRefOrGetter<string>,
  pkg: MaybeRefOrGetter<string>,
  wireBase: MaybeRefOrGetter<string> = '',
) {
  const root = ref<PackageRoot | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)
  const notFound = ref(false)

  // Monotonic request gate: guards every state write below against a
  // slow, now-superseded response landing after a newer navigation already
  // fired its own fetch — without this, a stale package-A response can
  // overwrite package-B's state after a quick A→B nav (URL shows B, page
  // renders A).
  const gate = createRequestGate()

  onMounted(() => {
    watch(
      // `wireBase` is watched alongside ns/pkg: the client router reuses this
      // component instance across a nav, and two packages from DIFFERENT
      // sources have different mount prefixes — dropping it from the watch
      // source would refetch package B's root under source A's prefix.
      () => [toValue(ns), toValue(pkg), toValue(wireBase)] as const,
      async ([nsVal, pkgVal, baseVal]) => {
        const isCurrent = gate.begin()
        loading.value = true
        error.value = null
        notFound.value = false
        try {
          const result = await fetchPackageRoot(fetchWire, nsVal, pkgVal, baseVal, isCurrent)
          if (result.status === 'stale') return
          if (result.status === 'not-found') {
            notFound.value = true
            root.value = null
            return
          }
          root.value = result.root
        } catch (e) {
          if (!isCurrent()) return
          error.value = e instanceof Error ? e.message : 'Failed to load package'
          root.value = null
        } finally {
          if (isCurrent()) loading.value = false
        }
      },
      { immediate: true },
    )
  })

  return { root, loading, error, notFound }
}
