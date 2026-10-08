import { isSafePackageName, wirePrefix } from './cas.js'
import type { FetchLike, PackageRoot } from './wireTypes.js'

/** `stale`: a newer request superseded this one mid-flight — write nothing. */
export type PackageRootResult =
  | { status: 'ok'; root: PackageRoot }
  | { status: 'not-found' }
  | { status: 'stale' }

function isPackageRoot(root: unknown): root is PackageRoot {
  const tags = typeof root === 'object' && root !== null ? (root as { tags?: unknown }).tags : undefined
  return typeof tags === 'object' && tags !== null && !Array.isArray(tags)
}

/**
 * Fetches the wire package root — alias first, canonical second.
 * `/p/<ns>/<pkg>.json` — the wire root's own URL — is BLOCKED by any browser
 * running EasyList/EasyPrivacy when the package name matches one of their ~800
 * unanchored `/<word>.js` rules: the rule matches that substring inside
 * `/<word>.json`, `fetch` rejects, and the page renders "Failed to load:
 * NetworkError" though its data is fine (`ocx.sh/hawkeye/hawkeye` vs
 * EasyPrivacy's `/hawkeye.js`, 2026-08-27). `sources/mirror.ts` writes
 * `_root.json` beside every root for exactly this fetch — see
 * `sources/types.ts`'s `packageRootAliasPath`.
 *
 * The canonical path stays as the fallback: a tree mirrored by an older build
 * of this package has no alias, and 404-then-retry is strictly better there
 * than a bogus "Package not found".
 *
 * `isCurrent` (a `createRequestGate().begin()` result) is checked after every
 * await; once it turns false the call resolves `stale`. Non-404 failures
 * (HTTP error, network error, malformed JSON, JSON that is not a package
 * root) throw — the caller owns the
 * stale check on that path too. A name that is not a plain `/`-separated one
 * (the validator `casUrl` uses) resolves `not-found` without a request.
 */
export async function fetchPackageRoot(
  fetchFn: FetchLike,
  ns: string,
  pkg: string,
  wireBase: string,
  isCurrent: () => boolean,
): Promise<PackageRootResult> {
  if (!isSafePackageName(`${ns}/${pkg}`)) return { status: 'not-found' }
  const base = wirePrefix(wireBase)
  let resp = await fetchFn(`${base}/p/${ns}/${pkg}/_root.json`)
  if (!isCurrent()) return { status: 'stale' }
  if (resp.status === 404) {
    resp = await fetchFn(`${base}/p/${ns}/${pkg}.json`)
  }
  if (!isCurrent()) return { status: 'stale' }
  if (resp.status === 404) return { status: 'not-found' }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const root: unknown = await resp.json()
  if (!isCurrent()) return { status: 'stale' }
  // The mirrored tree is untrusted: check the one field every consumer reads.
  if (!isPackageRoot(root)) throw new Error('package root has no tags')
  return { status: 'ok', root }
}
