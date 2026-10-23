/**
 * The reader's table/cards view and sort key, remembered across visits in
 * `localStorage` under the keys the 0.5.x UI used, so a stored choice survives
 * the upgrade (D-170). The URL wins over storage: a link states what it shows.
 * Storage is a convenience, never a requirement: every access can throw
 * (disabled, blocked, quota) and then the preference is simply not kept.
 */
import { SORT_KEYS, VIEW_MODES, type SortKey, type ViewMode } from './catalogState.js'

export const VIEW_STORAGE_KEY = 'ocx-catalog-view'
export const SORT_STORAGE_KEY = 'ocx-catalog-sort'

export interface ViewPrefs {
  readonly view: ViewMode | null
  readonly sort: SortKey | null
}

function readItem(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key)
  } catch {
    // Blocked or absent storage reads as "nothing stored".
    return null
  }
}

/** The stored choices; an unknown or missing value reads as `null`, never as a made-up mode. */
export function readViewPrefs(): ViewPrefs {
  const view = readItem(VIEW_STORAGE_KEY)
  const sort = readItem(SORT_STORAGE_KEY)
  return {
    view: VIEW_MODES.find((mode) => mode === view) ?? null,
    sort: SORT_KEYS.find((key) => key === sort) ?? null,
  }
}

/** Remembers the given choices. A failed write (quota, blocked storage) loses only the memory. */
export function writeViewPrefs(prefs: { view?: ViewMode; sort?: SortKey }): void {
  try {
    if (prefs.view) globalThis.localStorage.setItem(VIEW_STORAGE_KEY, prefs.view)
    if (prefs.sort) globalThis.localStorage.setItem(SORT_STORAGE_KEY, prefs.sort)
  } catch {
    // Not remembered; the page itself is unaffected.
  }
}
