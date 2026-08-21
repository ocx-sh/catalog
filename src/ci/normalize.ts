/**
 * Canonicalize a rendered/committed CI file for drift comparison. Ported
 * from grimoire-indexer's `normalizeForDrift` (`src/ci.ts`, ~line 374):
 * line endings first (a CRLF checkout must never itself read as drift
 * against an LF render), then the `@ref` and any trailing comment stripped
 * from a GitHub Actions `uses:` line — the repository owns the *pin* on
 * every action reference, so its own Renovate/Dependabot bumping
 * `uses: owner/action@<ref>  # vX` must not read as a hand-edit; only the
 * suffix is stripped, so swapping in a different action still trips drift.
 *
 * Extended (C-007) with the same tolerance for a GitLab `image:` line's
 * digest ref — this module renders no digest pin by default, but a
 * consumer's own image-update bot may add or bump one, and that must not
 * trip drift either.
 */
export function normalizeForDrift(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/^([ \t]*(?:-[ \t]+)?uses:[ \t]*[^@\s]+)@[^\s#]+(?:[ \t]*#[^\n]*)?$/gm, "$1")
    .replace(/^([ \t]*image:[ \t]*[^@\s]+)@[^\s#]+(?:[ \t]*#[^\n]*)?$/gm, "$1");
}
