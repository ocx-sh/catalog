import { applyCutoff, scorePackages } from './packageSearch.js'
import type { CatalogPackage } from './wireTypes.js'

// Pure filter over catalog packages — shared by the catalog page's inline
// filter (WP-C) and the ⌘K command palette's Packages result group.
// EVERY selection narrows: facets combine with AND, and so do multiple
// values WITHIN a facet — two platform chips mean "ships both", two keyword
// chips mean "carries both" (owner decision, issue #5). These chips used to
// be OR-within-facet, which made a second click widen the result set; a
// filter rail that grows the answer as you add constraints reads as broken.
// The free-text query is `packageSearch`'s weighted relevance model: every
// query word must match, and after every facet the weak tail (under half the
// best score on screen) is cut. Order stays the caller's; rank with `byRelevance`.

export interface PackageFilter {
  /** Weighted multi-term match (all terms must hit), weak tail cut; see `packageSearch.ts`. */
  query?: string
  /** OS strings (`linux`/`darwin`/`windows`) — package matches only if it ships ALL of these. */
  platforms?: string[]
  /** Package matches only if it carries ALL of these keywords. */
  keywords?: string[]
  /** When true, only `status === 'deprecated'` packages match. */
  deprecatedOnly?: boolean
  /** When true, only `status === 'yanked'` (whole-package yank) packages
   * match — parallel to `deprecatedOnly`, a distinct status value (C-603). */
  yankedOnly?: boolean
  /** Only packages published by this index match. The index is the first
   * `/`-segment of a package's qualified `name` (`sources/labels.ts` derives
   * a source's label from exactly it), so this needs no per-package field of
   * its own. `undefined` is "all indexes" — scope is a place you are in, not
   * a chip, so there is no empty-array form meaning the same thing. */
  index?: string
  /** Packages published by any of these indexes never match. The "all" tab's
   * exclusion (`indexes[].excludeFromAll`) — an option here rather than a
   * pre-filtered array so the per-array search entries are still shared
   * across tab switches. Combines with `index` by AND, so it is
   * moot for a scope that names one index. */
  excludeIndexes?: readonly string[]
}

export function filterPackages(packages: CatalogPackage[], filter: PackageFilter): CatalogPackage[] {
  const query = filter.query?.trim()
  const queryMatches = query ? scorePackages(packages, query) : null

  const matched = packages.filter((pkg) => {
    if (queryMatches && !queryMatches.has(pkg.name)) return false

    if (filter.platforms?.length) {
      const pkgOses = new Set(pkg.platforms.map(p => p.split('/')[0]))
      if (!filter.platforms.every(os => pkgOses.has(os))) return false
    }

    if (filter.keywords?.length) {
      if (!filter.keywords.every(kw => pkg.keywords.includes(kw))) return false
    }

    if (filter.index !== undefined || filter.excludeIndexes?.length) {
      const pkgIndex = pkg.name.split('/')[0]
      if (filter.index !== undefined && pkgIndex !== filter.index) return false
      if (filter.excludeIndexes?.includes(pkgIndex)) return false
    }

    if (filter.deprecatedOnly && pkg.status !== 'deprecated') return false
    if (filter.yankedOnly && pkg.status !== 'yanked') return false

    return true
  })
  // After every facet, so the cutoff is relative to the best match the reader can see.
  return queryMatches ? applyCutoff(matched, queryMatches) : matched
}
