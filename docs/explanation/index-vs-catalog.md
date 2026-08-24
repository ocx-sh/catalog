# Index vs. catalog

An **index** and this **catalog** renderer are two different things owned by
two different projects, and almost every question about what this package
can and cannot do comes back to that line.

## What an index is

An index is a sparse, content-addressed HTTP tree of JSON files — nothing
more. The reference implementation is [`ocx-sh/index`](https://github.com/ocx-sh/index),
served at `index.ocx.sh`. Three URL shapes make up the wire contract this
package reads:

| Shape | What it is |
|---|---|
| `/config.json` | Top-level index configuration |
| `/p/<namespace>/<package>.json` | A package root: status, tags, description, ownership |
| `/p/<namespace>/<package>/o/sha256/<hex>.json` | A content-addressed OCI image index for one tag |

A `url` source additionally reads one more file, `/c/index.json`, a sparse
enumeration manifest that lets the fetch layer discover which package roots
and CAS blobs exist without walking the whole tree — see
[Security and trust model](security-and-trust-model.md) for what is and is
not digest-verified about it. It sits alongside the three shapes above, not
in place of them.

A real registry's OCI image bytes never pass through this format directly;
the index's own JSON *points at* them. That indirection is the whole reason
an index can be sparse and static-hostable at all.

## What this package is

`@ocx-sh/catalog` is a renderer, not a producer. Point it at one or more
indices — a local directory, an HTTPS endpoint, or a git repository — and it
builds a static [VitePress](https://vitepress.dev)-based site around them: a
package grid, per-package detail pages, search, an optional docs mount. It
never writes to an index and never invents index data; every fact on a
rendered page traces back to a file a configured source handed it.

## Ownership

| Surface | Owner | Stability |
|---|---|---|
| `/config.json`, `/p/<ns>/<pkg>.json`, `/p/<ns>/<pkg>/o/sha256/<hex>.json` | The index (`ocx-sh/index`) | Frozen one-way door — this package reads it faithfully, never redefines it |
| `/data/catalog/catalog.json`, rendered pages | This package | Free to evolve between versions |

A change to the index's URL shapes or field semantics is not this repo's
call to make. `src/sources/types.ts`'s `extractPackages` and
`src/viewmodel/catalog.ts` follow whatever the index's schema documents, and
treat a malformed root as a data error to report — never a shape to
silently coerce into something that happens to render.

## The reference consumer, and mirrors

`ocx-sh/index` runs this renderer against its own `p/**` tree as a
`root: true` self-mirror — the catalog and the index it displays are the
same repository. A corporate mirror uses the identical mechanism: a
`path`/`url`/`git` source pointed at whatever tree that mirror serves,
optionally aggregated alongside `index.ocx.sh` itself via a second,
non-root, `url` source. See [Multi-source model](multi-source-model.md) for
what "aggregated" actually does, and where it stops working.

## Non-goals

- **Not an index** — this package stores no package pointers of its own,
  only what a configured source hands it for one render.
- **Not a registry** — no package bytes/blobs pass through it beyond what a
  source's own CAS assets (README, logo) already are.
- **Not a client** — `ocx-sh/ocx` resolves packages against the index
  directly; this package's source-reading layer exists to build a browsable
  site, not to install anything.
