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
every source **in `sources[]` config order** and keeping the first
occurrence of each package id:

```ts
for (const result of results) {
  for (const pkg of result.packages) {
    const id = `${pkg.packageId.namespace}/${pkg.packageId.package}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ pkg, wireBase: result.wireBase });
  }
}
```

So config order **is** precedence: if two sources both publish
`acme/widget`, the entry from whichever source appears earlier in
`sources[]` wins, and the later one's copy of that package is silently
dropped from the grid (its wire files are still mirrored under its own
`index/<label>/`, just not surfaced in the merged catalog).

## Why catalog entries carry no per-source badge

Not a design choice made in the UI layer — it is structural. The type the
merge step produces, `CatalogSourcePackage` (`src/sources/types.ts`), carries
exactly three fields: `packageId`, `root`, `contentByDigest`. There is no
source or label field on it at all. `catalogEntry()`/`catalogIndex()`
(`src/viewmodel/catalog.ts`) consume that type directly, so by the time a
package reaches `/data/catalog/catalog.json` there is nothing left to badge
it with — source identity is discarded at the merge step, before
serialization ever runs. The only place source identity survives past the
merge is `wireBase` on each `PackageRoute`, used for page synthesis, not for
the catalog JSON.

## The gap: detail pages are not multi-source aware

`PackageRoute.wireBase` (`src/build/pages.ts`) is the per-source fetch
prefix a package's detail page would need — `""` for the `root: true`
source, `"index/<label>"` for any other. It is computed and threaded through
page synthesis, but **nothing downstream reads it**. `pages.ts`'s own doc
comment is explicit about this:

> `wireBase` is captured here so the synthesis contract does not need to
> change again once it's consumed, but nothing downstream reads it yet:
> `usePackageRoot.ts`/`useImageIndex.ts` fetch an unconditional root-relative
> `/p/<ns>/<pkg>...` today... Until then this engine only renders correctly
> for a single-source (or root-only) config.

Concretely, `usePackageRoot()` fetches `` `/p/${ns}/${pkg}.json` `` and
`useImageIndex()` fetches `` `/p/${ns}/${pkg}/o/sha256/${hex}.json` `` — both
literal, root-relative, ignoring which source the package actually came
from. Those paths only resolve when the package's source has `root: true`
(mirrored at `dist/` itself); a non-root source's package root only exists
under `dist/index/<label>/p/**`.

The practical consequence: a package from a non-root source appears
correctly in the grid — the merged catalog JSON doesn't need `wireBase` —
but clicking through to its detail page fetches the wrong prefix and 404s.
This is a known limitation, not an edge case to work around in config; see
[Known limitations](../ops/known-limitations.md) for how it's tracked.
