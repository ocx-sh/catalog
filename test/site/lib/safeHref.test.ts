import { describe, expect, test } from 'vitest'
import { safeHref } from '../../../src/site/lib/safeHref.js'

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

  test('blocks a script scheme hidden behind whitespace or control characters', () => {
    // The URL parser strips these, so they still parse as `javascript:`.
    expect(safeHref(' javascript:alert(1)')).toBeNull()
    expect(safeHref('\tjavascript:alert(1)')).toBeNull()
    expect(safeHref('java\nscript:alert(1)')).toBeNull()
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
  })

  test('blocks other absolute schemes', () => {
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('ftp://example.test/x')).toBeNull()
    expect(safeHref('blob:https://example.test/0f1e')).toBeNull()
  })

  test('blocks http(s) spelled without "//" or behind whitespace: not the absolute URL it looks like', () => {
    // `new URL` parses all of these as http(s), but a browser resolves
    // `http:evil.test` against the page when the schemes match.
    expect(safeHref('http:evil.test')).toBeNull()
    expect(safeHref('https:/evil.test')).toBeNull()
    expect(safeHref(' https://example.test/x')).toBeNull()
    expect(safeHref('ht\ttps://example.test/x')).toBeNull()
  })

  test('accepts the scheme in any case', () => {
    expect(safeHref('HTTPS://Example.test/x')).toBe('HTTPS://Example.test/x')
  })

  test('blocks malformed and absent values', () => {
    expect(safeHref('//evil.test/x')).toBeNull() // scheme-relative: not an absolute URL
    expect(safeHref('not a url')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})
