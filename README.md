# @ocx-sh/catalog

A [VitePress](https://vitepress.dev)-based static site generator that renders
one or more **OCX-style package indices** into a browsable catalog: a grid of
packages, per-package detail pages (README, platforms, versions, install
commands), search, and an optional docs mount — all served as plain static
files.

## Index vs. catalog — what this package is and isn't

An **index** is a sparse, content-addressed HTTP tree of JSON files —
`/config.json`, `/p/<namespace>/<package>.json` package roots, and
content-addressed `/p/<namespace>/<package>/o/sha256/<hex>.json` OCI image
indices. It's the wire format an [OCX](https://github.com/ocx-sh/ocx) client
resolves packages through. Producing and serving that JSON tree is out of
scope for this package entirely.

`@ocx-sh/catalog` is a **renderer**: point it at one or more indices (a local
directory, an HTTP endpoint, or a git repository) and it builds a static site
around them. It never writes to an index and never invents index data — it
only reads and displays what's already there.

The reference consumer is [`ocx-sh/index`](https://github.com/ocx-sh/index),
the public OCX package index served at `index.ocx.sh`: it runs this renderer
against its own `p/**` tree as a `root: true` self-mirror, the same way any
other OCX-style index — public or a corporate mirror — would.

## Status

This package is pre-1.0. The full pipeline is implemented, wired end to end,
and covered by its own tests: the CLI, the config loader, the VitePress
theme, the CI workflow renderer, and the source-resolution layer
(`path`/`url`/`git` readers feeding the mirror/`catalog.json`/`_headers`
emitters). A real `ocx-catalog build`/`dev` renders one page per resolved
package, the merged `/data/catalog/catalog.json`, the `/index/<label>/`
mirror tree, and `_headers` — see the CLI and Multi-source sections below for
the shape of each.

## Install

```sh
npm install --save-dev @ocx-sh/catalog vitepress vue
```

`vitepress` and `vue` are peer dependencies (this package never bundles
them — it plugs a custom theme into your own VitePress install rather than
shipping a fork of it). Match the versions this package's `package.json`
declares under `peerDependencies`.

## Quickstart

A minimal `catalog.config.json` for a repo that colocates its own index (a
`p/**` tree) alongside the config file:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ocx-sh/catalog/src/config/schema/catalog.config.schema.json",
  "sources": [
    { "path": ".", "root": true }
  ],
  "brand": { "title": "My OCX Index" }
}
```

```sh
npx ocx-catalog build --config ./catalog.config.json --out ./dist
```

`root: true` marks this source as the catalog's own self-mirror: its wire
tree is served from the site root (`/config.json`, `/p/**`, …), same as if
you were serving the index directly — the catalog is just decorating it with
a browsable UI.

### Multi-source example

A catalog can aggregate its own index with one or more others — e.g. a
corporate mirror that re-displays the public `index.ocx.sh` catalog alongside
its own packages:

```json
{
  "sources": [
    { "path": ".", "root": true },
    { "url": "https://index.ocx.sh", "label": "upstream" }
  ],
  "brand": { "title": "Acme Package Index" },
  "nav": [{ "text": "Docs", "link": "/docs/" }],
  "docs": "./docs",
  "css": "./theme/custom.css",
  "ci": { "forge": "github" }
}
```

Every non-root source is **always mirrored**: its wire tree is copied
byte-verbatim under `/index/<label>/` in the build output (`<label>` is the
explicit `label` above, or — when omitted — derived from the source's own
root data), alongside that source's own
`/index/<label>/data/catalog/catalog.json`. `root: true` additionally serves
that one source's tree — and its `catalog.json` — at the site root; at most
one source may set it.

The catalog grid and search read the **merged** catalog: every configured
source's packages are combined into one `/data/catalog/catalog.json` (a
qualified package id present in more than one source resolves to the first
configured source's copy — config order is precedence order), so packages
from every source show up together. Entries carry no per-source badge —
`CatalogEntry` has no source/label field, deliberately: adding one would
change `catalog.json`'s bytes and break byte-identity against the index
bot's own golden fixtures.

**Detail pages are not multi-source-aware yet**, though: a package's detail
page fetches its wire data from the unconditional root-relative
`/p/<ns>/<pkg>...` (`usePackageRoot`/`useImageIndex`), never from a non-root
source's actual `/index/<label>/p/...` mount. A multi-source config today
therefore renders correct detail pages only for the `root: true` source —
a non-root source's packages appear in the grid, but clicking into one 404s.

A `url` source is read via conditional GET against `/c/index.json`
(digest-diff, ETag-cached); a `git` source is shallow-cloned at a given
branch/tag/commit (`git: "<url>"`, optional `ref`, optional `dir` for a
subdirectory checkout).

A `url` source must be **`https:`** — plain `http:` is refused at config
load. `/config.json` and `/c/index.json` are the only fetched files that are
never digest-verified (there is nothing to verify them against), so over
plain HTTP a network attacker rewrites the enumeration and every downstream
digest check then verifies against *their* digests and passes. For the same
reason no request is ever redirected: a 3xx on a required wire file fails
the build naming the hop it refused, rather than mirroring a host only the
builder can reach into the published site.

Four more top-level fields, each independent of the others and each
optional: `publicDir` (a directory, relative to the config file, copied
verbatim into the site's public root — e.g. a `favicon.svg` inside it becomes
`/favicon.svg`), `siteUrl` (the deployment's absolute origin, e.g.
`"https://index.ocx.sh"` — feeds the sitemap and each page's `og:url`; omit
it and the build just skips both), `description` (a site-wide tagline,
VitePress's own meta-description field — distinct from `brand.title`), and
`favicon` (a site-root-relative href such as `"/favicon.svg"`, emitted as
`<link rel="icon">` on every page with the `type` its extension implies —
`.svg`/`.png`/`.ico`, anything else emits no `type`; the asset itself is
yours to ship, normally through `publicDir`, and omitting the key emits no
icon link at all — this package bundles no default).

```json
{
  "favicon": "/favicon.svg"
}
```

A package whose root carries no `desc` falls back to a fixed
meta/`og:description` — `"Install {name} from <brand.title>."`, `{name}`
being the package's bare `<ns>/<pkg>` identifier — automatically, with
nothing to configure.

## CLI

```
ocx-catalog build [--config <path>] [--out <dir>]
ocx-catalog dev [--source <path>] [--config <path>] [--port <n>] [--smoke]
ocx-catalog ci [--check]
ocx-catalog --version
ocx-catalog --help
```

- **`build`** — renders every configured source to a static site.
  `--config` points at `catalog.config.json` (default: look for one in the
  current directory); `--out` sets the output directory.
- **`dev`** — runs a local dev server with the catalog's hot-reloading
  preview. `--source` lets you point a single ad-hoc source at the dev server
  without writing a full config (mutually exclusive with `--config`).
  `--smoke` boots the server and closes it again the moment it's listening,
  instead of staying up for Ctrl-C — it proves the server starts cleanly
  (same exit codes as any other invocation: `0` once bound, or `65`/`69` on a
  config/data or availability failure), not that any particular page
  renders.
- **`ci`** — the CI entrypoint: renders the forge-specific workflow files
  this package's own CI-render templates produce (see below). `--check`
  makes it check-only: re-render and diff against what's committed, without
  writing anything.

Exit codes (BSD `sysexits.h`-derived; the bin shim always sets
`process.exitCode`, never `process.exit()`):

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | generic failure |
| `64` | usage error (bad flags) |
| `65` | data problem — malformed source data, or (`ci --check`) rendered-output drift |
| `69` | required resource unavailable (e.g. a `dev` port already bound, an unreachable `url` source) |

## CI rendering and drift checking

`ocx-catalog ci` renders a job set (per `ci.forge`, `github` or `gitlab`)
from this package's own templates into your repo's CI config, carrying
forward any action/image pins already committed in those files —
`.github/workflows/catalog-ci.yml` for `github`, or `.gitlab-ci/catalog.yml`
for `gitlab` (a job file your own root `.gitlab-ci.yml` includes; this
renderer never writes the root file itself). `ocx-catalog ci --check`
re-renders in memory and compares (line-ending and pin-comment normalized)
against what's on disk — any difference is a hard failure (exit `65`, listing
every drifted file), so a hand-edited or out-of-date rendered workflow fails
CI instead of silently going stale.

Every file this renderer owns carries a **generated header** as its literal
first line:

```
# generated by ocx-catalog ci v1 — do not edit
```

That header is itself a versioned contract: a file whose first line doesn't
match this pattern is not this tool's output and is never touched, scraped
for pins, or drift-checked. A file whose header names a version newer than
the running tool's own is a hard "tool too old" error rather than silent
misinterpretation.

Set `"ci": { "verifyCi": false }` in `catalog.config.json` to skip rendering
the verification job entirely (e.g. if your CI already runs an equivalent
check some other way).

Set `"ci": { "packageManager": "bun" }` when your repo installs with bun
instead of npm — the rendered install/exec steps switch to
`bun install --frozen-lockfile`/`bun x` (and, on GitHub, `oven-sh/setup-bun`
in place of `actions/setup-node`; on GitLab, the `oven/bun:1` image). Omit
it, or set `"npm"` explicitly, for the npm steps shown above. Only `"npm"`
(default) and `"bun"` are supported — any other value is a config-load
error, not a silently broken rendered workflow.

## Docs mount

Set `"docs": "./docs"` (a directory relative to the config file) to mount a
nested Markdown tree through the theme at `/docs/**`, with a "Docs" entry
added to the nav automatically. Omit `docs` for a catalog with no separate
documentation section — no docs affordance is shown.

## Theming

The `./theme` export (`@ocx-sh/catalog/theme`) is package-internal — you never
import it yourself. `build`/`dev` generate a two-line shim
(`.vitepress/theme/index.ts` in the scratch root they build from) that
imports it and re-exports it as the site's VitePress theme, plus your own
`css` when configured, imported after the theme's own so your rules win the
cascade. Customize the result through `catalog.config.json`'s
`css`/`brand` fields below, not by touching the theme package
directly.

The shipped theme exposes its full palette, spacing, radius, and type scale
as CSS custom properties (`src/theme/styles/tokens/*.css`), so most visual
changes need no component overrides — a stylesheet that only reassigns these
variables is enough:

```css
:root {
  --c-accent: #2563eb;
  --radius-md: 10px;
  --font-sans: "Inter", sans-serif;
}
```

Representative variables: `--c-accent`, `--c-bg`, `--c-surface`,
`--c-text-1`/`-2`/`-3`, `--c-ok`, `--c-warn`, `--c-kw`, `--radius-sm`/`-md`/
`-lg`/`-full`, `--space-1`…`--space-8`, `--font-sans`, `--font-mono`,
`--text-xs`…`--text-2xl`. Dark mode is the `.dark` class VitePress's own
pre-hydration script toggles on `<html>` — redefine a variable under
`.dark { … }` to theme it separately per mode.

For anything beyond variables, point `"css": "./path/to/custom.css"` (relative
to the config file) at a stylesheet with arbitrary rule overrides — the build
guarantees your custom rules win in the final CSS cascade order over the
shipped theme's own styles, regardless of import order across the package
boundary.

### Brand

`brand.title` is the site's name — it becomes `<title>` and `og:site_name`.

`brand.wordmark` (optional) is the text beside the logo in the site header.
Omit it and the header shows `brand.title`; set it when the two differ,
which is common — the page title reads as prose while the header wordmark is
usually the host the site is served from:

```json
{ "brand": { "title": "OCX Index", "wordmark": "index.ocx.sh", "logo": "./assets/logo.svg" } }
```

`brand.logo` (optional, relative to the config file — a local file path only,
never a remote URL) replaces the theme's built-in mark in the header. The
build copies the file into the site's public root under its own file name, so
`./assets/logo.svg` is served at `/logo.svg`; a `publicDir` file of the same
name is overwritten by it. Omit `brand.logo` to keep the built-in mark.

### Install commands

Every install-command surface the theme renders — the detail page's install
grid, the catalog card's one-line install box (its **first** entry), and the
command items in every right-click copy menu — shows the same fixed
four-flavor set: `ocx add {name}`, `ocx --global add {name}`,
`ocx package exec {name}`, `ocx package install {name}`. Not configurable:
every catalog built with this package renders an OCX package index, so the
CLI is `ocx` for all of them.

## Not wire contract

`/data/catalog/catalog.json` (the view-model this tool emits to drive the
catalog grid client-side) and every rendered catalog/docs HTML page are
**not** part of the underlying index's wire contract. They're this package's
own presentation output, free to change shape between versions. The wire
contract — `/config.json`, `/p/<namespace>/<package>.json`,
`/p/<namespace>/<package>/o/sha256/<hex>.json` — belongs to the index this
tool reads, not to this tool itself.

## Config schema

The full shape of `catalog.config.json` is published as JSON Schema at
[`src/config/schema/catalog.config.schema.json`](./src/config/schema/catalog.config.schema.json)
(included in the published package; point your editor's `$schema` at it, as
in the examples above, for inline validation).

## License

[Apache-2.0](./LICENSE)
