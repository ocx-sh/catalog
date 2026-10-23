/**
 * The support matrix's wire shape (`data/catalog/support/<route key>.json`), kept apart from the Node
 * writer (`viewmodel/support_matrix.ts`) so the browser island reads it without the view-model. This
 * file is the catalog's own: it carries the package's tags, never index data it did not read.
 */
import type { Yank } from '../../viewmodel/types.js'

/** Directory of the per-package files, relative to the site `base` (no leading slash, like `CATALOG_PATH`). */
export const SUPPORT_DIR = 'data/catalog/support'

/** One tag of the dialog: the `os/arch` labels its image index ships, newest tags first in the file. */
export interface SupportRow {
  readonly tag: string
  readonly platforms: readonly string[]
  /** A snapshot tag that may be pruned. */
  readonly ephemeral: boolean
  /** The withdrawal record of a yanked tag. */
  readonly yanked: Yank | null
}

export interface SupportData {
  readonly rows: readonly SupportRow[]
  /** Set when the whole package is deprecated, with its message. */
  readonly deprecated: { readonly message: string | null } | null
}

/** Where a package's rows live, relative to `base`; `key` is the route key. */
export const supportPath = (key: string): string => `${SUPPORT_DIR}/${key}.json`

/** The untrusted-wire check: the one field the island iterates, and the shape of each row. */
const isText = (value: unknown): value is string => typeof value === 'string'
const isYank = (value: unknown): boolean =>
  value === null || (typeof value === 'object' && isText((value as Yank).reason) && isText((value as Yank).at))
const isDeprecation = (value: unknown): boolean =>
  value === null ||
  (typeof value === 'object' && ((value as { message: unknown }).message === null || isText((value as { message: unknown }).message)))

export function isSupportData(data: unknown): data is SupportData {
  const rows = (data as { rows?: unknown } | null)?.rows
  return (
    isDeprecation((data as { deprecated?: unknown } | null)?.deprecated) &&
    Array.isArray(rows) &&
    rows.every(
      (row: unknown) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as SupportRow).tag === 'string' &&
        Array.isArray((row as SupportRow).platforms) &&
        typeof (row as SupportRow).ephemeral === 'boolean' &&
        isYank((row as SupportRow).yanked),
    )
  )
}
