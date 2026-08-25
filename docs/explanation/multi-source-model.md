# Multi-source model

A `catalog.config.json` can list more than one `sources[]` entry — one
`index.ocx.sh`, one corporate mirror, one local directory for testing —
and the build merges them. What "merges" means is more specific, and more
limited, than it sounds.

## Every source is mirrored, unconditionally

`mirrorSources()` (`src/sources/mirror.ts`) copies **every** configured
source's wire tree, byte-verbatim, to `dist/index/<label>/**` — this
happens for every source in `sources[]`, root or not. `root: true` on one
source is an **additional** copy of that same tree at `dist/` itself
(`src/sources/mirror.ts`'s own doc comment calls this "legacy-compat: today's
`index.ocx.sh` deploy shape, root-relative wire paths"). It is never a
substitute for the `index/<label>/` copy — a source that isn't `root: true`
still lands in full under its own label prefix.

## One merged grid catalog

`resolveCatalog()` (`src/build/sources_pipeline.ts`) builds the single
`/data/catalog/catalog.json` the theme's `useCatalog.ts` fetches, by walking
every source **in `sources[]` config order** and keeping every package each
one publishes.

Nothing is dropped. If two sources both publish `acme/widget`, both copies
appear in the grid, as two cards, linking to two different pages. That is
newer behaviour: the merge used to keep only whichever source came first in
`sources[]` and silently discard the rest, because both copies would
otherwise have claimed one detail-page route. Index-qualified routes (below)
removed that constraint, and a catalog that quietly lost a mirror's package
was never an honest rendering of an aggregation.

The merged list is then sorted by package id, with the index name breaking
ties — so the two `acme/widget` cards sit next to each other rather than
depending on config order.

## Which index a package came from

Every package's `name` is the fully qualified one its own index published —
`ocx.sh/hashicorp/terraform`, `corp.example/platform/deploy-kit` — and its
**first `/`-segment is the index**. `src/sources/labels.ts` derives a
source's label from exactly that segment, and rejects a config whose explicit
`label` disagrees with it (`LABEL_PREFIX_MISMATCH`), so there is exactly one
name for one index and every surface can print it.

That is why cards and table rows carry no badge, dot or colour marking their
origin: the identity line already names the index as part of the package's
own name. Long names elide in the middle
(`ocx.sh/…/terraform-provider-aws`), never at the end, so both the index and
the package survive.

The catalog JSON also carries an `indexes` envelope — each index's name,
whether it is the default (`root: true`), and how many packages it
contributes after the merge:

```json
{
  "generated": "…",
  "indexes": [
    { "name": "ocx.sh", "root": true, "count": 46 },
    { "name": "corp.example", "root": false, "count": 13 }
  ],
  "packages": [ … ]
}
```

It is written for **every** catalog, one source included — the theme needs it
to resolve a package's route, and a single non-root source has qualified
routes just as an aggregating one does. "This deployment aggregates nothing,
so show no scope control" is then one fact about the data (`indexes` has a
single entry), not a second predicate kept in sync with the first.

## Detail-page routes are index-qualified

The `root: true` source's packages keep the bare path they have always had:

| source | qualified name | route |
|---|---|---|
| `root: true` | `ocx.sh/hashicorp/terraform` | `/hashicorp/terraform` |
| any other | `corp.example/platform/deploy-kit` | `/corp.example/platform/deploy-kit` |

For a non-root index the route **is** the qualified identifier, so a copied
package link and a copied identifier are the same string, and two indexes
publishing the same `<namespace>/<package>` are never ambiguous.

One consequence worth knowing at config time: a non-root index may not be
named after a namespace the root source publishes, since both would claim
`/<that name>/**`. The build rejects that pair by name
(`INDEX_NAMESPACE_COLLISION`) rather than letting one silently overwrite the
other.

Each package page carries its own wire identity (`ns`/`pkg`) and its source's
mount prefix (`wireBase` — `""` for the root source, `index/<label>` for any
other) in its frontmatter, which is how a client-side fetch on a non-root
index's detail page reaches the tree `mirrorSources()` actually wrote.
