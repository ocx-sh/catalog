---
paths:
  - src/sources/**
  - src/build/**
---

# Source Subsystem

Three readers (`path.ts`, `walker.ts` for `url`, `git.ts`) turn one
`sources[]` entry into a `WirePath -> Uint8Array` map; `labels.ts` resolves
its display label; `mirror.ts` copies the result byte-verbatim into the
build's `dist/` tree. `src/build/sources_pipeline.ts` is where all of this
is wired into `build`/`dev`.

## Wire-shape filter (every reader)

Only `config.json` (root-level), `c/index.json`, and everything under `p/`
is included — `path.ts`'s `readDirectoryTree` is the shared primitive
`git.ts` reuses. A `path`/`git` source root is often a full repository
checkout, not a hand-curated export; an unfiltered copy would leak
`.git/`, `node_modules/`, unrelated docs into the public
`dist/index/<label>/` mirror. Both top-level files (`config.json`,
`c/index.json`) are **optional per source** — a missing one is not an error
at this layer, `tryIncludeFile` treats ENOENT as "not present".

## Containment: lexical, then realpath

`config/load.ts`'s `PATH_ESCAPE` check on a `path`/`git` source's `path`/`dir`
is **lexical only** (`resolve`/`relative` string math) — it never follows
symlinks. `path.ts`'s `assertContained` is the actual per-file enforcement
point (called from `tryIncludeFile`/`walkTree` as each entry is opened):
every file this subsystem opens is realpath-verified against its source
root's own realpath, **per file, not just once at the root** — a symlinked
file or subdirectory can appear at any depth during a recursive walk, and
only a per-file check catches both. `resolveContainedRealPath` is the
per-root variant (`readDirectoryTree`'s own root, `git.ts`'s `entry.dir`) —
a single call at the top of a walk, not the per-file gate. Never assume a
config having passed `loadConfig` proves a later read is safe.

`mirror.ts`'s `writeDistFile` re-checks the resolved write destination stays
inside `distDir` too, belt-and-braces against a malformed `WirePath` built
upstream from remote data (`walker.ts`'s `assertSafeQualifiedId` is the
primary fix; this is the second gate on the one function every write in this
module funnels through).

## Digest validation before any path join

`walker.ts`'s `casCachePath` runs `DIGEST_RE.test(digest)` (`sha256:[0-9a-f]{64}`,
fullmatch) before building any cache path from it — a digest reaching this
subsystem is remote data (`/c/index.json` entries, a root's own
`tags[*].content`/`desc.readme`/`desc.logo`), and digest verification of the
*fetched bytes* happens too late to catch a malformed digest *string* used to
build a path (`sha256:../../../tmp/evil`). Every digest-driven cache path
goes through this one function.

`walker.ts`'s `assertSafeQualifiedId` applies the same fullmatch-before-join
rule to a `/c/index.json` package id (a remote key) before it's used to build
`p/<qualifiedId>.json`/`.../o/sha256/...` wire paths.

## `url` source: conditional GET + CAS cache

`readUrlSource` (`walker.ts`) is the `url` reader — there is no `url.ts` file;
the sparse-index walker lives entirely in `walker.ts`. Conditional GET on
`/c/index.json` (`If-None-Match`, sent verbatim including a weak `W/"…"`
prefix — RFC 7232 weak comparison is the *server's* job, never this
function's); a 304 serves the cached body. Every currently enumerated
package's root and CAS refs are loaded content-addressed by digest — a cache
hit *is* "unchanged since last run", so no separate diff against the
previous index is kept.

Hard rules baked into every fetch:

- **https only** (`config/load.ts`'s `SOURCE_URL_PROTOCOLS`) — `/config.json`
  and `/c/index.json` are the only fetched files never digest-verified, so
  transport integrity is the only integrity they have.
- **No redirects** (`redirect: "manual"`) — a 3xx on a required file fails
  the build naming the refused hop; this is an SSRF guard (a hostile source
  could otherwise bounce the builder at a host only it can reach, and those
  bytes would land in published, undigested `config.json`/`c/index.json`).
- **Bounded response body** (`MAX_RESPONSE_BYTES`, 8 MiB) — checked against
  `Content-Length` up front and against the actual decompressed stream while
  buffering, since a compressed body's declared length says nothing about
  its inflated size.
- Every fetched byte sequence is digest-verified before being cached or
  returned — a mismatch is `SourceError("DIGEST_MISMATCH", …)`, never a
  silent pass-through.
- Concurrency capped at 16 (`Semaphore`) across the combined root+CAS fetch
  queue; each request retries 3 times after its initial attempt (4 total)
  with jittered exponential backoff. A 3xx is never retried — it's a
  deterministic policy refusal, not a transient failure.

## Git source: option-injection guard + LFS detection

`git.ts` passes `entry.git`/`entry.ref`/`entry.dir` as array args to
`execFile` (never a shell string — defeats shell injection), **and** inserts
`--` before the first such positional in every `git` invocation, **and**
rejects a leading-`-` value outright before it reaches `runGit` at all —
belt-and-braces, since git itself parses a leading-`-` positional as an
option (`--upload-pack=<cmd>` is git's own documented argument-injection
vector, unrelated to shell quoting).

A `--depth 1` clone never fetches LFS objects — an LFS-tracked file resolves
to its pointer text, not real bytes. `git.ts` detects the LFS pointer prefix
in every sourced blob and throws `SourceError("LFS_POINTER", …)` rather than
silently serving pointer text as a package's logo/readme.

`.gitmodules` presence triggers `options.warn` by name — submodules are
never cloned, but the file's presence must never manifest as silent empty
data.

## Reserved-segment / label rules

`labels.ts` is the deferred second half of label resolution `loadConfig`
can't finish (an explicit label is checked pairwise there; a `null` label is
derived from a source's own package roots, which needs fetched data
`loadConfig` never touches). `resolveLabel`'s derived path collects distinct
first-`/`-segment prefixes of every root's `name` in a source — exactly one
⇒ that's the label; zero package roots or more than one distinct prefix is a
hard error (`LABEL_DERIVATION_EMPTY`/`LABEL_DERIVATION_CONFLICT`), never a
silently picked winner.

Both an explicit and a derived label go through `assertLabelPathSafe` — an
**allowlist** (`^[A-Za-z0-9._-]+$`), not a blocklist: a derived label comes
straight from a hostile source's own `root.name`, and a blocklist naming only
`/`/`\`/`.`/`..` still lets control characters (`\n`, injecting a new line or
block into the shared `_headers` file) through.

## Mirror placement rule

`mirror.ts`'s `mirrorSources`: every source's tree is copied to
`dist/index/<label>/**`, unconditionally. A `root: true` source's tree is
**additionally** written verbatim at `dist/` itself (legacy-compat root
placement) — never a substitute for the `index/<label>/` copy. Each source's
own `catalog.json` lands at `data/catalog/catalog.json` (root) or
`index/<label>/data/catalog/catalog.json` (otherwise); the **merged**
multi-source catalog is written **last**, overwriting the root path, by
`sources_pipeline.ts`'s `emitCatalogTree` — a deliberate last-write-wins so a
consumer's own `publicDir` file at that path never shadows the real catalog.

## Scratch-root lifecycle (`src/build/scratch.ts`)

Scratch roots (`createScratchRoot`) live under
`<cwd>/node_modules/.cache/ocx-catalog/` (or `<cwd>/.ocx-catalog/` when no
`node_modules` exists yet) — **never `os.tmpdir()`**. A bare tmpdir root has
no `node_modules` ancestor chain, so Node's bare-specifier resolution for the
generated config's `import ... from "vitepress"` can't reach this package's
own install; a real build against such a root fails outright (confirmed by
spike). Self-sweeping (a process-`exit` hook is the backstop, not the
primary path — callers still call `dispose()` in a `finally`).

The `url` source's fetch cache (`cacheBaseDir()` + `"url"` + a hash of the
source URL) lives **beside** scratch roots under the same base directory,
**never inside one** — its whole value is surviving *between* builds
(ETag/CAS), and a self-sweeping scratch root would delete it every run,
silently turning every build into a cold fetch while still looking correct.
