import { describe, expect, test } from 'vitest'
import { DOCS_NAV } from '../../../../../src/theme/components/docs/data/docsNav.js'

// WP-03 coverage-gap closure: static nav data, never imported by any other
// ported test — this smoke-checks the shape rather than any specific entry
// (entry content is presentation, not logic).
describe('DOCS_NAV', () => {
  test('is a non-empty list of groups, each with a label, link, and items', () => {
    expect(DOCS_NAV.length).toBeGreaterThan(0)
    for (const group of DOCS_NAV) {
      expect(typeof group.label).toBe('string')
      expect(group.link.startsWith('/docs/')).toBe(true)
      expect(group.items.length).toBeGreaterThan(0)
      for (const item of group.items) {
        expect(typeof item.text).toBe('string')
        expect(item.link.startsWith('/docs/')).toBe(true)
      }
    }
  })
})
