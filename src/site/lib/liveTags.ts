/**
 * The live (non-yanked) tag names of a package root, newest observation
 * first, ties by descending version-aware tag name. The one ordering shared
 * by the build (`detailWire`, which SSRs the first `SSR_TAG_LIMIT`) and the
 * versions island (which appends the rest), so the two can never disagree on
 * which tags are "remaining".
 */
export function liveTagsNewestFirst(
  tags: Readonly<Record<string, { readonly observed: string; readonly yanked?: object | null | undefined }>>,
): string[] {
  return Object.entries(tags)
    .filter(([, entry]) => !entry.yanked)
    .sort(
      ([a, left], [b, right]) =>
        right.observed.localeCompare(left.observed) || b.localeCompare(a, "en", { numeric: true }),
    )
    .map(([tag]) => tag);
}
