import { describe, expect, test } from 'vitest'
import { monogramInitials } from '../../../src/site/lib/monogram.js'

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
