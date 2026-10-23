import { describe, expect, test } from 'vitest'
import { plural } from '../../../src/site/lib/plural.js'

describe('plural', () => {
  test('takes an s unless the count is exactly one', () => {
    expect(plural(0, 'package')).toBe('0 packages')
    expect(plural(1, 'package')).toBe('1 package')
    expect(plural(1, 'tag')).toBe('1 tag')
    expect(plural(2, 'tag')).toBe('2 tags')
  })
})
