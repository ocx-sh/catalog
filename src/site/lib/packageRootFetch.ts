import { wirePrefix } from './cas.js'
import type { FetchLike, PackageRoot } from './wireTypes.js'

/** `stale`: a newer request superseded this one mid-flight — write nothing. */
export type PackageRootResult =
  | { status: 'ok'; root: PackageRoot }
  | { status: 'not-found' }
  | { status: 'stale' }

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
 * (HTTP error, network error, malformed JSON) throw — the caller owns the
 * stale check on that path too.
 */
export async function fetchPackageRoot(
  fetchFn: FetchLike,
  ns: string,
  pkg: string,
  wireBase: string,
  isCurrent: () => boolean,
): Promise<PackageRootResult> {
  const base = wirePrefix(wireBase)
  let resp = await fetchFn(`${base}/p/${ns}/${pkg}/_root.json`)
  if (!isCurrent()) return { status: 'stale' }
  if (resp.status === 404) {
    resp = await fetchFn(`${base}/p/${ns}/${pkg}.json`)
  }
  if (!isCurrent()) return { status: 'stale' }
  if (resp.status === 404) return { status: 'not-found' }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const root: PackageRoot = await resp.json()
  if (!isCurrent()) return { status: 'stale' }
  return { status: 'ok', root }
}
