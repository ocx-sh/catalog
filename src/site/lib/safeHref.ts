// Allowlists `http:`/`https:` before a wire-sourced URL is ever rendered as
// an `:href` — `upstream.repository_url` is third-party-authored (mirrored
// from a package's own metadata, not authored here), so a `javascript:` (or
// other non-http(s)) scheme there is untrusted input reaching a DOM sink
// (CWE-79). `new URL()` also rejects anything that isn't a well-formed
// absolute URL. The string must also literally start `http(s)://`: the URL
// parser accepts `http:evil.test` (and leading whitespace or an embedded tab)
// as http, but a browser resolves that spelling against the page when the
// schemes match, so it is not the absolute URL it looks like.

/**
 * Returns `url` unchanged when it parses as an absolute `http:`/`https:`
 * URL spelled `http(s)://…`, `null` otherwise (missing, malformed, or a
 * disallowed scheme) — call
 * sites render a plain-text fallback on `null` instead of a link.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const http = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    return http && /^https?:\/\//i.test(url) ? url : null
  } catch {
    return null
  }
}
