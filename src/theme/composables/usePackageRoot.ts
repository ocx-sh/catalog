import type { MaybeRefOrGetter } from 'vue'
import { onMounted, ref, toValue, watch } from 'vue'
import { wirePrefix } from '../utils/cas'

// TS interfaces mirror the wire JSON field names 1:1 (snake_case) —
// schema/root.schema.json is the source of truth, no camelCase translation
// layer in between.

export interface Owner {
  /** The owner's forge USERNAME — never a display name. Canonical since
   *  ocx-indexbot 0.5.0. Optional because an index published before that
   *  carries only the legacy pair below. */
  login?: string
  /** The owner's numeric forge user id, and the index's own ownership key. */
  id?: number
  /** Pre-0.5.0 spelling of `login`. A root written by 0.5.0 or later carries
   *  it too, derived from `login`, so the two never disagree. */
  github?: string
  /** Pre-0.5.0 spelling of `id`. */
  github_id?: number
}

/** The owner's forge username, whichever spelling the root carries. */
export function ownerLogin(owner: Owner): string | undefined {
  return owner.login ?? owner.github
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
 * Fetches the wire package root — `<wireBase>/p/<ns>/<pkg>/_root.json`, the
 * ad-blocker-safe alias `sources/mirror.ts` writes beside the canonical
 * `<wireBase>/p/<ns>/<pkg>.json`, which is used as the 404 fallback (schema:
 * `root.schema.json` either way; the two are byte-identical). `wireBase` is the mount prefix of the source this
 * package came from — `''` (the site root) for the `root: true` source,
 * `index/<label>` for every other; the detail page reads it off its own
 * frontmatter. See `utils/cas.ts`'s `wirePrefix`.
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
export function usePackageRoot(
  ns: MaybeRefOrGetter<string>,
  pkg: MaybeRefOrGetter<string>,
  wireBase: MaybeRefOrGetter<string> = '',
) {
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
      // `wireBase` is watched alongside ns/pkg: the client router reuses this
      // component instance across a nav, and two packages from DIFFERENT
      // sources have different mount prefixes — dropping it from the watch
      // source would refetch package B's root under source A's prefix.
      () => [toValue(ns), toValue(pkg), toValue(wireBase)] as const,
      async ([nsVal, pkgVal, baseVal]) => {
        const token = ++requestToken
        loading.value = true
        error.value = null
        notFound.value = false
        try {
          // Alias first, canonical second. `/p/<ns>/<pkg>.json` — the wire
          // root's own URL — is BLOCKED by any browser running EasyList/
          // EasyPrivacy when the package name matches one of their ~800
          // unanchored `/<word>.js` rules: the rule matches that substring
          // inside `/<word>.json`, `fetch` rejects, and this composable's
          // catch below renders "Failed to load: NetworkError" on a page
          // whose data is perfectly fine (`ocx.sh/hawkeye/hawkeye` vs
          // EasyPrivacy's `/hawkeye.js`, 2026-08-27). `sources/mirror.ts`
          // writes `_root.json` beside every root for exactly this fetch —
          // see `sources/types.ts`'s `packageRootAliasPath`.
          //
          // The canonical path stays as the fallback: a tree mirrored by an
          // older build of this package has no alias, and 404-then-retry is
          // strictly better there than a bogus "Package not found".
          const base = wirePrefix(baseVal)
          let resp = await fetch(`${base}/p/${nsVal}/${pkgVal}/_root.json`)
          if (token !== requestToken) return
          if (resp.status === 404) {
            resp = await fetch(`${base}/p/${nsVal}/${pkgVal}.json`)
          }
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
