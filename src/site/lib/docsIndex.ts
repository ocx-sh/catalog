import MiniSearch from 'minisearch'
import type { DocsIndexEntry } from './docsIndexWire.js'

const indexCache = new WeakMap<readonly DocsIndexEntry[], MiniSearch<DocsIndexEntry>>()

function searchIndexFor(entries: readonly DocsIndexEntry[]): MiniSearch<DocsIndexEntry> {
  let index = indexCache.get(entries)
  if (!index) {
    index = new MiniSearch<DocsIndexEntry>({
      idField: 'id',
      fields: ['title', 'headings', 'text'],
      extractField: (doc, field) =>
        field === 'headings' ? doc.headings.join(' ') : String(doc[field as keyof DocsIndexEntry]),
    })
    index.addAll(entries as DocsIndexEntry[])
    indexCache.set(entries, index)
  }
  return index
}

/** Docs pages matching every word of `query` (prefix and small typos tolerated), best first. */
export function searchDocs(entries: readonly DocsIndexEntry[], query: string, limit: number): DocsIndexEntry[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return searchIndexFor(entries)
    .search(query, { prefix: true, fuzzy: 0.2, combineWith: 'AND', boost: { title: 3, headings: 2 } })
    .slice(0, limit)
    .map(hit => byId.get(hit.id as string) as DocsIndexEntry)
}
