import { describe, expect, test } from 'vitest'
import { casUrl, LOGO_EXT_CANDIDATES } from '../../../src/theme/utils/cas.js'

// WP-03 coverage-gap closure: casUrl had no ported test (source repo didn't
// carry one either).
describe('casUrl', () => {
  test('returns null for a missing digest', () => {
    expect(casUrl('kitware/cmake', null, 'svg')).toBeNull()
    expect(casUrl('kitware/cmake', undefined, 'svg')).toBeNull()
  })

  test('returns null for a malformed digest (wrong length, bad chars, no prefix)', () => {
    expect(casUrl('kitware/cmake', `sha256:${'a'.repeat(63)}`, 'svg')).toBeNull()
    expect(casUrl('kitware/cmake', `sha256:${'Z'.repeat(64)}`, 'svg')).toBeNull()
    expect(casUrl('kitware/cmake', 'a'.repeat(64), 'svg')).toBeNull()
  })

  test('builds the /p/<name>/o/sha256/<hex>.<ext> URL for a valid digest', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    expect(casUrl('kitware/cmake', digest, 'svg')).toBe(`/p/kitware/cmake/o/sha256/${'a'.repeat(64)}.svg`)
    expect(casUrl('kitware/cmake', digest, 'png')).toBe(`/p/kitware/cmake/o/sha256/${'a'.repeat(64)}.png`)
  })

  test('LOGO_EXT_CANDIDATES tries svg before png', () => {
    expect(LOGO_EXT_CANDIDATES).toEqual(['svg', 'png'])
  })
})
