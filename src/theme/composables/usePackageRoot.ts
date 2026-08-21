import type { MaybeRefOrGetter } from 'vue'
import { onMounted, ref, toValue, watch } from 'vue'

// TS interfaces mirror the wire JSON field names 1:1 (snake_case) —
// schema/root.schema.json is the source of truth, no camelCase translation
// layer in between.

export interface Owner {
  github: string
  github_id: number
}

export interface Upstream {
  org: string
  repository_url?: string
  disclaimer?: string | null
}

export interface Desc {
  digest: string
  title: string
  description: string
  keywords: string[]
  readme?: string
  logo?: string
}

export interface Yanked {
  reason: string
  at: string
}

export interface TagEntry {
  content: string
  observed: string
  yanked?: Yanked
}

export interface PackageRoot {
  name: string
  repository: string
  owners: Owner[]
  status: 'active' | 'deprecated' | 'yanked'
  deprecated_message: string | null
  superseded_by?: string | null
  created: string
  upstream?: Upstream
  /** Repository whose CI produced the builds (bot-derived from the latest
   * version's `org.opencontainers.image.source` annotation) — NOT
   * `upstream.repository_url`, which attributes the vendor a namespace
   * mirrors. Schema-restricted to `https://`; still run through `safeHref`
   * before it reaches an `:href`. */
  source?: string | null
  desc: Desc | null
  tags: Record<string, TagEntry>
}

/**
 * Fetches the wire package root at `/p/<ns>/<pkg>.json` (schema:
 * `root.schema.json`).
 *
 * CAS gotcha: build any CAS asset URL (`casUrl()` from `utils/cas.ts`) from
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
export function usePackageRoot(ns: MaybeRefOrGetter<string>, pkg: MaybeRefOrGetter<string>) {
  const root = ref<PackageRoot | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)
  const notFound = ref(false)

  // Monotonic request token: guards every state write below against a
  // slow, now-superseded response landing after a newer navigation already
  // fired its own fetch — without this, a stale package-A response can
  // overwrite package-B's state after a quick A→B nav (URL shows B, page
  // renders A).
  let requestToken = 0

  onMounted(() => {
    watch(
      () => [toValue(ns), toValue(pkg)] as const,
      async ([nsVal, pkgVal]) => {
        const token = ++requestToken
        loading.value = true
        error.value = null
        notFound.value = false
        try {
          const resp = await fetch(`/p/${nsVal}/${pkgVal}.json`)
          if (token !== requestToken) return
          if (resp.status === 404) {
            notFound.value = true
            root.value = null
            return
          }
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const data = await resp.json()
          if (token !== requestToken) return
          root.value = data
        } catch (e) {
          if (token !== requestToken) return
          error.value = e instanceof Error ? e.message : 'Failed to load package'
          root.value = null
        } finally {
          if (token === requestToken) loading.value = false
        }
      },
      { immediate: true },
    )
  })

  return { root, loading, error, notFound }
}
