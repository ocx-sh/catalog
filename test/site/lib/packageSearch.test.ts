import { describe, expect, test } from 'vitest'
import { applyCutoff, byRelevance, scorePackages, skimScore } from '../../../src/site/lib/packageSearch.js'
import type { CatalogPackage } from '../../../src/site/lib/wireTypes.js'

function pkg(overrides: Partial<CatalogPackage>): CatalogPackage {
  return {
    namespace: 'acme',
    package: 'tool',
    name: 'acme/tool',
    status: 'active',
    deprecatedMessage: null,
    supersededBy: null,
    created: '2026-01-01',
    updated: null,
    title: 'Tool',
    description: '',
    keywords: [],
    latestVersion: null,
    tagCount: 0,
    platforms: [],
    logoUrl: null,
    readmeUrl: null,
    ...overrides,
  }
}

describe('skimScore', () => {
  // Values from grimoire-indexer's suite, which pins them to fuzzy-matcher 0.3.7's SkimMatcherV2 (grim's matcher).
  test('scores exactly what grim scores', () => {
    expect(skimScore('grim', 'grim')).toBe(91)
    expect(skimScore('grimoire', 'grim')).toBe(91)
    expect(skimScore('kube-control', 'kubctl')).toBe(111)
    expect(skimScore('catalog-indexer', 'catlog')).toBe(123)
    expect(skimScore('CodeReview', 'review')).toBe(119)
    expect(skimScore('typescript-quality', 'tsq')).toBe(55)
    expect(skimScore('michael-herwig/arcana/nox', 'hex')).toBe(41)
    expect(skimScore('café', 'é')).toBe(15)
    expect(skimScore('ghcr.io/acme/xtool', 'ghcr.io/acme/x')).toBe(302)
    expect(skimScore('grim', 'grimx')).toBeNull()
    expect(skimScore('grim', '')).toBe(0)
  })
})

describe('scorePackages', () => {
  test('ranks exact name > whole-word name > name prefix > keyword > description', () => {
    const packages = [
      pkg({ name: 'a/described', package: 'described', title: 'Described', description: 'wraps cmake for you' }),
      pkg({ name: 'a/tagged', package: 'tagged', title: 'Tagged', keywords: ['cmake'] }),
      pkg({ name: 'a/cmakelint', package: 'cmakelint', title: 'cmakelint' }),
      pkg({ name: 'a/cmake-format', package: 'cmake-format', title: 'cmake-format' }),
      pkg({ name: 'kitware/cmake', package: 'cmake', title: 'CMake' }),
    ]
    const scores = scorePackages(packages, 'cmake')
    const order = byRelevance(packages, scores).map((p) => p.package)
    expect(order).toEqual(['cmake', 'cmake-format', 'cmakelint', 'tagged', 'described'])
  })

  test('the cutoff keeps the packages named for the query and drops blurb mentions', () => {
    const packages = [
      pkg({ name: 'kitware/cmake', package: 'cmake', title: 'CMake' }),
      pkg({ name: 'a/described', package: 'described', title: 'Described', description: 'wraps cmake for you' }),
    ]
    expect(applyCutoff(packages, scorePackages(packages, 'cmake')).map((p) => p.package)).toEqual(['cmake'])
  })

  test('matches prose by word prefix, not by substring or by letters', () => {
    const packages = [pkg({ description: 'Latest code-review helper; guards your tree' })]
    expect(scorePackages(packages, 'rev').size).toBe(1)
    expect(scorePackages(packages, 'code-review').size).toBe(1)
    expect(scorePackages(packages, '-review').size, 'a separator-carrying term may start mid-word').toBe(1)
    expect(scorePackages(packages, 'test').size, '`test` is inside `latest`, not the start of it').toBe(0)
    expect(scorePackages(packages, 'gard').size, 'letters of `guard`, not a prefix of any word').toBe(0)
  })

  test('finds a name by a tight abbreviation, not by scattered letters', () => {
    const packages = [pkg({ package: 'kube-control', title: 'kube-control' })]
    expect(scorePackages(packages, 'kubctl').size).toBe(1)
    expect(scorePackages(packages, 'kbuctl').size).toBe(0)
  })

  test('requires every term, in any order, and matches namespace prose', () => {
    const packages = [pkg({ namespace: 'kitware', package: 'cmake', title: 'CMake', description: 'build system' })]
    expect(scorePackages(packages, 'build cmake').size).toBe(1)
    expect(scorePackages(packages, 'kitware cmake').size).toBe(1)
    expect(scorePackages(packages, 'cmake rust').size).toBe(0)
  })

  test('the qualified name counts only for a path-like term', () => {
    const packages = [pkg({ name: 'ocx/kitware/cmake', namespace: 'kitware', package: 'cmake', title: 'CMake' })]
    expect(scorePackages(packages, 'ocx').size, 'the index prefix alone matches nothing').toBe(0)
    expect(scorePackages(packages, 'ocx/kitware/cmake').size).toBe(1)
  })

  test('folds case for non-ASCII identifiers and answers an empty query with no scores', () => {
    const packages = [pkg({ package: 'Café', title: 'Café' })]
    expect(scorePackages(packages, 'café').size).toBe(1)
    expect(scorePackages(packages, '   ').size).toBe(0)
  })

  test('a later whole-word occurrence beats an earlier prefix, past a surrogate pair', () => {
    const packages = [pkg({ description: '🚀rustup and rust' })]
    expect(scorePackages(packages, 'rust').get('acme/tool')).toBe(20 * 4)
  })

  test('scores digits in a name and survives a record with missing fields', () => {
    expect(scorePackages([pkg({ package: 'python3', title: 'Python 3' })], 'python3').size).toBe(1)
    const bare = { name: 'x/y' } as unknown as CatalogPackage
    expect(scorePackages([bare], 'y').size).toBe(0)
  })

  test('remembers the last answer for the same array and query, and rescans a new one', () => {
    const packages = [pkg({})]
    const first = scorePackages(packages, 'tool')
    expect(scorePackages(packages, 'tool')).toBe(first)
    expect(scorePackages([...packages], 'tool')).not.toBe(first)
  })
})

