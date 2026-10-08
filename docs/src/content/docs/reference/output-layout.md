---
title: "Output layout"
sidebar:
  order: 4
---
<!-- doc_type: reference -->

`ocx-catalog build` writes a rendered site plus every configured source's
mirrored wire data into one `--out` directory, in a fixed pipeline order.
This page documents that order and the resulting tree. The order comes from
`src/build/engine.ts`, and the mirror from `src/sources/mirror.ts`.

## Build pipeline order

1. **Load config.** `loadConfig(configPath)` parses and validates
   `catalog.config.json` and resolves `base`. Any shape error surfaces here,
   before anything is written to disk.
2. **Guard the output directory.** `--out` is resolved to its real path. It
   must not equal or contain the config directory, a `path` source, `docs`,
   `css`, `publicDir` or `brand.logo`, and must not lie inside `docs` or
   `publicDir`. Otherwise the build stops with `OUT_DIR_OVERLAPS_INPUT`
   (exit `65`) before it reads a source.
3. **Resolve sources.** `resolveCatalog` (`src/build/sources_pipeline.ts`)
   reads every configured source, resolves its label, checks
   [reserved names](../config-schema/#reserved-names), and merges the packages
   into routes and the merged `catalog.json` bytes. This runs before any
   scratch directory exists, so a source failure leaves nothing behind.
4. **Create the scratch root.** A self-sweeping build directory under the
   consumer's own `node_modules/.cache/ocx-catalog/`, or `.ocx-catalog/` if no
   `node_modules` exists yet.
5. **Assemble `public/`.** The scratch root's `public/` receives, in order:
   your `publicDir`, the `brand.logo` file, the `css` file, a default
   `robots.txt` when `siteUrl` is set and you shipped none, and finally every
   source's wire tree, `_headers` and the merged `data/catalog/catalog.json`.
   Astro copies this directory into the output unchanged. The mirror goes in
   last, so a file in your `publicDir` can never shadow it.
6. **Render READMEs and write `site.json`.** Every package README is
   rendered and sanitised here, then written to a file the pages read. Only
   small route keys and views go into `site.json`, never README bodies or wire
   data.
7. **Render the site.** `astro build` runs as a child process into a fresh
   staging directory next to `--out`. It never writes into `--out` itself.
8. **Promote.** The previous `--out` is renamed aside, the staging directory is
   renamed into place, and the old tree is removed. If the second rename
   fails, the old tree is moved back.
9. **Dispose.** The staging directory and scratch root are removed in a
   `finally`, on both success and failure.

A failed build therefore leaves the previous `--out` exactly as it was. A
failure in steps 1 to 8 never leaves a half-written output directory.

## Annotated `dist/` tree

The tree below is for a `root: true` source and no `base`. Under a `base`, the
tree is identical. Your host mounts the whole directory at that prefix.

```
dist/
├── index.html                    # the package grid
├── 404.html                      # the not-found page
├── <namespace>/<package>/index.html     # one detail page per package from the root: true source
├── <label>/<namespace>/<package>/index.html  # same, for a non-root source, qualified with its label
├── docs/<slug>/index.html        # the docs mount, only when docs is set
├── _astro/                       # hashed JS and CSS bundles
├── p/                            # present only when some sources[] entry sets root: true
│   └── <namespace>/<package>.json
│       └── o/sha256/<hex>.<ext>  # CAS blobs: desc.readme (.md), desc.logo (.svg/.png), OCI image indices (.json)
├── config.json                   # the root source's own wire config.json, if it published one
├── c/
│   └── index.json                # the root source's own sparse-index enumeration, if it published one
├── index/
│   └── <label>/                  # one directory per configured source, including the root: true one
│       ├── p/**                  # that source's own wire tree, byte-identical copy
│       ├── config.json           # if that source published one
│       ├── c/
│       │   └── index.json        # if that source published one
│       └── data/
│           └── catalog/
│               └── catalog.json  # this source's own single-source catalog, non-root sources only
├── data/
│   └── catalog/
│       └── catalog.json          # the merged, multi-source catalog
├── sitemap-index.xml             # only when siteUrl is set (plus sitemap-0.xml)
├── robots.txt                    # only when siteUrl is set, or when you ship one
├── favicon.svg                   # under chrome "ocx", or when you ship one
├── <your css file>               # when css is set
├── <your brand.logo file>        # when brand.logo is set
└── _headers                      # Cloudflare Pages / Netlify header rules, see below
```

Every page is a directory with an `index.html`. Page URLs end in `/`, and the
build never emits `foo.html` files except `404.html`. Check that your host
serves `/foo/` from `foo/index.html` and redirects `/foo` to `/foo/`.

Every wire path a source contributes (`config.json`, `c/index.json`, and
everything under `p/`) is copied to `index/<label>/` unconditionally, for
every configured source including the `root: true` one. The `root: true`
source's tree is additionally copied verbatim to the site root
(`dist/p/**`, `dist/config.json`, `dist/c/index.json`). That matches the
`index.ocx.sh` deploy shape. It never replaces the `index/<label>/` copy.

`catalog.json` placement differs between root and non-root sources. The mirror
writes each source's own, single-source catalog to exactly one path:
`data/catalog/catalog.json` for the `root: true` source, or
`index/<label>/data/catalog/catalog.json` for every other source. The root
source therefore has no `index/<label>/data/catalog/catalog.json` of its own.

The merged, multi-source catalog is written last and replaces the root
source's file at `data/catalog/catalog.json`. This is deliberate. The site
fetches one catalog from the site root, so it must see every configured
source's packages, not only the root source's. The bytes of that merged file
are unchanged for the same input across the 0.5 to 0.6 upgrade. The HTML is not.

### `catalog.json` URL fields

The `logoUrl` and `readmeUrl` fields in `data/catalog/catalog.json` are
catalog-root-relative. A value starts with `/p/` (or `/index/<label>/p/` for a
non-root source) and never carries `base`, so the same file is valid under every `base`. Every reader joins `base`
itself before it fetches or links the value. A script that reads these fields
directly must do the same.

## `_headers`

`renderHeaders()` (`src/sources/mirror.ts`) emits one Cloudflare
Pages/Netlify-format block per mirrored prefix, blank-line separated. Every
pattern starts with `base`. This example uses `"base": "/catalog/"`:

```
/catalog/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff

/catalog/index/<label>/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff
```

With the default `base` of `/`, the patterns are `/p/*` and
`/index/<label>/p/*`.

One `/index/<label>/p/*` block is emitted per distinct `source.label`. Every
configured source, root or not, gets one, since every source's mirror copy is
untrusted verbatim wire content. The leading `/p/*` block is emitted only when
some source sets `root: true`. Otherwise `dist/p/**` does not exist and the
rule would be dead weight.

Each page also carries its own Content-Security-Policy `<meta>` tag. That tag
does not replace `_headers`. The headers sandbox the mirrored wire files, which
are not pages.

:::note
`_headers` is honored only by Cloudflare Pages and Netlify. On any other host
it ships as an inert file, and Bunny ignores it too. See
[Hosting and headers](../../ops/hosting-and-headers/).
:::

## Size and skip rules

- **CAS asset size cap** — `MAX_CAS_ASSET_BYTES` in `src/sources/mirror.ts`
  is `1024 * 1024` (1 MiB). It applies only to CAS *content* assets — a
  `desc.readme`/`desc.logo` blob under `p/.../o/sha256/`, never a `.json`
  file under that path. A blob exceeding the cap is skipped (not written)
  and a warning is printed to stderr:
  `ocx-catalog: skipping oversized CAS asset <path> in "<label>": <n> bytes exceeds the 1048576-byte cap`.
  Package roots and OCI image indices are never capped here — skipping one
  of those would dangle a package rather than degrade gracefully the way a
  missing logo/readme does.
- **Wire-asset extension filter** — `WIRE_ASSET_EXTENSIONS` in
  `src/sources/walker.ts` is `{"json", "svg", "png", "md"}`. `path`/`git`
  sources filter their directory walk under `p/` to exactly this set,
  because a `path`/`git` source root is often a full repository checkout,
  not a hand-curated export: an unfiltered copy would otherwise leak an
  arbitrary same-origin file (`.html`, `.js`, ...) into the public
  `dist/index/<label>/p/` mirror. A `url` source needs no such filter — it
  only ever fetches these exact wire paths by digest, never an arbitrary
  directory entry.

## Ownership

| Surface | Owner | Stability |
|---|---|---|
| `data/catalog/catalog.json`, rendered HTML pages | This package | Free to change shape between releases |
| `config.json`, `p/<namespace>/<package>.json`, `p/.../o/sha256/<hex>.json` | The index | Frozen wire contract — this package reads and mirrors it faithfully, never rewrites it |

See [Index vs. catalog](../../explanation/index-vs-catalog/) for the full
distinction between what an index publishes and what this renderer builds
around it.
