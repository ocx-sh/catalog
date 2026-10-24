---
title: "Troubleshooting"
sidebar:
  order: 3
---
<!-- doc_type: reference -->

Start from what you saw:

- **A build or `ci` run failed with an error code** — [Error codes](#error-codes) below.
- **The build failed naming a file in `publicDir`, `css`, `brand.logo` or `docs`**: see [Build errors](#build-errors-exit-65).
- **The CLI exited with a bare number and no obvious message** — [Exit codes](#exit-codes).
- **`dev --smoke` passed but a page doesn't render** — [see below](#dev---smoke-passed-but-a-page-does-not-render).
- **A package shows in the grid but its detail page 404s** — [see below](#a-package-shows-in-the-grid-but-its-detail-page-404s).
- **The deployed site is blank, or every asset 404s** — [see below](#the-deployed-site-is-blank-or-every-asset-404s).

## Error codes

Every thrown error in this codebase carries a stable `code`, printed as part
of the message. These are exhaustive per source file — nothing here is
invented.

### Config errors (`src/config/errors.ts`, raised by `loadConfig` and the output-directory guard)

| Code | What triggers it | What to change |
|---|---|---|
| `MISSING_FILE` | The config path doesn't exist (`ENOENT`) | Check `--config`/the default `catalog.config.json` path |
| `READ_ERROR` | The config path exists but can't be read (e.g. it's a directory, or a permission error) | Fix the path or its permissions |
| `INVALID_JSON` | The config file isn't valid JSON | Fix the JSON syntax |
| `INVALID_TYPE` | A field's type doesn't match the schema (includes an empty string where a non-empty one is required, and a malformed `siteUrl`/`sources[].url`/`nav[].link`, an `ownerUrl` without exactly one `{login}`, or a `favicon` or link that is `//host`, a bare file name, `javascript:` or has a dot segment) | Fix the field named in the message |
| `UNKNOWN_KEY` | An unrecognized key at the top level, or inside a `sources[]` entry, `brand`, `footer`, or a `nav[]`/`footer.links[]`/`docsNav[]` entry (`ci`'s own keys are exempt) | Remove or rename the key |
| `UNSUPPORTED_VERSION` | `configVersion` names a version this loader doesn't support | Use a supported `configVersion`, or upgrade `@ocx-sh/catalog` |
| `SOURCE_DISCRIMINANT` | A `sources[]` entry has zero, or more than one, of `path`/`url`/`git` | Set exactly one of those three keys per entry |
| `EMPTY_SOURCES` | `sources` is present but has no entries | Add at least one source |
| `MULTIPLE_ROOT` | More than one `sources[]` entry sets `root: true` | Keep `root: true` on at most one entry |
| `MULTIPLE_DEFAULT` | More than one `sources[]` entry sets `default: true` | Keep `default: true` on at most one entry |
| `LABEL_CONFLICT` | Two `sources[]` entries declare the same explicit `label` | Give each source a distinct label |
| `PATH_ESCAPE` | A `css`/`docs`/`publicDir`/`brand.logo`/`path` value resolves outside the config file's own directory | Point the value back inside the config directory |
| `BASE_INVALID` | `base`, or the path of `siteUrl` (its default), is not a canonical URL path prefix: it needs a leading and trailing `/`, segments of letters, digits, `.`, `_` and `-`, and no `.` or `..` segment | Write `base` like `/` or `/catalog/` |
| `BASE_SITEURL_MISMATCH` | `base` and the path of `siteUrl` both carry a path and differ | Drop `base` (the `siteUrl` path implies it), or make the two agree |
| `CHROME_OCX_CONFLICT` | `chrome: "ocx"` is combined with `brand`, `nav`, `footer` or `docsNav`, which the ocx.sh shell owns | Remove those keys, or use the default `neutral` chrome |
| `OUT_DIR_OVERLAPS_INPUT` | `--out` equals or contains an input (the config directory, a `path` source, `docs`, `css`, `publicDir`, `brand.logo`), or lies inside `docs` or `publicDir`. Also raised when `--out` collides with the internal scratch root | Pick an output directory outside every input, such as `dist` |

### Source-reading errors (`src/sources/types.ts`, raised by `path.ts`/`walker.ts`/`git.ts`/`labels.ts`)

| Code | What triggers it | What to change |
|---|---|---|
| `PATH_ESCAPE` | A file's realpath resolves outside its source root (symlink escape), a git `git`/`ref`/`dir` value starts with `-` (looks like a git option), or a malformed CAS digest was about to be used in a cache path | Fix the symlink target, or the offending config value |
| `FETCH_FAILED` | A `url` source stayed unreachable after exhausting its retries (network error or a non-2xx status), answered a required file with a 404 (not retried), sent a response over the size cap, or answered with a redirect (never followed); or a `git` source's clone or fetch failed (unreachable or missing remote, bad `ref`). A 404 on a tag's image-index object is not this: that tag is skipped with a warning | Check the source URL or repository is reachable, serves its own wire tree and returns no redirects |
| `DIGEST_MISMATCH` | A fetched file's bytes don't match the digest it was fetched against | The source is serving inconsistent data — fix it at the source, this isn't fixable from the catalog config. A source redeployed while the build was reading it can show this once; the build already re-reads `c/index.json` once when a root fails its digest or 404s, or a tag's image-index object 404s, and walks the new tree if it changed. A failure that survives the re-read is real — re-run the build only after the deploy settles |
| `GIT_SHA_UNSUPPORTED` | A commit-SHA `ref` was requested but the remote won't let you fetch an arbitrary commit it never advertised | Use a branch/tag name instead of a raw SHA, or a remote that allows `allow-tips-sha1-in-want` |
| `LFS_POINTER` | A sourced blob is a Git LFS pointer file, not the real bytes (a `--depth 1` clone never fetches LFS objects) | Don't LFS-track files this package needs to read, or fetch them another way |
| `LABEL_DERIVATION_EMPTY` | A source set no explicit `label` and has zero package roots to derive one from | Add an explicit `label`, or make sure the source actually publishes packages |
| `LABEL_DERIVATION_CONFLICT` | A source set no explicit `label` and its own package roots disagree on their first name segment | Fix the source's data — its roots must agree on which index they belong to |
| `LABEL_CONFLICT` | Two sources — any mix of explicit and derived labels — resolve to the same final label | Give one of them an explicit, distinct `label` |
| `LABEL_PATH_UNSAFE` | A resolved label (explicit or derived) isn't safe as one filesystem path segment | Use a label matching `^[A-Za-z0-9._-]+$` |
| `LABEL_PREFIX_MISMATCH` | An explicit `label` disagrees with the first name segment its own package roots carry — the scope tab and every card would name the index differently | Use the name the index gives itself, or drop `label` and let it derive |
| `INDEX_NAMESPACE_COLLISION` | A non-root source's label is also a namespace the `root: true` source publishes, so both claim `/<that name>/**` | Rename the index, or move that namespace out of the root source |
| `INDEX_LABEL_RESERVED` | A non-root source's label, or a namespace the `root: true` source publishes, equals a top-level path the build writes itself. Both would claim `/<that name>/**`. Compared case-insensitively | Rename the index, or move the namespace. See [Reserved names](../../reference/config-schema/#reserved-names) for the full set |
| `OUTPUT_COLLISION` | A path the mirror writes is already in the output: a `publicDir` file such as `_headers`, or a path two sources both claim. The message reads `refusing to overwrite "<path>"`. 0.5.x let the generated file win silently | Remove or rename the `publicDir` file, or fix the two sources |
| `UNSUPPORTED_FORMAT` | A source's `config.json` or `c/index.json` declares a `format_version` other than `1` (an absent one is accepted). Exit `65` | The index is newer than this catalog reads: upgrade `@ocx-sh/catalog`, or point the source at an index published in format 1 |

### Build errors (exit 65)

These are `BuildError` failures with code `DATA`, raised in `src/build/` while it reads data and assembles the site, plus the plain parse errors from `src/sources/`. The message names the file.

| What the message says | What triggers it | What to change |
|---|---|---|
| `brand.logo "<path>"` `would be copied to /<name>, which publicDir already provides` | `brand.logo` has the same file name as a different `publicDir` file, so both are copied to the same top-level path. A logo that is itself that `publicDir` file is not a collision | Rename one of the files, or move one of them out of `publicDir` |
| `malformed root at <path>` | A package root has a field of the wrong type, such as `owners` that is not an array of objects, or `source` or `superseded_by` that is not a string | Fix the root file at its source |
| `docs: <file> frontmatter is not valid YAML` | A docs page has a frontmatter block that does not parse | Fix the YAML in that file |
| `docs: <file> frontmatter "title" must be a string`, or `"order" must be a number` | A docs frontmatter field has the wrong type | Fix the field |
| `docs: <file> is not a routable page name` | A docs file name contains `#`, `?`, `%`, `\` or a control character | Rename the file |
| `docs: <a> and <b> both map to /docs/<route>/` | Two files map to one route: `foo.md` and `foo/index.md`, or names that differ only in letter case or Unicode normalisation | Rename a file |
| `docs: <file> is a symbolic link` | The docs tree holds a symbolic link, which could carry a file from outside the tree into the site | Replace it with a copy of the file |
| `docs: <file> would replace the page /docs/<route>/` | A non-Markdown file in the docs tree, such as `guide/index.html`, would overwrite a page in the built site | Rename the file |
| `docs: <file> links to "<link>", which is not a page` (or `a file`) in the docs directory | A docs page links to a page or file that does not exist. A dot-file and a `.md` or `.mdx` source count as missing. The line comes from Astro's content log, and the build then stops with `did not render` | Fix the link or add the file. A file served from `publicDir/docs/` is found there |
| `css "<path>" does not exist`, or `is not a regular file` | `css` names a path that is missing or is a directory | Point `css` at a file |
| `css "<path>" is outside the config directory` | A file the stylesheet imports or references with `@import` or `url()` resolves outside the config directory, possibly through a symlink or an absolute, `/@fs/` or root-relative `url()`. The message names the file | Move the file inside the config directory, drop the reference, or import a package by its bare name (`@import "pkg/x.css"`) |
| `css "<path>" cannot be resolved (ELOOP)` (or `ENOTDIR`) | A reference in the stylesheet ends in a symlink loop, or treats a file as a directory | Fix the reference or the symlink |
| `<dir>/.<out>.ocx-catalog-<pid> is a directory` | A directory sits where the build writes its marker file beside `--out` | Remove or rename that directory, or pick another `--out` |
| `css "<spec>" (in "<file>") climbs out of the package it names` | A bare package specifier uses `..` to leave its package, such as `@import "pkg/../../x.css"` | Name a file inside the package, or use a relative path inside the config directory |

### CI errors (`src/ci/errors.ts`, raised by `ocx-catalog ci`)

| Code | What triggers it | What to change |
|---|---|---|
| `MISSING_CI_CONFIG` | `catalog.config.json` has no `ci` block | Add a `ci` block naming a `forge` |
| `TOOL_TOO_OLD` | A previously rendered file's header names a version newer than this installed tool supports | Upgrade `@ocx-sh/catalog` |
| `DRIFT` | `ocx-catalog ci --check` found a rendered file that doesn't match a fresh render | Re-run `ocx-catalog ci` (without `--check`) and commit the result |

## Exit codes

Every `ocx-catalog` invocation sets one of five sysexits-derived codes
(`src/cli/exit.ts`). Full flag-by-flag detail: [CLI reference](../../reference/cli/).

| Code | Name | Likely cause |
|---|---|---|
| `0` | OK | Success |
| `1` | FAIL | The Astro render failed (its own diagnostics were already printed to stderr), or an unexpected, uncaught error. Neither is one of the classified failure modes below |
| `64` | USAGE | Bad CLI invocation: an unknown flag, `dev --source` and `--config` given together, or an invalid `--port` value |
| `65` | DATA | A `ConfigError`, a `CiError`, or a `BuildError` with code `DATA` — a config-shape problem or malformed/inconsistent source data (see the error-code tables above) |
| `69` | UNAVAILABLE | A `BuildError` with code `UNAVAILABLE` — an unreachable `url` source, a `git` source whose clone or fetch failed, or `dev`'s port already bound |

## Leftover `.<out>.ocx-catalog-<pid>` or `<out>.staging-<pid>` beside the output

A build killed with `SIGKILL`, by the OOM killer or by power loss leaves its
marker `.<out>.ocx-catalog-<pid>` and its staging or retired directory behind.
The next build on the same machine sweeps them once that pid is gone. A
leftover from another host, container or boot is left alone. The pid in its name
means nothing there. Delete it by hand once no build is running. A
`<out>.retired-<pid>` holds the previous output: move it back to `--out` if
`--out` is missing.

## `dev --smoke` passed but a page does not render

`--smoke` starts the dev server and makes exactly two requests: `GET <base>`
and `GET <base>data/catalog/catalog.json`. Both must answer `200`. A failure
there exits `1` and names the path. A pass proves the site boots and the
catalog data is served. It says nothing about a specific package or docs page.

Load the page yourself to check real rendering. Use interactive `dev`, or
`build` plus any static file server over the output.

## A package shows in the grid but its detail page 404s

Every source's packages have working detail pages, so this is a stale link
rather than a limitation. A package from a non-root index is served at
`/<index>/<namespace>/<package>/`, not at the bare `/<namespace>/<package>/`.
Only the `root: true` source keeps the bare path.

Detail URLs end in `/`. A link without the trailing slash works only if your
host redirects it. Most static hosts do, so check yours if bare links 404. Copy the link from the card
(or right-click → **Copy link**) rather than hand-building one from the
namespace and package alone; see
[Multi-source model](../../explanation/multi-source-model/).

## The deployed site is blank, or every asset 404s

Almost always a prefix mismatch. The site is served under a path prefix, such
as a GitHub Pages project site at `/<repo>/`, but the build used a different
`base`. Every link, asset and data fetch carries the `base` it was built with.

Set `base` to the prefix the host serves, for example `"base": "/<repo>/"`,
and rebuild. Or set `siteUrl` with that path and let `base` follow it. See
[Config schema](../../reference/config-schema/#base) and
[Hosting and headers](../hosting-and-headers/) for which hosts give you a root
by default and which don't.
