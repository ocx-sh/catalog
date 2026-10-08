import { describe, expect, test } from 'vitest'
import { AGNOSTIC_OS, concreteOses, isPlatformAgnostic, osOf } from '../../../src/site/lib/platformAgnostic.js'
import { OS_GLYPHS, osRank } from '../../../src/site/lib/osGlyphs.js'

describe('osOf', () => {
  test('takes the OS half of an os/arch string', () => {
    expect(osOf('linux/amd64')).toBe('linux')
    expect(osOf('any/any')).toBe(AGNOSTIC_OS)
  })
})

describe('isPlatformAgnostic', () => {
  test('is true when the only platform is any/any', () => {
    expect(isPlatformAgnostic(['any/any'])).toBe(true)
  })

  test('is true when any/any sits beside real platforms — it subsumes them', () => {
    expect(isPlatformAgnostic(['any/any', 'linux/amd64'])).toBe(true)
    expect(isPlatformAgnostic(['linux/amd64', 'any/any'])).toBe(true)
  })

  test('is false for a package with no platforms at all', () => {
    expect(isPlatformAgnostic([])).toBe(false)
  })

  test('is false for real platforms only', () => {
    expect(isPlatformAgnostic(['linux/amd64'])).toBe(false)
  })
})

describe('concreteOses', () => {
  test('lists distinct real OSes in first-seen order', () => {
    expect(concreteOses(['linux/amd64', 'linux/arm64', 'darwin/arm64'])).toEqual(['linux', 'darwin'])
  })

  test('is empty for an agnostic package, whether or not real platforms sit beside any', () => {
    expect(concreteOses(['any/any'])).toEqual([])
    expect(concreteOses(['any/any', 'linux/amd64'])).toEqual([])
  })
})

describe('the any glyph', () => {
  test('has a drawable, labelled entry in OS_GLYPHS', () => {
    const glyph = OS_GLYPHS[AGNOSTIC_OS]!
    expect(glyph.label).toBe('Any platform')
    expect((glyph.paths?.length ?? 0) + (glyph.rects?.length ?? 0)).toBeGreaterThan(0)
  })

  test('ranks ahead of every real OS', () => {
    expect(osRank(AGNOSTIC_OS)).toBeLessThan(osRank('linux'))
  })
})
