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

  test('platforms facet: OR within the facet (matches ANY selected platform)', () => {
    const packages = [
      pkg({ name: 'a', platforms: ['linux/amd64'] }),
      pkg({ name: 'b', platforms: ['darwin/arm64'] }),
      pkg({ name: 'c', platforms: ['windows/amd64'] }),
    ]
    const result = filterPackages(packages, { platforms: ['linux', 'darwin'] }).map(p => p.name)
    expect(result.sort()).toEqual(['a', 'b'])
  })

  test('keywords facet: OR within the facet (matches ANY selected keyword)', () => {
    const packages = [
      pkg({ name: 'a', keywords: ['build'] }),
      pkg({ name: 'b', keywords: ['lint'] }),
      pkg({ name: 'c', keywords: ['test'] }),
    ]
    const result = filterPackages(packages, { keywords: ['build', 'lint'] }).map(p => p.name)
    expect(result.sort()).toEqual(['a', 'b'])
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
