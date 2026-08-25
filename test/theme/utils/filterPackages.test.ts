import { describe, expect, test } from 'vitest'
import { filterPackages } from '../../../src/theme/utils/filterPackages.js'
import type { CatalogPackage } from '../../../src/theme/composables/useCatalog.js'

function pkg(overrides: Partial<CatalogPackage>): CatalogPackage {
  return {
    namespace: 'kitware',
    package: 'cmake',
    name: 'kitware/cmake',
    status: 'active',
    deprecatedMessage: null,
    supersededBy: null,
    title: 'CMake',
    description: 'Cross-platform build system',
    keywords: ['build', 'c++'],
    latestVersion: '3.31.7',
    tagCount: 12,
    platforms: ['linux/amd64', 'darwin/arm64'],
    logoUrl: null,
    readmeUrl: null,
    ...overrides,
  }
}

describe('filterPackages', () => {
  test('query matches case-insensitively across name/title/description/keywords', () => {
    const packages = [
      pkg({ name: 'kitware/cmake', title: 'CMake', description: 'Cross-platform build system' }),
      pkg({ name: 'ocx-contrib/shellcheck', package: 'shellcheck', title: 'ShellCheck', description: 'Shell script linter', keywords: ['lint'] }),
    ]

    expect(filterPackages(packages, { query: 'CMAKE' }).map(p => p.name)).toEqual(['kitware/cmake'])
    expect(filterPackages(packages, { query: 'cross-platform' }).map(p => p.name)).toEqual(['kitware/cmake'])
    expect(filterPackages(packages, { query: 'lint' }).map(p => p.name)).toEqual(['ocx-contrib/shellcheck'])
    expect(filterPackages(packages, { query: 'nonexistent' })).toEqual([])
  })

  test('query is fuzzy: a small typo still matches', () => {
    const packages = [
      pkg({ name: 'kitware/cmake' }),
      pkg({ name: 'ocx-contrib/shellcheck', package: 'shellcheck', title: 'ShellCheck', description: 'Shell script linter', keywords: ['lint'] }),
    ]
    expect(filterPackages(packages, { query: 'shellchek' }).map(p => p.name)).toEqual(['ocx-contrib/shellcheck'])
  })

  test('multi-word query intersects: every word must match the same package', () => {
    const packages = [
      pkg({ name: 'kitware/cmake', description: 'Cross-platform build system' }),
      pkg({ name: 'ocx-contrib/shellcheck', package: 'shellcheck', title: 'ShellCheck', description: 'Shell script linter', keywords: ['lint'] }),
    ]
    expect(filterPackages(packages, { query: 'shell linter' }).map(p => p.name)).toEqual(['ocx-contrib/shellcheck'])
    // "build" hits cmake, "shell" hits shellcheck — no package has both.
    expect(filterPackages(packages, { query: 'build shell' })).toEqual([])
  })

  test('query prefix-matches while typing', () => {
    const packages = [pkg({ name: 'kitware/cmake', title: 'CMake' })]
    expect(filterPackages(packages, { query: 'cma' }).map(p => p.name)).toEqual(['kitware/cmake'])
  })

  // Issue #5: these two used to be OR-within-facet, so a second chip WIDENED
  // the result set. Every chip now narrows.
  test('platforms facet: AND within the facet (matches only packages shipping ALL of them)', () => {
    const packages = [
      pkg({ name: 'a', platforms: ['linux/amd64'] }),
      pkg({ name: 'b', platforms: ['darwin/arm64'] }),
      pkg({ name: 'both', platforms: ['linux/amd64', 'darwin/arm64'] }),
    ]
    expect(filterPackages(packages, { platforms: ['linux', 'darwin'] }).map(p => p.name)).toEqual(['both'])
    // One chip still selects everything shipping it — narrowing, not exclusion.
    expect(filterPackages(packages, { platforms: ['linux'] }).map(p => p.name)).toEqual(['a', 'both'])
  })

  test('keywords facet: AND within the facet (matches only packages carrying ALL of them)', () => {
    const packages = [
      pkg({ name: 'a', keywords: ['build'] }),
      pkg({ name: 'b', keywords: ['lint'] }),
      pkg({ name: 'both', keywords: ['build', 'lint'] }),
    ]
    expect(filterPackages(packages, { keywords: ['build', 'lint'] }).map(p => p.name)).toEqual(['both'])
    expect(filterPackages(packages, { keywords: ['build'] }).map(p => p.name)).toEqual(['a', 'both'])
  })

  // A selection no package satisfies must empty the grid, not fall back to a
  // wider match — the visible difference between AND and OR when the two
  // chips have no overlap at all.
  test('a platform pair no package ships yields nothing', () => {
    const packages = [
      pkg({ name: 'a', platforms: ['linux/amd64'] }),
      pkg({ name: 'b', platforms: ['windows/amd64'] }),
    ]
    expect(filterPackages(packages, { platforms: ['linux', 'windows'] })).toEqual([])
  })

  test('facets combine with AND across categories', () => {
    const packages = [
      pkg({ name: 'a', platforms: ['linux/amd64'], keywords: ['build'] }),
      pkg({ name: 'b', platforms: ['linux/amd64'], keywords: ['lint'] }),
      pkg({ name: 'c', platforms: ['darwin/arm64'], keywords: ['build'] }),
    ]
    // linux AND build -> only "a" satisfies both.
    const result = filterPackages(packages, { platforms: ['linux'], keywords: ['build'] })
    expect(result.map(p => p.name)).toEqual(['a'])
  })

  test('deprecatedOnly restricts to status === "deprecated"', () => {
    const packages = [
      pkg({ name: 'a', status: 'active' }),
      pkg({ name: 'b', status: 'deprecated' }),
      pkg({ name: 'c', status: 'yanked' }),
    ]
    expect(filterPackages(packages, { deprecatedOnly: true }).map(p => p.name)).toEqual(['b'])
  })

  // C-603: whole-package `status: 'yanked'` — parallel to deprecatedOnly.
  test('yankedOnly restricts to status === "yanked"', () => {
    const packages = [
      pkg({ name: 'a', status: 'active' }),
      pkg({ name: 'b', status: 'deprecated' }),
      pkg({ name: 'c', status: 'yanked' }),
    ]
    expect(filterPackages(packages, { yankedOnly: true }).map(p => p.name)).toEqual(['c'])
  })

  test('empty filter returns every package unchanged', () => {
    const packages = [pkg({ name: 'a' }), pkg({ name: 'b' })]
    expect(filterPackages(packages, {})).toEqual(packages)
  })

  // WP-03 coverage-gap closure: `extractField`'s `?? ''` fallback (a
  // malformed catalog entry missing a non-keywords field) wasn't exercised
  // by the ported suite — every fixture there always sets every field.
  test('a query still indexes a package with a nullish non-keywords field, without throwing', () => {
    const packages = [pkg({ name: 'a', title: undefined, description: 'Cross-platform build system' })]
    expect(filterPackages(packages, { query: 'cross-platform' }).map(p => p.name)).toEqual(['a'])
  })
})
