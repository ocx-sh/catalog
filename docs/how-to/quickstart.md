# Quickstart

Get a running catalog site from an existing OCX index in four commands: install, configure, build, serve the output.

## Prerequisites

- Node.js `>=20.19` (`package.json`'s `engines.node`).
- An existing OCX index to point at — a local directory, an HTTPS endpoint, or a git repository.

`vitepress` and `vue` are **peer dependencies**, never bundled with the package (`package.json`'s `peerDependencies`: `vitepress ^2.0.0-alpha.18`, `vue ^3.5.27`) — install them alongside `@ocx-sh/catalog`, not instead of it:

=== "npm"

    ```sh
    npm install --save-dev @ocx-sh/catalog vitepress vue
    ```

=== "bun"

    ```sh
    bun add --dev @ocx-sh/catalog vitepress vue
    ```

## Write a config

`@ocx-sh/catalog` reads a `catalog.config.json`. Two keys are required — `sources` (at least one entry) and `brand` (at least `title`):

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ocx-sh/catalog/src/config/schema/catalog.config.schema.json",
  "sources": [
    { "path": "./index", "root": true }
  ],
  "brand": { "title": "My Catalog" }
}
```

- `sources[0].path` points at a local directory holding your index's wire tree (`config.json`, `c/index.json`, `p/**`), relative to this config file.
- `root: true` marks this source as the catalog's primary index — see [Configure sources](./configure-sources.md) for what that flag does across more than one source.

!!! note
    The `$schema` line is editor/tooling metadata only — autocomplete and validation in your editor. It is never read at build or run time; the loader (`src/config/load.ts`) is hand-rolled and does not consume the schema file at all.

## Build

```sh
npx ocx-catalog build --config ./catalog.config.json --out ./dist
```

Both flags have defaults, so a bare `npx ocx-catalog build` works too: `--config` defaults to `./catalog.config.json` in the current directory, and `--out` defaults to `./dist`.

## What `root: true` does

Every configured source's wire tree is always mirrored, byte-verbatim, under `dist/index/<label>/`. Setting `root: true` on one source additionally copies that *same* tree to `dist/` itself — the site-root placement `index.ocx.sh`'s own self-mirror deployment expects. At most one source may set `root: true`; a second one fails the build.

## What you get in `dist/`

- The rendered VitePress site: a package grid, per-package detail pages, and (if configured) a docs mount.
- `dist/data/catalog/catalog.json` — the merged view-model the grid and search read.
- `dist/_headers` — the Cloudflare Pages/Netlify header rules that sandbox mirrored, untrusted wire content.

Full file-by-file layout: [Output layout](../reference/output-layout.md).

## Next steps

- [Configure sources](./configure-sources.md) — point at more than one index, or a `url`/`git` source instead of `path`.
- [Preview locally](./preview-locally-with-dev.md) — iterate without a full build.
- Before picking a host, read [Known limitations](../ops/known-limitations.md) — `_headers` is a hard deployment precondition, not every static host honors it.
