import { describe, expect, test } from 'vitest'
import { casUrl, rootHref } from '../../../src/site/lib/cas.js'

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

  test('returns null for another algorithm or a trailing newline', () => {
    expect(casUrl('kitware/cmake', `sha512:${'a'.repeat(64)}`, 'svg')).toBeNull()
    expect(casUrl('kitware/cmake', `sha256:${'a'.repeat(64)}\n`, 'svg')).toBeNull()
  })

  // Per subsystem-sources.md the guard is path safety, not hex-ness: the
  // `demo:seed` placeholder digests ("kkkk…") must still fetch.
  test('accepts non-hex [a-z0-9] digests', () => {
    expect(casUrl('kitware/cmake', `sha256:${'k'.repeat(64)}`, 'md')).toBe(`/p/kitware/cmake/o/sha256/${'k'.repeat(64)}.md`)
  })

  test('mounts a non-root source under index/<label>', () => {
    expect(casUrl('kitware/cmake', `sha256:${'a'.repeat(64)}`, 'svg', 'index/b')).toBe(
      `/index/b/p/kitware/cmake/o/sha256/${'a'.repeat(64)}.svg`,
    )
  })

  test('returns null for a package name that could escape the path', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    for (const name of ['../evil', 'a/../b', '..', 'a/./b', 'a//b', '', 'a\\b', 'a?x', 'a#x', 'a%2e%2e/b', 'a\nb']) {
      expect(casUrl(name, digest, 'json'), JSON.stringify(name)).toBeNull()
    }
  })

  test('keeps depth-N and dotted package names', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    expect(casUrl('acme/lib/core', digest, 'json')).toBe(`/p/acme/lib/core/o/sha256/${'a'.repeat(64)}.json`)
    expect(casUrl('acme/node.js', digest, 'json')).toBe(`/p/acme/node.js/o/sha256/${'a'.repeat(64)}.json`)
  })
})

// `casUrl` stays catalog-root-relative (the shape catalog.json carries,
// C-008); `rootHref` adds the site `base` on top with `joinBase` (C-016,
// C-039), so the root source (`wireBase` `''`) yields `/p/…`, never `//p/`.

describe('rootHref', () => {
  test('root source: /p/<ns>/<pkg>.json under base, never //p/', () => {
    expect(rootHref('/', 'kitware/cmake')).toBe('/p/kitware/cmake.json')
    expect(rootHref('/catalog/', 'kitware/cmake', '')).toBe('/catalog/p/kitware/cmake.json')
  })

  test('non-root source: index/<label> mount after base', () => {
    expect(rootHref('/catalog/', 'tools/many-tags', 'index/b')).toBe('/catalog/index/b/p/tools/many-tags.json')
  })

  test('depth-N package paths survive intact', () => {
    expect(rootHref('/', 'acme/lib/core')).toBe('/p/acme/lib/core.json')
  })

  test('an escaping package name is refused by joinBase', () => {
    expect(() => rootHref('/', '../evil')).toThrow()
  })
})
