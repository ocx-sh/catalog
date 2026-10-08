// CAS (content-addressed storage) URL helper for the site's islands and model.
//
// `wireBase` is the mount prefix of the source a package came from — `''`
// (the site root) for the `root: true` source, `index/<label>` for every
// other, matching where `sources/mirror.ts` wrote that source's tree. It
// reaches the browser through the detail page's model (`model/detail.ts`).
// `wirePrefix` is re-exported from the view model rather than re-declared
// here — there is no build-split reason to own a second copy of a one-line
// function.
//
// Builds the `/p/<ns>/<pkg>/o/sha256/<hex>.<ext>` shape locked by
// `adr_locked_observation_index_format.md` D2. Islands fetch these URLs
// directly instead of duplicating blob bytes into `/data/catalog/**`.

// ponytail: the wire *schema* pins this to strict `[a-f0-9]{64}` (real
// digests are always hashlib-hex), but this guard's actual job is path
// safety at a URL-building boundary — reject anything that could escape the
// `/o/sha256/<seg>.<ext>` path segment (`/`, `..`, whitespace, etc.), not
// re-enforce hex-ness the schema already owns. `[a-z0-9]` (not `[a-f0-9]`)
// is deliberate: `[a-f0-9]` silently dropped the fetch (no error, no request)
// for any digest using a non-hex letter, so every `demo:seed`-sourced README
// (readability-letter placeholder digests, e.g. "kkkk...") never fetched
// although the exact CAS path existed and returned 200.
import { wirePrefix } from '../../viewmodel/catalog.js'
import { joinBase } from '../../viewmodel/url.js'

export { wirePrefix }

const DIGEST_RE = /^sha256:([a-z0-9]{64})$/
// One `/`-separated segment of a package name: no dot segment, no separator,
// query/fragment/escape or control character. The name is wire data and is
// interpolated into a fetch URL.
const NAME_SEGMENT_RE = /^(?!\.{1,2}$)[^/\\?#%\p{Cc}]+$/u

/** True when `pkgName` is a plain `/`-separated name — the guard every
 * wire-data-to-fetch-URL builder here shares. */
export function isSafePackageName(pkgName: string): boolean {
  return pkgName.split('/').every(segment => NAME_SEGMENT_RE.test(segment))
}

/**
 * `digest` is the bare `sha256:<hex>` string the wire root's `desc.logo` /
 * `desc.readme` fields carry (schema: `sha256Digest`) — never a full path.
 * Returns `null` when there is no digest, it doesn't match the expected
 * shape, or `pkgName` is not a plain `/`-separated name (defensive: a
 * malformed/absent digest or an escaping name degrades to "no asset", never
 * a broken request).
 */
export function casUrl(
  pkgName: string,
  digest: string | null | undefined,
  ext: string,
  wireBase = '',
): string | null {
  if (!digest) return null
  const match = DIGEST_RE.exec(digest)
  if (!match || !isSafePackageName(pkgName)) return null
  return `${wirePrefix(wireBase)}/p/${pkgName}/o/sha256/${match[1]}.${ext}`
}

/** The mirrored package root, `base`-joined: `/p/<ns>/<pkg>.json` under the
 * source's `wireBase` — what the versions island fetches (C-016). */
export function rootHref(base: string, pkgName: string, wireBase = ''): string {
  return joinBase(base, `${wirePrefix(wireBase)}/p/${pkgName}.json`)
}
