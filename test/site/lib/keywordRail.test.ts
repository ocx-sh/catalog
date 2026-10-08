import { describe, expect, test } from 'vitest'
import { cardKeywords, keywordFrequency, selectRailKeywords } from '../../../src/site/lib/keywordRail.js'

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

describe('keywordFrequency', () => {
  test('counts per keyword, most common first, ties alphabetical', () => {
    expect(keywordFrequency(items(['b', 'a'], ['b'], ['c', 'a'], ['d']))).toEqual([
      { keyword: 'a', count: 2 },
      { keyword: 'b', count: 2 },
      { keyword: 'c', count: 1 },
      { keyword: 'd', count: 1 },
    ])
  })

  test('an empty list has no keywords', () => {
    expect(keywordFrequency([])).toEqual([])
  })
})

describe('cardKeywords', () => {
  const frequency = keywordFrequency(items(['x', 'y'], ['x', 'z'], ['x'], ['y']))

  test('puts the catalog-wide most common keyword first and cuts to the limit', () => {
    expect(cardKeywords(['z', 'y', 'x'], frequency)).toEqual(['x', 'y', 'z'])
    expect(cardKeywords(['z', 'y', 'x'], frequency, 2)).toEqual(['x', 'y'])
  })

  test('a keyword the frequency list has never seen sorts last', () => {
    expect(cardKeywords(['unknown', 'z'], frequency)).toEqual(['z', 'unknown'])
    expect(cardKeywords(['z', 'unknown'], frequency)).toEqual(['z', 'unknown'])
  })

  test('does not mutate its input', () => {
    const input = ['z', 'x']
    cardKeywords(input, frequency)
    expect(input).toEqual(['z', 'x'])
  })
})
