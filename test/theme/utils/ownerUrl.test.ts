import { describe, expect, test } from 'vitest'
import { DEFAULT_OWNER_URL, ownerProfileUrl } from '../../../src/theme/utils/ownerUrl.js'

describe('ownerProfileUrl', () => {
  test('no template -> the GitHub default', () => {
    expect(DEFAULT_OWNER_URL).toBe('https://github.com/{login}')
    expect(ownerProfileUrl(undefined, 'ocx-sh')).toBe('https://github.com/ocx-sh')
  })

  test('fills {login} in a path, query or subdomain template', () => {
    expect(ownerProfileUrl('https://gitlab.com/{login}', 'alice')).toBe('https://gitlab.com/alice')
    expect(ownerProfileUrl('http://forge.internal/u?name={login}&tab=repos', 'alice')).toBe(
      'http://forge.internal/u?name=alice&tab=repos',
    )
    expect(ownerProfileUrl('https://{login}.example.test/', 'alice')).toBe('https://alice.example.test/')
  })

  test('encodes the login: it cannot add a segment, a query or a host', () => {
    expect(ownerProfileUrl('https://gitlab.com/{login}', 'a/b?c#d')).toBe('https://gitlab.com/a%2Fb%3Fc%23d')
    expect(ownerProfileUrl('https://gitlab.com/{login}', 'evil.example/@x')).toBe(
      'https://gitlab.com/evil.example%2F%40x',
    )
  })

  // `String.replace` reads `$&`/`$1` in a replacement STRING; `split`/`join` must not.
  test('a $-pattern in the login is inserted literally', () => {
    expect(ownerProfileUrl('https://gitlab.com/{login}', '$&$1')).toBe('https://gitlab.com/%24%26%241')
  })

  test('a non-http(s) template renders no link at all (safeHref)', () => {
    expect(ownerProfileUrl('javascript:alert(1)//{login}', 'alice')).toBeNull()
    expect(ownerProfileUrl('not a url {login}', 'alice')).toBeNull()
  })

  test('no login -> no link', () => {
    expect(ownerProfileUrl(undefined, undefined)).toBeNull()
    expect(ownerProfileUrl('https://gitlab.com/{login}', null)).toBeNull()
    expect(ownerProfileUrl('https://gitlab.com/{login}', '')).toBeNull()
  })
})
