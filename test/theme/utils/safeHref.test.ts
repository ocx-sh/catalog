import { describe, expect, test } from 'vitest'
import { safeHref } from '../../../src/theme/utils/safeHref.js'

describe('safeHref', () => {
  test('passes absolute http(s) URLs through unchanged', () => {
    expect(safeHref('https://github.com/ocx-sh/index')).toBe('https://github.com/ocx-sh/index')
    expect(safeHref('http://example.test/x')).toBe('http://example.test/x')
  })

  test('blocks script-bearing and non-http schemes', () => {
    // Both wire fields that reach an `:href` — `upstream.repository_url`
    // (human-governed) and `source` (publisher-controlled annotation,
    // schema-restricted to https but re-checked here) — funnel through this
    // one guard, so this is the render-layer half of the CWE-79 defense.
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHref('vbscript:msgbox(1)')).toBeNull()
  })

  test('blocks malformed and absent values', () => {
    expect(safeHref('//evil.test/x')).toBeNull() // scheme-relative: not an absolute URL
    expect(safeHref('not a url')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})
