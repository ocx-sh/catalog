# Product Context — @ocx-sh/catalog

## Index vs. catalog

An **index** is a sparse, content-addressed HTTP tree of JSON files —
`/config.json`, `/p/<namespace>/<package>.json` package roots, and
content-addressed `/p/<namespace>/<package>/o/sha256/<hex>.json` OCI image
indices. It's the wire format an [OCX](https://github.com/ocx-sh/ocx) client
resolves packages through.

`@ocx-sh/catalog` is a **renderer**, not a producer: point it at one or more
indices (a local directory, an HTTP endpoint, or a git repository) and it
builds a static [VitePress](https://vitepress.dev)-based site around them —
a package grid, per-package detail pages, search, an optional docs mount.
Producing the wire JSON tree is out of scope entirely. This package never
writes to an index and never invents index data; it only reads and displays
what's already there.

## Consumers

The reference consumer is [`ocx-sh/index`](https://github.com/ocx-sh/index),
the public OCX package index served at `index.ocx.sh`: it runs this renderer
against its own `p/**` tree as a `root: true` self-mirror. Corporate mirrors
use the same mechanism — a `path`/`url`/`git` source, optionally aggregated
alongside `index.ocx.sh` itself via a second, non-root, `url` source (see
`catalog.config.json`'s `sources[]`).

## Relationship to the OCX wire contract

| Surface | Owner | Stability |
|---|---|---|
| `/config.json`, `/p/<ns>/<pkg>.json`, `/p/<ns>/<pkg>/o/sha256/<hex>.json` | The index (`ocx-sh/index`) | Frozen one-way door — this package reads it faithfully, never redefines it |
| `/data/catalog/catalog.json`, rendered pages | This package | Free to evolve between versions |

This package reads the wire contract; it does not own it. A change to the
index's URL shapes or field semantics is not this repo's call to make —
`src/sources/types.ts`'s `extractPackages` and `src/viewmodel/catalog.ts`
follow whatever the index's schema documents, and treat a malformed root as
a data error to report, not a shape to silently coerce.

## Deployment precondition: `_headers`

Every mirrored `/p/*` prefix is untrusted, same-origin content (a README,
logo, or package root a configured source handed this renderer, never
authored by it). The one control sandboxing that content —
`Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` on
`/p/*` and `/index/<label>/p/*` — ships as a Cloudflare Pages/Netlify
`_headers` file (`src/sources/mirror.ts`'s `renderHeaders`). It is a **hard
deployment precondition**, not a nice-to-have: on a host that doesn't read
`_headers` (GitHub Pages, a raw S3 bucket, nginx serving the `dist/` tree
directly) the file ships but is inert, and in `ocx-catalog dev` it's never
read at all. Deploying anywhere other than Cloudflare Pages/Netlify means
translating `_headers`' rules into that host's own header mechanism
yourself — this package does not.

## Non-goals

- Not an index — stores no package pointers of its own, only what a
  configured source hands it for one render.
- Not a registry — no package bytes/blobs pass through this package beyond
  what a source's own CAS assets (README, logo) already are.
- Not a client — `ocx-sh/ocx` resolves packages against the index directly;
  this package's fetch layer (`src/sources/`) exists to build a browsable
  site, not to install anything.

## Comparable tools

No exact analog exists — this package's combination of a static-site build
step, multi-source aggregation of externally-owned indices, and an
OCI-artifact index as the wire format sits between the first two below.

- [Terrareg](https://github.com/MatthewJohn/terrareg) — self-hosted
  Terraform module registry UI; closest **UX shape** (README-rich,
  versioned, searchable per-item detail pages).
- [Artifact Hub](https://artifacthub.io) (CNCF) — multi-repo package
  catalog across 27+ artifact types; closest **purpose** (aggregate many
  sources into one catalog), but a live Go+Postgres SaaS, not a static
  generator.
- [StaticReg](https://github.com/seqeralabs/staticreg) — renders a Docker
  Registry v2 catalog into a browse UI; closest **mechanism**, but
  live-polling, single-registry, no README/install detail pages.
- Registry-operator consoles — Verdaccio, Harbor, zot — are the *wrong*
  category: UIs for a registry you run, not consumer-facing catalogs over
  read-only indices.

## Research keywords

For prior art, standards, and ecosystem movement (each verified
productive, 2026-08): OCI referrers API · ORAS (OCI Registry As Storage) ·
OCI image index manifest spec · Cargo sparse index protocol (RFC 2789 —
nearest analog to an OCX index) · npm registry API packument ·
tf-static-registry (static files serving a registry protocol — closest
precedent) · ecosyste.ms registry categorization · SLSA provenance ·
sigstore/cosign attestation verification · CycloneDX vs SPDX SBOM formats
(the supply-chain three matter once the catalog surfaces attestations) ·
VitePress createContentLoader (the page-synthesis API this renderer builds
on).

## Status

Pre-1.0, published. `0.1.0` and `0.1.1` are on the npm registry, `latest`
being `0.1.1`. `0.1.0` was a one-time manual bootstrap publish, since npm
trusted publishing cannot pre-provision a package name that doesn't exist
yet; `0.1.1` went out through the CI release lane on 2026-08-22 with a SLSA
v1 provenance attestation, which is the end-to-end proof that trusted
publishing works for this package. The GitHub remote
[`ocx-sh/catalog`](https://github.com/ocx-sh/catalog) is public — a
precondition for `--provenance` attaching anything at all. Any consumer, not
just `ocx-sh/index`, can `npm install @ocx-sh/catalog` from the registry.
