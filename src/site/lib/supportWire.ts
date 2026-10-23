/**
 * The support matrix's wire shape (`data/catalog/support/<route key>.json`), kept apart from the Node
 * writer (`viewmodel/support_matrix.ts`) so the browser island reads it without the view-model. This
 * file is the catalog's own: it carries the package's tags, never index data it did not read.
 */

/** Directory of the per-package files, relative to the site `base` (no leading slash, like `CATALOG_PATH`). */
export const SUPPORT_DIR = 'data/catalog/support'

/** One tag of the dialog: the `os/arch` labels its image index ships, newest tags first in the file. */
export interface SupportRow {
  readonly tag: string
  readonly platforms: readonly string[]
  /** A snapshot tag that may be pruned. */
  readonly ephemeral: boolean
}

export interface SupportData {
  readonly rows: readonly SupportRow[]
}

/** Where a package's rows live, relative to `base`; `key` is the route key. */
export const supportPath = (key: string): string => `${SUPPORT_DIR}/${key}.json`

/** The untrusted-wire check: the one field the island iterates, and the shape of each row. */
export function isSupportData(data: unknown): data is SupportData {
  const rows = (data as { rows?: unknown } | null)?.rows
  return (
    Array.isArray(rows) &&
    rows.every(
      (row: unknown) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as SupportRow).tag === 'string' &&
        Array.isArray((row as SupportRow).platforms) &&
        typeof (row as SupportRow).ephemeral === 'boolean',
    )
  )
}
