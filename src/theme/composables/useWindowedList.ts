import { computed, nextTick, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

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
 * Renders a growing slice of a list rather than all of it.
 *
 * The catalog's cost at corporate size is dominated by CONSTRUCTING
 * components, not by drawing them. `content-visibility` on the card and the
 * row already means the browser skips layout and paint for anything off
 * screen, but Vue still built every one — and an item is not just a card, it
 * is a `CopyContextMenu` (four reka-ui components, plus a computed building
 * seven copy actions) wrapped around one. Measured at 252 packages, 4x CPU
 * throttle: 1748ms to switch to the table view, 2224ms before a stored table
 * view was on screen at all, because the grid and the table share no element
 * types and so every card unmounts as every row mounts.
 *
 * So only a viewport's worth is built, and the slice GROWS as a sentinel
 * below the list comes into view. It never shrinks, which is the whole reason
 * this is a slice and not virtualization: an item that has been built stays
 * built, so scrolling back up can never meet a blank row, and find-in-page
 * keeps working over everything reached so far. The worst case — a reader who
 * scrolls to the bottom — is exactly the old behaviour, and its paint is
 * still bounded by `content-visibility`.
 *
 * The window is a RENDER slice and nothing else: the result count, the
 * keyword rail and every filter still read the full list, so nothing the
 * reader is told about the catalog depends on how far they have scrolled.
 *
 * @param source the full, already-filtered-and-sorted list
 * @param size how many to build per slice
 * @returns `visible` (what to render), `sentinel` (bind it to an element
 *   BELOW the list), and `hasMore` (whether to render that element at all)
 */
export function useWindowedList<T>(source: MaybeRefOrGetter<readonly T[]>, size = WINDOW_SIZE) {
  const limit = ref(size)
  // shallowRef: this holds a DOM element, and making one deeply reactive is
  // both pointless and expensive.
  const sentinel = shallowRef<HTMLElement | null>(null)
  const all = computed(() => toValue(source))

  // A new result set starts a new window — otherwise narrowing to three
  // matches and then clearing the filter again would leave the whole catalog
  // built. `all` changes identity exactly when the answer changes, since the
  // filter/sort chain it comes from is memoized.
  watch(all, () => {
    limit.value = size
  })

  const visible = computed(() => (limit.value >= all.value.length ? all.value : all.value.slice(0, limit.value)))
  const hasMore = computed(() => visible.value.length < all.value.length)

  // `rootMargin` is what keeps this invisible in use: the next slice is built
  // a screen and a half before the reader gets to it, so the list reads as
  // complete rather than as something that loads while you look at it.
  useIntersectionObserver(
    sentinel,
    (entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (limit.value >= all.value.length) return
      // Doubling, capped at eight slices: 48, 96, 192, 384, then +384. Every
      // growth re-lays-out the whole table — its subgrid tracks are sized
      // over every row, so an append near the bottom of 3000 rows is a
      // ~700ms layout whether it adds 48 rows or 384. What a reader who
      // scrolls the whole way pays is the NUMBER of those, and this takes it
      // from 63 to 11. The cap keeps a single growth to a few hundred
      // items, so no one step is a second-long freeze either.
      // ponytail: still O(n) per growth past a couple of thousand rows —
      // the upgrade is virtualization (unmounting what scrolled out), and the
      // signal for it is this scroll costing seconds at a real index's size.
      limit.value += Math.min(limit.value, size * 8)
      // An IntersectionObserver reports TRANSITIONS, not states. Once the
      // slice is built the sentinel has moved down by the slice's height —
      // and if that is less than the margin (48 table rows are ~1900px, the
      // margin is 150% of the viewport) or the reader is scrolling faster
      // than slices build, it is still inside the margin, nothing has
      // transitioned, and the window never grows again. Measured: a scroll
      // to the bottom of 3000 packages stopped dead at 720. Re-observing
      // delivers a fresh initial record for the sentinel's CURRENT position,
      // so the window keeps growing until the sentinel is actually out of
      // reach or the list is exhausted (at which point `hasMore` removes it).
      nextTick(() => {
        const el = sentinel.value
        if (!el) return
        observer.unobserve(el)
        observer.observe(el)
      })
    },
    { rootMargin: '150% 0px' },
  )

  /**
   * Back to one slice. For a change that rebuilds every item anyway — the
   * view switch: the grid and the table share no element types — so the
   * cost of the switch is one slice regardless of how far the reader had
   * scrolled, rather than however many hundred items were built.
   */
  function reset() {
    limit.value = size
  }

  return { visible, sentinel, hasMore, reset }
}
