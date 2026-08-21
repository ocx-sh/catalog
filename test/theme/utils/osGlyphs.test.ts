import { describe, expect, test } from 'vitest'
import { OS_GLYPHS, OS_ORDER, osRank } from '../../../src/theme/utils/osGlyphs.js'

// WP-03 coverage-gap closure: osRank had no ported test (source repo didn't
// carry one either).
describe('osRank', () => {
  test('ranks linux, darwin, windows in OS_ORDER position', () => {
    expect(osRank('linux')).toBe(0)
    expect(osRank('darwin')).toBe(1)
    expect(osRank('windows')).toBe(2)
  })

  test('ranks an unknown OS after every known one', () => {
    expect(osRank('freebsd')).toBe(OS_ORDER.length)
  })
})

describe('OS_GLYPHS', () => {
  test('has an entry for every OS_ORDER member', () => {
    for (const os of OS_ORDER) {
      expect(OS_GLYPHS[os]).toBeDefined()
      expect(typeof OS_GLYPHS[os]!.label).toBe('string')
    }
  })
})
