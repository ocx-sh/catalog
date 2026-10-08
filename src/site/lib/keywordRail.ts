export interface KeywordChip {
  keyword: string
  count: number
}

/**
 * Picks the rail's keyword chips by SPLITTING POWER, not raw frequency
 * (owner decision, 2026-08-04): a chip is worth a rail slot when clicking
 * it meaningfully partitions the catalog, so
 *
 * - a near-ubiquitous keyword scores ~0 (clicking barely narrows),
 * - a tiny keyword scores low (barely selects anything),
 * - a keyword redundant with already-picked chips scores low (its packages
 *   are already reachable).
 *
 * Greedy: each round scores every unpicked keyword as
 * `min(uncoveredCount, total - count)` — a tent over coverage (peaks near
 * half the catalog) intersected with the marginal (not-yet-covered) gain —
 * and takes the best. Ties: higher total count, then alphabetical. When no
 * candidate scores > 0 (tiny or homogeneous catalogs), remaining slots are
 * padded by plain frequency so the rail never renders emptier than it must.
 *
 * Input is structurally narrow (only `keywords` is read) so tests don't
 * need full CatalogPackage fixtures.
 */
export function selectRailKeywords(
  items: readonly { keywords: readonly string[] }[],
  limit: number,
): KeywordChip[] {
  const total = items.length
  const members = new Map<string, Set<number>>()
  items.forEach((item, i) => {
    for (const kw of item.keywords) {
      let set = members.get(kw)
      if (!set) members.set(kw, (set = new Set()))
      set.add(i)
    }
  })

  const picked: KeywordChip[] = []
  const pickedSet = new Set<string>()
  const covered = new Set<number>()

  while (picked.length < limit) {
    let best: string | null = null
    let bestScore = 0
    let bestCount = 0
    for (const [kw, set] of members) {
      if (pickedSet.has(kw)) continue
      let uncovered = 0
      for (const i of set) if (!covered.has(i)) uncovered++
      const score = Math.min(uncovered, total - set.size)
      const wins =
        score > bestScore ||
        (score === bestScore && score > 0 && (set.size > bestCount || (set.size === bestCount && best !== null && kw < best)))
      if (wins) {
        best = kw
        bestScore = score
        bestCount = set.size
      }
    }
    if (best === null) break
    picked.push({ keyword: best, count: members.get(best)!.size })
    pickedSet.add(best)
    for (const i of members.get(best)!) covered.add(i)
  }

  // Frequency padding for the slots greedy couldn't justify.
  if (picked.length < limit) {
    const rest = [...members]
      .filter(([kw]) => !pickedSet.has(kw))
      .map(([keyword, set]) => ({ keyword, count: set.size }))
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    picked.push(...rest.slice(0, limit - picked.length))
  }

  return picked
}
