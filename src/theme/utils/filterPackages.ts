import MiniSearch from 'minisearch'
import type { CatalogPackage } from '../composables/useCatalog'

// Pure filter over catalog packages — shared by the catalog page's inline
// filter (WP-C) and the ⌘K command palette's Packages result group.
// Facets combine with AND; multiple values within one facet (multiple
// platform chips, multiple keyword chips) combine with OR. The free-text
// query is a MiniSearch fuzzy search (already a dependency, docs search):
// every query word must match (intersection), word-prefix matching while
// typing, fuzzy 0.2 absorbs small typos.

export interface PackageFilter {
  /** Fuzzy multi-term match (all terms must hit) against name/title/description/keywords. */
  query?: string
  /** OS strings (`linux`/`darwin`/`windows`) — package matches if it ships ANY of these. */
  platforms?: string[]
  /** Package matches if it carries ANY of these keywords. */
  keywords?: string[]
  /** When true, only `status === 'deprecated'` packages match. */
  deprecatedOnly?: boolean
}

// One index per catalog array, built lazily on first query. WeakMap keyed
// on the array identity: `useCatalog` module-caches the fetched catalog, so
// every consumer shares one index; a fresh fetch result gets a fresh index.
const indexCache = new WeakMap<CatalogPackage[], MiniSearch<CatalogPackage>>()

function searchIndexFor(packages: CatalogPackage[]): MiniSearch<CatalogPackage> {
  let index = indexCache.get(packages)
  if (!index) {
    index = new MiniSearch<CatalogPackage>({
      idField: 'name',
      fields: ['name', 'title', 'description', 'keywords'],
      extractField: (doc, field) =>
        field === 'keywords' ? doc.keywords.join(' ') : String(doc[field as keyof CatalogPackage] ?? ''),
    })
    index.addAll(packages)
    indexCache.set(packages, index)
  }
  return index
}

export function filterPackages(packages: CatalogPackage[], filter: PackageFilter): CatalogPackage[] {
  const query = filter.query?.trim()
  // Match set computed once per call, then applied as a membership test so
  // the result keeps the catalog's stable name order (not relevance order).
  const queryMatches = query
    ? new Set(
        searchIndexFor(packages)
          .search(query, { prefix: true, fuzzy: 0.2, combineWith: 'AND' })
          .map(r => r.id as string),
      )
    : null

  return packages.filter((pkg) => {
    if (queryMatches && !queryMatches.has(pkg.name)) return false

    if (filter.platforms?.length) {
      const pkgOses = new Set(pkg.platforms.map(p => p.split('/')[0]))
      if (!filter.platforms.some(os => pkgOses.has(os))) return false
    }

    if (filter.keywords?.length) {
      if (!filter.keywords.some(kw => pkg.keywords.includes(kw))) return false
    }

    if (filter.deprecatedOnly && pkg.status !== 'deprecated') return false

    return true
  })
}
