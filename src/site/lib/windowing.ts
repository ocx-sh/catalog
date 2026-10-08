/**
 * How many items the catalog builds at a time.
 *
 * 48 covers a tall viewport of either shape with room over: table rows are
 * ~40px, and the card grid is three or four across at the 300px minimum
 * track. Small enough that the first paint is cheap, large enough that a
 * reader on an ordinary screen never sees the second slice arrive.
 */
export const WINDOW_SIZE = 48

/**
 * The limit after one growth step: doubling, capped at eight slices — 48, 96,
 * 192, 384, then +384. Every growth re-lays-out the whole table — its subgrid
 * tracks are sized over every row, so an append near the bottom of 3000 rows is
 * a ~700ms layout whether it adds 48 rows or 384. What a reader who scrolls the
 * whole way pays is the NUMBER of those, and this takes it from 63 to 11. The
 * cap keeps a single growth to a few hundred items, so no one step is a
 * second-long freeze either.
 * ponytail: still O(n) per growth past a couple of thousand rows — the upgrade
 * is virtualization (unmounting what scrolled out), and the signal for it is
 * this scroll costing seconds at a real index's size.
 */
export function nextWindowLimit(limit: number, size: number = WINDOW_SIZE): number {
  return limit + Math.min(limit, size * 8)
}

/** The slice to build: the whole list once the limit reaches it (no copy),
 * else its first `limit` items. */
export function windowSlice<T>(all: readonly T[], limit: number): readonly T[] {
  return limit >= all.length ? all : all.slice(0, limit)
}
