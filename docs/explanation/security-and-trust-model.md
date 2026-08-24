# Security and trust model

A configured source is third-party data, not a trusted input. The build
reads it, and the published site then serves it same-origin, to every
visitor's browser. Every control in this section exists because of that
second step: a vulnerability in how a source is read or displayed is not
contained to the build machine — it ships.

## https-only `url` sources

`loadConfig` (`src/config/load.ts`) rejects any `sources[].url` whose
protocol isn't `https:` — not "http or https". Two files a `url` source
fetches, `/config.json` and `/c/index.json`, are never digest-verified
against anything (there is nothing to verify them against; they are the
starting point of trust, not a leaf under it). If either travelled over
plain `http:`, a network attacker could rewrite the enumeration a build
reads — and every downstream digest check would then verify each fetched
package root against the *attacker's own* digests, and pass cleanly.
Transport integrity is the only integrity those two files have.

## No redirects, ever

Every fetch `src/sources/walker.ts` makes sets `redirect: "manual"` and
treats any 3xx response as a hard failure, naming the refused hop, rather
than following it. This is an SSRF guard: a hostile configured `url` source
could otherwise bounce the builder at a host it can reach but the operator
never intended to expose — and those bytes would land in published,
undigested `config.json`/`c/index.json` content. A redirect is a
deterministic policy refusal here, not a transient failure, so it is never
retried either.

## Digest verification and realpath re-checks

Every byte a `url` source fetches beyond `config.json`/`c/index.json` is
verified against its own digest before being cached or returned —
`SourceError("DIGEST_MISMATCH", …)` on any mismatch, naming the file and
both digests, never a silent pass-through.

`path` and `git` sources get the filesystem equivalent. `loadConfig`'s own
containment check on a `path`/`git` source's directory is lexical only
(string `resolve`/`relative` math) — it never follows symlinks. The actual
enforcement point is `src/sources/path.ts`'s `assertContained`, called
**per file**, not just once at the source root: every file this subsystem
opens has its `realpath` re-verified against the source root's own
`realpath` immediately before the read. A symlinked file or subdirectory can
appear at any depth during a recursive walk, and only a per-file check
catches both — a config having already passed `loadConfig` proves nothing
about a later read being safe.

## Resource caps: the denial-of-service boundary

A hostile or merely careless source can otherwise exhaust memory, disk, or
wall-clock time before any digest check gets a chance to reject it. The
caps, read directly from `src/sources/walker.ts` and `src/sources/mirror.ts`:

| Cap | Value | What it bounds |
|---|---|---|
| Response body size | 8 MiB | One `url`-fetched file's decompressed byte count |
| Fetch/write concurrency | 16 in flight | The combined root+CAS fetch queue, and the mirror write queue |
| Fetch attempts | 4 (1 + 3 retries) | Exponential backoff per URL; a 3xx is never retried |
| `/c/index.json` entries | 50,000 packages | How large one source's enumeration may declare itself |
| CAS content asset size | 1 MiB | A mirrored README/logo blob from a `path`/`git` source (oversized ones are skipped and warned, never silently included) |

## Git: argument-injection defences

`src/sources/git.ts` passes `entry.git`/`entry.ref`/`entry.dir` as array
arguments to `execFile` — never a shell string, which already defeats shell
injection. Git itself still parses a leading-`-` positional as an option
(`--upload-pack=<cmd>` is git's own documented argument-injection vector,
unrelated to shell quoting), so two independent layers close that separately:
every invocation inserts `--` (end-of-options) immediately before the first
such positional, **and** `assertNotOptionLike` rejects a leading-`-` value
outright before it ever reaches `runGit`.

A `--depth 1` clone never fetches LFS objects, so an LFS-tracked file
resolves to its pointer text, not the real bytes — `git.ts` detects the LFS
pointer prefix in every sourced blob and throws
`SourceError("LFS_POINTER", …)` rather than silently serving pointer text as
a package's logo or readme. `.gitmodules` presence triggers a named warning
through `options.warn`; submodules are never cloned, but their presence must
never manifest as silent empty data.

## Label allowlist

A source's display label becomes both a filesystem path segment
(`dist/index/<label>/`) and a line in the shared `_headers` file. When a
source declares no explicit label, `src/sources/labels.ts` derives one from
the source's own package roots — which makes a derived label **hostile
data**, sourced from whatever a third-party index author put in `root.name`.
`assertLabelPathSafe` checks it against an allowlist
(`^[A-Za-z0-9._-]+$`), deliberately not a blocklist: a blocklist naming only
`/`, `\`, `.`, `..` would still let control characters through, and a label
containing a raw newline could inject a new line — or, with two newlines, a
whole new block — into `_headers`, a line-oriented format shared by every
mirrored source.

## The `_headers` sandbox

`renderHeaders()` (`src/sources/mirror.ts`) writes one Cloudflare
Pages/Netlify `_headers` rule per mirrored source, applying
`Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` to
every `/p/*` and `/index/<label>/p/*` prefix — the untrusted, same-origin
content a configured source handed this renderer (a README, a logo, a
package root), never authored by it.

This is a **hard deployment precondition**, not a nice-to-have, and it is
honoured only by Cloudflare Pages and Netlify. On a host that doesn't read
`_headers` the file still ships but is inert, and `ocx-catalog dev` never
reads it at all. See [Hosting and headers](../ops/hosting-and-headers.md)
for what that means for every other host and what a deployer has to do
about it themselves.
