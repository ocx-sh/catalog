import type { CatalogIndexInfo } from "./types.js";

/**
 * The route rule, and the ONLY copy of it.
 *
 * A package's detail page lives at the bare `<namespace>/<package…>` path
 * when it comes from the ROOT index, and at `<index>/<namespace>/<package…>`
 * otherwise, so two indexes publishing the same id get two pages instead of
 * one silently winning.
 *
 * ROOT, not DEFAULT — `indexes[].root` is where a source's tree is mirrored,
 * `indexes[].default` is which index the catalog view opens on. They are the
 * same entry in the common config and different entries in a catalog that has
 * no root source at all; a route asks the first question only.
 *
 * ## Why this lives in `viewmodel/` and not on either side that uses it
 *
 * Two processes need this answer. `build/sources_pipeline.ts` needs it to
 * decide where to WRITE each page; the theme needs it to decide where to
 * LINK. They ran as separate implementations of the same sentence, and the
 * branch that introduced qualified routes paid for that twice: the ⌘K
 * palette rebuilt the bare path by hand and 404'd on every non-root index,
 * and `DetailPage.vue` recovered `ns`/`pkg` by splitting the route, which
 * read an index label as a namespace and built 404ing CAS URLs. Neither was
 * caught by review, because a duplicated rule looks correct in each copy.
 *
 * `viewmodel/` is the seam that already carries value imports across that
 * boundary (`useImageIndex.ts` imports `readImageIndexAnnotations` from
 * `viewmodel/catalog.ts` under bundler resolution, `NodeNext` on the build
 * side), so this needs no new mechanism — just one function with two
 * importers.
 *
 * ## `indexes` is the single input, on both sides
 *
 * The build could ask its own `ResolvedSource.root` flag instead, and that
 * is exactly the trap that shipped: route qualification was decided per
 * source while the `indexes` envelope was decided per catalog, the two
 * disagreed for a lone non-root source, and every link 404'd. Deriving both
 * from the same array makes "no entry is `root`" and "every route is
 * qualified" one fact rather than two that have to be kept in agreement.
 */

/**
 * Does `indexName` name the index whose packages keep bare routes — i.e. the
 * one mirrored at the site root?
 *
 * `undefined` indexes means a `catalog.json` this renderer did not write —
 * the Python bot emits no such key — and there is then exactly one index and
 * no qualification, so every package is bare. An envelope with no `root`
 * entry (a config that sets `root: true` on nothing) qualifies everything,
 * which is the case that used to 404. That catalog may still have a
 * `default` index — it opens on one — and this function is deliberately
 * blind to it: a preselected tab must never move a page's URL.
 */
export function isRootIndex(indexName: string, indexes: readonly CatalogIndexInfo[] | undefined): boolean {
  if (indexes === undefined) return true;
  return indexes.find((entry) => entry.root)?.name === indexName;
}

/**
 * Route segments for one package — the build side, which already holds the
 * wire identity and does not need to re-derive it from a name.
 *
 * Depth-N, never a fixed two-segment split ([#716]): the namespace is one
 * segment, the package name is 1..N more.
 */
export function packageRouteSegments(
  indexName: string,
  namespace: string,
  pkg: string,
  indexes: readonly CatalogIndexInfo[] | undefined,
): string[] {
  const bare = [namespace, ...pkg.split("/")];
  return isRootIndex(indexName, indexes) ? bare : [indexName, ...bare];
}

/**
 * The detail-page path for one package — the browser side, which has only
 * the qualified `name`.
 *
 * A package's index IS the first `/`-segment of that name: `sources/labels.ts`
 * derives a source's label from exactly that segment and rejects a config
 * whose label disagrees, so the qualified name already carries everything
 * this needs.
 */
export function packageRoutePath(name: string, indexes: readonly CatalogIndexInfo[] | undefined): string {
  const [indexName, ...bare] = name.split("/");
  return isRootIndex(indexName!, indexes) ? `/${bare.join("/")}` : `/${name}`;
}
