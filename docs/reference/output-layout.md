# Output layout

`ocx-catalog build` writes a rendered site plus every configured source's
mirrored wire data into one `--out` directory, in a fixed pipeline order.
This page documents that order and the resulting tree shape from
`src/build/engine.ts`, `src/sources/mirror.ts`, and `src/viewmodel/`.

## Build pipeline order

1. **Load config** — `loadConfig(configPath)` parses and validates
   `catalog.config.json`. Any shape error surfaces here, before anything is
   written to disk.
2. **Resolve sources** — `resolveCatalog(loaded.sources, loaded.configDir)`
   (`src/build/sources_pipeline.ts`) reads every configured source, resolves
   its label, and merges their packages into routes, a per-package
   description lookup, and the merged `catalog.json` bytes. Runs *before*
   the scratch root exists, so a source failure leaves nothing behind and
   nothing partial ever reaches `--out`.
3. **Create the scratch root** — a self-sweeping build directory under the
   consumer's own `node_modules/.cache/ocx-catalog/` (or `.ocx-catalog/` if
   no `node_modules` exists yet).
4. **Synthesize pages** — one page per resolved package, plus the always-on
   `index.md`/`404.md`, the docs mount (when `docs` is set), and the
   public-assets mount (when `publicDir` is set).
5. **Generate config** — writes the scratch root's `.vitepress/config` and
   theme shim: `brand`/`nav` verbatim, `brand.logo`/`css` resolved against
   the config directory, `siteUrl`/`description`/`favicon` verbatim, and the
   description lookup baked in as static JSON.
6. **VitePress build** — `assertOutDirSafe(scratchRoot, outDir)` runs first
   (refusing an `--out` equal to, an ancestor of, or a descendant of the
   scratch root), then `vitepress build(scratchRoot, { outDir })` renders
   the static site into the caller's own output directory.
7. **Emit the catalog tree** — `emitCatalogTree()` writes every source's
   wire tree, `_headers`, and the merged `data/catalog/catalog.json` into
   `--out`.
8. **Dispose** — the scratch root is cleaned up in a `finally`, on both
   success and failure.

Step 7 runs **after** the VitePress build, deliberately never before or
interleaved with it: `--out` is VitePress's own output directory, so
anything written there earlier is at the mercy of the build's own
`emptyOutDir`/`publicDir` handling. Writing the mirror, `_headers`, and
catalog data only after the build guarantees they are the final,
uncontested content at those paths — including a deliberate last-write-wins
overwrite of `data/catalog/catalog.json`, described below.

## Annotated `dist/` tree

```
dist/
├── index.html                    # VitePress-rendered pages: package grid, per-package detail pages, ...
├── <namespace>/<package>/…       # one route per resolved package from the root: true source, depth-N to match its namespace + package segments
├── <label>/<namespace>/<package>/…  # same, for a non-root source — its route is qualified with its own label
├── assets/                       # VitePress's own built JS/CSS bundle
├── p/                            # present only when some sources[] entry sets root: true — that source's own wire tree
│   └── <namespace>/<package>.json
│       └── o/sha256/<hex>.<ext>  # CAS blobs: desc.readme (.md), desc.logo (.svg/.png), OCI image indices (.json)
├── config.json                   # the root source's own wire config.json, if it published one
├── c/
│   └── index.json                # the root source's own sparse-index enumeration, if it published one
├── index/
│   └── <label>/                  # one such directory per configured source, INCLUDING the root: true one
│       ├── p/**                  # that source's own wire tree, byte-identical copy
│       ├── config.json           # if that source published one
│       ├── c/
│       │   └── index.json        # if that source published one
│       └── data/
│           └── catalog/
│               └── catalog.json  # this source's OWN single-source catalog — non-root sources only, see below
├── data/
│   └── catalog/
│       └── catalog.json          # the MERGED, multi-source catalog — the last write to this path, see below
└── _headers                      # Cloudflare Pages / Netlify header rules, see below
```

Every wire path a source contributes (`config.json`, `c/index.json`, and
everything under `p/`) is copied to `index/<label>/` unconditionally, for
*every* configured source including the `root: true` one. The `root: true`
source's tree is **additionally** copied verbatim to the site root
(`dist/p/**`, `dist/config.json`, `dist/c/index.json`) — legacy-compat with
today's `index.ocx.sh` deploy shape, never a substitute for its
`index/<label>/` copy.

`catalog.json` placement is asymmetric between root and non-root sources,
and it's easy to over-generalize: `mirrorSources()` writes each source's
*own*, single-source catalog to exactly one path — `data/catalog/catalog.json`
for the `root: true` source, or `index/<label>/data/catalog/catalog.json`
for every other source, never both. The root source therefore has **no**
`index/<label>/data/catalog/catalog.json` of its own; only non-root sources
get that path. The root source's single-source catalog briefly lands at
`data/catalog/catalog.json`, but `emitCatalogTree()` calls `mirrorSources()`
first and then overwrites that same path with the **merged**, multi-source
catalog — a deliberate last-write-wins, not an accident of ordering, so the
theme's single site-root fetch always sees every configured source's
packages, not just the root source's own.

## `_headers`

`renderHeaders()` (`src/sources/mirror.ts`) emits one Cloudflare
Pages/Netlify-format block per mirrored prefix, blank-line separated:

```
/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff

/index/<label>/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff
```

One `/index/<label>/p/*` block is emitted per **distinct** `source.label` —
every configured source, root or not, since every source's mirror copy is
untrusted verbatim wire content. The leading `/p/*` block is emitted **only**
when some source sets `root: true`; otherwise `dist/p/**` doesn't exist and
the rule would be dead weight.

!!! note
    `_headers` is honored only by Cloudflare Pages and Netlify. On any
    other host it ships as an inert file. See
    [Hosting and headers](../ops/hosting-and-headers.md).

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

See [Index vs. catalog](../explanation/index-vs-catalog.md) for the full
distinction between what an index publishes and what this renderer builds
around it.
