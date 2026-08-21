import { describe, expect, test } from 'vitest'
import { monogramHue, monogramInitials } from '../../../src/theme/utils/monogram.js'

describe('monogramHue', () => {
  test('deterministic: same input always yields the same hue across calls', () => {
    const a = monogramHue('kitware/cmake')
    const b = monogramHue('kitware/cmake')
    const c = monogramHue('kitware/cmake')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  test('stable known-input snapshot', () => {
    // Pinned to the djb2-style hash's actual output for these keys — a
    // change here means the hash function itself changed (tile colors
    // would visibly shift for existing packages), not just a refactor.
    expect(monogramHue('kitware/cmake')).toBe(0)
    expect(monogramHue('ocx-contrib/shellcheck')).toBe(2)
  })

  test('always in range [0, 3]', () => {
    for (const key of ['', 'a', 'kitware/cmake', 'ocx-contrib/shellcheck', 'x'.repeat(200)]) {
      const hue = monogramHue(key)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThanOrEqual(3)
    }
  })
})

describe('monogramInitials', () => {
  test('no separator: first two characters, uppercased', () => {
    expect(monogramInitials('cmake')).toBe('CM')
    expect(monogramInitials('shellcheck')).toBe('SH')
  })

  test('hyphen/underscore/dot separators: first char of first two segments', () => {
    expect(monogramInitials('foo-bar')).toBe('FB')
    expect(monogramInitials('a_b_c')).toBe('AB')
    expect(monogramInitials('foo.bar')).toBe('FB')
  })
})
