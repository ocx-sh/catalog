# Troubleshooting

Start from what you saw:

- **A build or `ci` run failed with an error code** — [Error codes](#error-codes) below.
- **The CLI exited with a bare number and no obvious message** — [Exit codes](#exit-codes).
- **`dev --smoke` passed but a page doesn't render** — [see below](#dev-smoke-passed-but-a-page-does-not-render).
- **A package shows in the grid but its detail page 404s** — [see below](#a-package-shows-in-the-grid-but-its-detail-page-404s).
- **The deployed site is blank, or every asset 404s** — [see below](#the-deployed-site-is-blank-or-every-asset-404s).

## Error codes

Every thrown error in this codebase carries a stable `code`, printed as part
of the message. These are exhaustive per source file — nothing here is
invented.

### Config errors (`src/config/errors.ts`, raised by `loadConfig`)

| Code | What triggers it | What to change |
|---|---|---|
| `MISSING_FILE` | The config path doesn't exist (`ENOENT`) | Check `--config`/the default `catalog.config.json` path |
| `READ_ERROR` | The config path exists but can't be read (e.g. it's a directory, or a permission error) | Fix the path or its permissions |
| `INVALID_JSON` | The config file isn't valid JSON | Fix the JSON syntax |
| `INVALID_TYPE` | A field's type doesn't match the schema (includes an empty string where a non-empty one is required, and a malformed `siteUrl`/`sources[].url`/`nav[].link`) | Fix the field named in the message |
| `UNKNOWN_KEY` | An unrecognized key at the top level, or inside a `sources[]` entry, `brand`, `footer`, or a `nav[]`/`footer.links[]`/`docsNav[]` entry (`ci`'s own keys are exempt) | Remove or rename the key |
| `UNSUPPORTED_VERSION` | `configVersion` names a version this loader doesn't support | Use a supported `configVersion`, or upgrade `@ocx-sh/catalog` |
| `SOURCE_DISCRIMINANT` | A `sources[]` entry has zero, or more than one, of `path`/`url`/`git` | Set exactly one of those three keys per entry |
| `EMPTY_SOURCES` | `sources` is present but has no entries | Add at least one source |
| `MULTIPLE_ROOT` | More than one `sources[]` entry sets `root: true` | Keep `root: true` on at most one entry |
| `MULTIPLE_DEFAULT` | More than one `sources[]` entry sets `default: true` | Keep `default: true` on at most one entry |
| `LABEL_CONFLICT` | Two `sources[]` entries declare the same explicit `label` | Give each source a distinct label |
| `PATH_ESCAPE` | A `css`/`docs`/`publicDir`/`brand.logo`/`path` value resolves outside the config file's own directory | Point the value back inside the config directory |

### Source-reading errors (`src/sources/types.ts`, raised by `path.ts`/`walker.ts`/`git.ts`/`labels.ts`)

| Code | What triggers it | What to change |
|---|---|---|
| `PATH_ESCAPE` | A file's realpath resolves outside its source root (symlink escape), a git `git`/`ref`/`dir` value starts with `-` (looks like a git option), or a malformed CAS digest was about to be used in a cache path | Fix the symlink target, or the offending config value |
| `FETCH_FAILED` | A `url` source stayed unreachable after exhausting its retries, or a request received a redirect (never followed) | Check the source URL is reachable and returns no redirects |
| `DIGEST_MISMATCH` | A fetched file's bytes don't match the digest it was fetched against | The source is serving inconsistent data — fix it at the source, this isn't fixable from the catalog config |
| `GIT_SHA_UNSUPPORTED` | A commit-SHA `ref` was requested but the remote won't let you fetch an arbitrary commit it never advertised | Use a branch/tag name instead of a raw SHA, or a remote that allows `allow-tips-sha1-in-want` |
| `LFS_POINTER` | A sourced blob is a Git LFS pointer file, not the real bytes (a `--depth 1` clone never fetches LFS objects) | Don't LFS-track files this package needs to read, or fetch them another way |
| `LABEL_DERIVATION_EMPTY` | A source set no explicit `label` and has zero package roots to derive one from | Add an explicit `label`, or make sure the source actually publishes packages |
| `LABEL_DERIVATION_CONFLICT` | A source set no explicit `label` and its own package roots disagree on their first name segment | Fix the source's data — its roots must agree on which index they belong to |
| `LABEL_CONFLICT` | Two sources — any mix of explicit and derived labels — resolve to the same final label | Give one of them an explicit, distinct `label` |
| `LABEL_PATH_UNSAFE` | A resolved label (explicit or derived) isn't safe as one filesystem path segment | Use a label matching `^[A-Za-z0-9._-]+$` |
| `LABEL_PREFIX_MISMATCH` | An explicit `label` disagrees with the first name segment its own package roots carry — the scope tab and every card would name the index differently | Use the name the index gives itself, or drop `label` and let it derive |
| `INDEX_NAMESPACE_COLLISION` | A non-root source's label is also a namespace the `root: true` source publishes, so both claim `/<that name>/**` | Rename the index, or move that namespace out of the root source |
| `INDEX_LABEL_RESERVED` | A non-root source's label is a top-level path the build writes itself (`p`, `index`, `data`, `docs`, `assets`, `404`, `public`), so both claim `/<that name>/**`. Compared case-insensitively | Rename the index; these seven names are reserved |

### CI errors (`src/ci/errors.ts`, raised by `ocx-catalog ci`)

| Code | What triggers it | What to change |
|---|---|---|
| `MISSING_CI_CONFIG` | `catalog.config.json` has no `ci` block | Add a `ci` block naming a `forge` |
| `TOOL_TOO_OLD` | A previously rendered file's header names a version newer than this installed tool supports | Upgrade `@ocx-sh/catalog` |
| `DRIFT` | `ocx-catalog ci --check` found a rendered file that doesn't match a fresh render | Re-run `ocx-catalog ci` (without `--check`) and commit the result |

## Exit codes

Every `ocx-catalog` invocation sets one of five sysexits-derived codes
(`src/cli/exit.ts`). Full flag-by-flag detail: [CLI reference](../reference/cli.md).

| Code | Name | Likely cause |
|---|---|---|
| `0` | OK | Success |
| `1` | FAIL | An unexpected, uncaught error — not one of the classified failure modes below |
| `64` | USAGE | Bad CLI invocation: an unknown flag, `dev --source` and `--config` given together, or an invalid `--port` value |
| `65` | DATA | A `ConfigError`, a `CiError`, or a `BuildError` with code `DATA` — a config-shape problem or malformed/inconsistent source data (see the error-code tables above) |
| `69` | UNAVAILABLE | A `BuildError` with code `UNAVAILABLE` — an unreachable `url` source, or `dev`'s port already bound |

## `dev --smoke` passed but a page does not render

`--smoke` proves the dev server booted and became ready, then exits — it is
a startup check, not a page-render check. `src/build/dev.ts` documents
`devServer()` as booting and resolving identically whether `--smoke` is set
or not; the smoke/interactive distinction is only about whether the caller
closes the server immediately or waits for `Ctrl-C`. A green `--smoke` run
tells you the server started; it tells you nothing about whether a specific
route serves the content you expect. Load the page yourself (interactive
`dev`, or `build` + a static file server) to check actual rendering.

## A package shows in the grid but its detail page 404s

Every source's packages have working detail pages, so this is a stale link
rather than a limitation. A package from a non-root index is served at
`/<index>/<namespace>/<package>`, not at the bare `/<namespace>/<package>` —
only the `root: true` source keeps the bare path. Copy the link from the card
(or right-click → **Copy link**) rather than hand-building one from the
namespace and package alone; see
[Multi-source model](../explanation/multi-source-model.md).

## The deployed site is blank, or every asset 404s

Almost always the subpath limitation: the site is being served under a path
prefix (a GitHub Pages project site at `/<repo>/`, for example) instead of a
true domain root. Every fetch this package's client-side code makes is a
literal root-relative path with no configurable prefix — see
[Known limitations #1](known-limitations.md#1-no-subpath-support) and
[Hosting and headers](hosting-and-headers.md) for which hosts give you a
root by default and which don't.
