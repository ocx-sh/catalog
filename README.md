# @ocx-sh/catalog

A [VitePress](https://vitepress.dev)-based static site generator that renders
one or more **OCX-style package indices** into a browsable catalog: a grid of
packages, per-package detail pages (README, platforms, versions, install
commands), search, and an optional docs mount — all served as plain static
files.

**Documentation:** `https://ocx-sh.github.io/catalog/` — source in
[`docs/`](./docs/index.md).

## Index vs. catalog

An **index** is a sparse, content-addressed HTTP tree of JSON files —
`/config.json`, `/p/<namespace>/<package>.json` package roots, and
content-addressed `/p/<namespace>/<package>/o/sha256/<hex>.json` OCI image
indices. It is the wire format an [OCX](https://github.com/ocx-sh/ocx) client
resolves packages through. Producing and serving that tree is out of scope for
this package entirely.

`@ocx-sh/catalog` is a **renderer**: point it at one or more indices (a local
directory, an HTTPS endpoint, or a git repository) and it builds a static site
around them. It never writes to an index and never invents index data — it only
reads and displays what is already there. Full framing:
[Index vs. catalog](./docs/explanation/index-vs-catalog.md).

The reference consumer is [`ocx-sh/index`](https://github.com/ocx-sh/index),
the public OCX package index served at `index.ocx.sh`, which runs this renderer
against its own `p/**` tree as a `root: true` self-mirror.

## Status

Pre-1.0, published. The full pipeline is implemented and covered by its own
tests: the CLI, the config loader, the VitePress theme, the CI workflow
renderer, and the source-resolution layer (`path`/`url`/`git` readers feeding
the mirror, `catalog.json` and `_headers` emitters).

## Install

```sh
npm install --save-dev @ocx-sh/catalog vitepress vue
```

Requires Node.js `>=20.19`. `vitepress` and `vue` are peer dependencies — this
package plugs a custom theme into your own VitePress install rather than
shipping a fork of it.

## Quickstart

A minimal `catalog.config.json` for a repository that colocates its own index (a
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

`root: true` marks this source as the catalog's own self-mirror: its wire tree
is served from the site root, and the catalog decorates it with a browsable UI.

Longer walkthrough, including multi-source aggregation and local preview:
[Quickstart](./docs/how-to/quickstart.md).

## Before you deploy

Two constraints decide which hosts work:

- A generated catalog site must be served from a **domain root** — it emits no
  base path, so a project-Pages subpath such as `org.github.io/repo/` breaks
  every asset and wire fetch.
- The `_headers` file it emits (`Content-Security-Policy: sandbox` and
  `X-Content-Type-Options: nosniff` over the mirrored, untrusted `/p/*` tree) is
  read by Cloudflare Pages and Netlify only. Everywhere else it ships inert and
  the rules are yours to translate.

Details and the per-host decision table:
[Known limitations](./docs/ops/known-limitations.md),
[Hosting and headers](./docs/ops/hosting-and-headers.md).

## Documentation map

| Section | Contents |
|---|---|
| [How-To](./docs/how-to/index.md) | Quickstart, sources, GitHub/GitLab deploys, local preview, branding |
| [Reference](./docs/reference/index.md) | CLI, config schema, CI rendering, output layout |
| [Explanation](./docs/explanation/index.md) | Index vs. catalog, multi-source model, security model |
| [Ops](./docs/ops/index.md) | Known limitations, hosting and headers, troubleshooting |

## License

[Apache-2.0](./LICENSE)
