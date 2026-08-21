// CAS (content-addressed storage) URL helper for catalog/detail components.
//
// Builds the `/p/<ns>/<pkg>/o/sha256/<hex>.<ext>` shape locked by
// `adr_locked_observation_index_format.md` D2. Components reference these
// URLs directly instead of duplicating blob bytes into `/data/catalog/**`
// (the deliberate divergence from ocx-sh/ocx's website theme recorded in
// `adr_catalog_docs_colocation.md`).

// ponytail: the wire *schema* pins this to strict `[a-f0-9]{64}` (real
// digests are always hashlib-hex), but this guard's actual job is path
// safety at a URL-building boundary — reject anything that could escape the
// `/o/sha256/<seg>.<ext>` path segment (`/`, `..`, whitespace, etc.), not
// re-enforce hex-ness the schema already owns. `[a-z0-9]` (not `[a-f0-9]`)
// matches what `useImageIndex.ts`'s sibling CAS-URL path already accepts
// unchecked for the exact same tags[*].content digest field. Previously
// `[a-f0-9]` here silently dropped the fetch (`if (!url) failed = true`, no
// error, no request) for any digest using a non-hex letter — the bug: every
// `demo:seed`-sourced README (readability-letter placeholder digests, e.g.
// "kkkk...") never fetched despite the exact CAS path existing and
// returning 200 (confirmed via curl + Playwright network capture).
const DIGEST_RE = /^sha256:([a-z0-9]{64})$/

/**
 * `digest` is the bare `sha256:<hex>` string the wire root's `desc.logo` /
 * `desc.readme` fields carry (schema: `sha256Digest`) — never a full path.
 * Returns `null` when there is no digest or it doesn't match the expected
 * shape (defensive: a malformed/absent digest degrades to "no asset", never
 * a broken request).
 */
export function casUrl(pkgName: string, digest: string | null | undefined, ext: string): string | null {
  if (!digest) return null
  const match = DIGEST_RE.exec(digest)
  if (!match) return null
  return `/p/${pkgName}/o/sha256/${match[1]}.${ext}`
}

// ponytail: the wire schema's `desc.logo` digest carries no extension (CAS
// filenames are `.svg` or `.png`, ADR D2), so a logo URL can't be built from
// the digest alone. Try `.svg` first (the common case), fall back to `.png`
// on a load error, then give up (placeholder icon) — see `onLogoError`
// callers. Upgrade path: if a future `/data/catalog` revision (WP2-F, not
// wire-locked) adds an explicit extension field, drop the guess-and-retry.
export const LOGO_EXT_CANDIDATES = ['svg', 'png'] as const