describe('applyCutoff', () => {
  test('keeps everything on an all-zero or empty list', () => {
    const packages = [pkg({ name: 'a' }), pkg({ name: 'b' })]
    expect(applyCutoff(packages, new Map())).toHaveLength(2)
    expect(applyCutoff([], new Map())).toEqual([])
  })

  test('measures against the best match on the list it is given', () => {
    const scores = new Map([['top', 100], ['mid', 40], ['low', 20]])
    const list = [{ name: 'mid' }, { name: 'low' }]
    expect(applyCutoff(list, scores).map((p) => p.name)).toEqual(['mid', 'low'])
    expect(applyCutoff([{ name: 'top' }, ...list], scores).map((p) => p.name)).toEqual(['top'])
  })
})

describe('applyCutoff boundary', () => {
  test('keeps a score of exactly half the best and drops the one just under it', () => {
    const scores = new Map([['best', 100], ['half', 50], ['under', 49]])
    const list = [{ name: 'best' }, { name: 'half' }, { name: 'under' }]
    expect(applyCutoff(list, scores).map((p) => p.name)).toEqual(['best', 'half'])
  })

  test('equal scores all survive, in incoming order', () => {
    const scores = new Map([['b', 7], ['a', 7]])
    expect(applyCutoff([{ name: 'b' }, { name: 'a' }], scores).map((p) => p.name)).toEqual(['b', 'a'])
  })
})

describe('scorePackages with missing and non-ASCII text', () => {
  test('a description-only record with null keywords still matches by its description', () => {
    const bare = { name: 'x/y', description: 'a rocket launcher', keywords: null } as unknown as CatalogPackage
    expect(scorePackages([bare], 'rocket').size).toBe(1)
  })

  test('matches a non-ASCII prose word by its prefix, folding case', () => {
    const packages = [pkg({ description: 'Über-fast Straße tooling' })]
    expect(scorePackages(packages, 'über').size).toBe(1)
    expect(scorePackages(packages, 'STRAS').size, 'ß does not fold to ss here').toBe(0)
    expect(scorePackages(packages, 'straß').size).toBe(1)
  })
})

describe('byRelevance', () => {
  test('orders best first and keeps incoming order for equal scores', () => {
    const scores = new Map([['b', 5], ['c', 5], ['a', 9]])
    expect(byRelevance([{ name: 'y' }, { name: 'b' }, { name: 'c' }, { name: 'a' }, { name: 'z' }], scores).map((p) => p.name)).toEqual(['a', 'b', 'c', 'y', 'z'])
  })
})
