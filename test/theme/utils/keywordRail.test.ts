import { describe, expect, test } from 'vitest'
import { selectRailKeywords } from '../../../src/theme/utils/keywordRail.js'

const items = (...keywordLists: string[][]) => keywordLists.map(keywords => ({ keywords }))

describe('selectRailKeywords', () => {
  test('ubiquitous keyword loses to real splitters despite highest frequency', () => {
    // "cli" is on every package (score 0); "lint"/"build" each split 2/4.
    const catalog = items(['cli', 'lint'], ['cli', 'lint'], ['cli', 'build'], ['cli', 'build'])
    const rail = selectRailKeywords(catalog, 2).map(c => c.keyword)
    expect(rail.sort()).toEqual(['build', 'lint'])
  })

  test('redundant keyword (same package set) is not picked twice', () => {
    // "k8s" and "kubernetes" cover identical packages; "security" is distinct.
    const catalog = items(
      ['k8s', 'kubernetes'],
      ['k8s', 'kubernetes'],
      ['security'],
      ['other'],
    )
    const rail = selectRailKeywords(catalog, 2).map(c => c.keyword)
    // Exactly one of the redundant pair makes the rail; the other slot goes
    // to a distinct-coverage keyword ("security"/"other" tie, either is fine).
    expect(rail.filter(kw => kw === 'k8s' || kw === 'kubernetes')).toHaveLength(1)
    expect(rail.filter(kw => kw === 'security' || kw === 'other')).toHaveLength(1)
  })

  test('pads with frequency when nothing splits (homogeneous catalog)', () => {
    const catalog = items(['cli', 'tool'], ['cli', 'tool'])
    const rail = selectRailKeywords(catalog, 2)
    expect(rail.map(c => c.keyword)).toEqual(['cli', 'tool'])
    expect(rail[0]?.count).toBe(2)
  })

  test('respects limit and reports total counts', () => {
    const catalog = items(['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'])
    const rail = selectRailKeywords(catalog, 3)
    expect(rail).toHaveLength(3)
    for (const chip of rail) expect(chip.count).toBe(2)
  })

  test('empty catalog yields empty rail', () => {
    expect(selectRailKeywords([], 8)).toEqual([])
  })
})
