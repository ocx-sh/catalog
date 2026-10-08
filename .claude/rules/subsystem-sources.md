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

`readUrlSource` (`walker.ts`; there is no `url.ts`) does a conditional GET on
`/c/index.json` (`If-None-Match` sent verbatim, weak `W/"…"` included; weak
comparison is the *server's* job); a 304 serves the cached body. Roots and CAS
refs are loaded content-addressed by digest, so a cache hit *is* "unchanged
since last run" and no diff against the previous index is kept. Hard rules on
every fetch:

- **https only** (`config/load.ts`'s `SOURCE_URL_PROTOCOLS`): `/config.json` and
  `/c/index.json` are the only fetched files never digest-verified, so transport
  integrity is all they have.
- **No redirects** (`redirect: "manual"`): a 3xx on a required file fails the
  build naming the refused hop. An SSRF guard — a hostile source could bounce the
  builder at a host only it can reach and land those bytes in published,
  undigested files. A 3xx is never retried.
- **Bounded body** (`MAX_RESPONSE_BYTES`, 8 MiB), checked against
  `Content-Length` AND the decompressed stream while buffering.
- Every fetched byte sequence is digest-verified before being cached or
  returned (`SourceError("DIGEST_MISMATCH", …)`), never a silent pass-through.
- Concurrency capped at 16 (`Semaphore`); 3 retries after the first attempt with
  jittered exponential backoff.

## Git source: option-injection guard + LFS detection

`git.ts` passes `entry.git`/`entry.ref`/`entry.dir` as array args to `execFile`
(never a shell string), inserts `--` before the first such positional in every
`git` invocation, **and** rejects a leading-`-` value before it reaches
`runGit`: git parses a leading-`-` positional as an option
(`--upload-pack=<cmd>` is its documented argument-injection vector, unrelated to
shell quoting). The clone lands in a `mkdtemp` scratch dir.

A `--depth 1` clone never fetches LFS objects, so an LFS file resolves to its
pointer text. `git.ts` detects the pointer prefix in every sourced blob and
throws `SourceError("LFS_POINTER", …)` rather than serve it as a logo/readme.
`.gitmodules` presence triggers `options.warn` by name (submodules are never
cloned; their absence must not read as silent empty data).

## Reserved-segment / label rules

`labels.ts` is the deferred second half of label resolution `loadConfig` can't
finish (a `null` label is derived from fetched package roots). `resolveLabel`'s
derived path collects the distinct first-`/`-segment prefixes of every root's
`name`: exactly one is the label; zero roots or several prefixes is a hard error
(`LABEL_DERIVATION_EMPTY`/`LABEL_DERIVATION_CONFLICT`), never a picked winner.

An EXPLICIT label may only restate the name the index gives itself:
`assertLabelMatchesPrefixes` throws `LABEL_PREFIX_MISMATCH` on a disagreement
(the label names the index in the scope tabs, the segment names it on every
card). A source with zero package roots keeps its explicit label.

`resolveLabel`'s third parameter, `fallbackLabel`, is for a caller that
INVENTED the source rather than reading it from a config — today only
`build/dev.ts`'s `--source` sugar. It applies to the derived branch alone and
only when there is nothing to derive, so `dev` against an empty index still
boots. It is NOT an explicit label: passing a default as one is what silently
renamed every index `dev --source` was pointed at.

`checkIndexNamespaceCollisions` is the second deferred cross-source pass,
beside `checkLabelConflicts` and for the same reason (both need every source
read): a non-root label that is also a ROOT-source namespace makes two things
claim `/<label>/` — `INDEX_NAMESPACE_COLLISION`.

**Reserved names are computed per build (C-027).** `reservedNamesFor(loaded)`
(`sources_pipeline.ts`) builds the predicate: the static list (`p index data
docs assets 404 public _astro robots.txt _headers config.json c pagefind`, plus
the `sitemap-*` and `favicon*` families) PLUS every top-level name this build
puts at the output root — the consumer's `publicDir` entries and the basenames
of `brand.logo` and `css`. `checkReservedIndexLabels` applies it to every
non-root label and `checkReservedRootNamespaces` to every namespace of the root
source (its packages keep bare routes, so each namespace is a top-level segment);
both throw `INDEX_LABEL_RESERVED`. No hostile source is needed: an index whose
roots are named `docs/…` derives the label `docs`. Compared case-INSENSITIVELY,
since `SAFE_LABEL_RE` admits `Docs` and macOS/Windows resolve it to the same
directory. An unreadable `publicDir` is a `BuildError("DATA")`.

Both an explicit and a derived label go through `assertLabelPathSafe` — an
**allowlist** (`^[A-Za-z0-9._-]+$`), not a blocklist: a derived label comes
straight from a hostile source's own `root.name`, and a blocklist naming only
`/`/`\`/`.`/`..` still lets control characters (`\n`, injecting a new line or
block into the shared `_headers` file) through.

## Route shape and the merge

`resolveCatalog` keeps EVERY source's packages and never dedupes by
`<namespace>/<package>`: routes are index-qualified for every non-root source
(`[label, namespace, ...package]`, the `root: true` source keeps the bare path),
so two copies each get a page. Equal ids sort by index name, since
`compareQualifiedIds` alone is not a total order once ids can repeat.

`PackageRoute` therefore carries the ROUTE (`segments`) and the wire IDENTITY
(`namespace`/`package`) separately. Never read identity back out of
`segments`: its first element is a label, not a namespace, for every non-root
source.

## Mirror placement rule

`mirror.ts`'s `mirrorSources`: every source's tree is copied to
`<public>/index/<label>/**`, unconditionally. A `root: true` source's tree is
**additionally** written verbatim at the root (legacy-compat root placement),
never a substitute for the `index/<label>/` copy. Each source's own
`catalog.json` lands at `data/catalog/catalog.json` (root) or
`index/<label>/data/catalog/catalog.json`.

**The mirror is write-once (C-027).** `assertAbsent` refuses any path already in
the output, because `assemblePublic` (`build/assemble.ts`) has already put the
consumer's `publicDir`, `brand.logo`, `css`, the ocx-chrome `favicon.svg` and
`robots.txt` there; a mirrored path silently replacing one of them (a consumer
`_headers` lost to ours) is the defect. The single exception is
`data/catalog/catalog.json`: `emitCatalogTree` writes the **merged** catalog over
the root source's own copy LAST, so no consumer file shadows the real catalog.
`writeDistFile` also re-checks the resolved destination stays inside the output
directory, a second gate behind `walker.ts`'s `assertSafeQualifiedId`.
`_headers` patterns are prefixed by `base` (`renderHeaders(sources, base)`,
C-006); the file is inert on hosts that do not read it (see `product-context.md`).

## Scratch root, staging, and read-only builds (`src/build/scratch.ts`, `engine.ts`)

Scratch roots (`createScratchRoot`) live under `<cwd>/node_modules/.cache/ocx-catalog/`
(or `<cwd>/.ocx-catalog/` when no `node_modules` exists) — **never `os.tmpdir()`**:
the `astro` subprocess resolves its packages by walking up from the scratch
root, and a bare tmpdir root has no `node_modules` ancestor, so the child dies
with `Cannot resolve entry module astro/entrypoints/prerender`. Roots are per-pid
(`ocx-catalog-<pid>-*`) and self-sweeping (an `exit` hook is the backstop;
callers still `dispose()` in a `finally`). The root holds `astro.config.mjs`,
`site.json`, `public/`, `readme/` and, with `docs`, `src/content.config.ts` —
never `src/fetch.ts` or a page source (C-045).

Builds are staged and read-only (C-007, C-036, C-038): `--out` is `realpath`'d and
refused (`OUT_DIR_OVERLAPS_INPUT`, exit 65) when it overlaps the config dir, a
`path` source, `docs`, `css`, `publicDir` or `brand.logo`; Astro renders into a
sibling `<out>.staging-<pid>`, and only a fully successful build is promoted
(old `outDir` renamed aside, staging into place, old removed, rolled back on a
failed rename). A build therefore writes only `outDir`, its staging/retired
siblings, the url cache, a git clone's `mkdtemp` dir and its scratch root.

The `url` source's fetch cache (`cacheBaseDir()` + `"url"` + a hash of the URL)
lives **beside** scratch roots, **never inside one**: its value is surviving
*between* builds (ETag/CAS), and a self-sweeping root would delete it every run
while still looking correct.
