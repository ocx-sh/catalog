/**
 * The docs search index's wire shape, kept apart from the MiniSearch ranking
 * (`docsIndex.ts`) so the Node build can write the file without loading the
 * search library the browser ranks it with.
 */

/**
 * Where the docs search index lives, relative to the site `base` (no leading
 * slash, like `CATALOG_PATH`). Written at build time only when a docs mount
 * exists (`viewmodel/docs_index.ts`), fetched on the palette's first open.
 */
export const DOCS_INDEX_PATH = 'data/catalog/docs-index.json'

/** One docs page as the palette searches it: title, headings and a text excerpt. */
export interface DocsIndexEntry {
  /** The page's collection id (`guide/install`); unique. */
  readonly id: string
  /** The page's final link, `base`-joined at build time by the docs model's own helper. */
  readonly href: string
  readonly title: string
  /** The page's section path, shown as breadcrumbs (`['guide']`). */
  readonly crumbs: readonly string[]
  readonly headings: readonly string[]
  readonly text: string
}
