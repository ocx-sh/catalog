import { describe, expect, test } from 'vitest'
import { AGNOSTIC_OS, concreteOses, displayOses, isPlatformAgnostic, OS_ORDER, osOf, osRank } from '../../../src/site/lib/platformAgnostic.js'

describe('osOf', () => {
  test('takes the OS half of an os/arch string', () => {
    expect(osOf('linux/amd64')).toBe('linux')
    expect(osOf('any/any')).toBe(AGNOSTIC_OS)
  })
})

describe('isPlatformAgnostic', () => {
  test('is true when the only platform is any/any', () => {
    expect(isPlatformAgnostic(['any/any'])).toBe(true)
  })

  test('is true when any/any sits beside real platforms — it subsumes them', () => {
    expect(isPlatformAgnostic(['any/any', 'linux/amd64'])).toBe(true)
    expect(isPlatformAgnostic(['linux/amd64', 'any/any'])).toBe(true)
  })

  test('is false for a package with no platforms at all', () => {
    expect(isPlatformAgnostic([])).toBe(false)
  })

  test('is false for real platforms only', () => {
    expect(isPlatformAgnostic(['linux/amd64'])).toBe(false)
  })
})

describe('concreteOses', () => {
  test('lists distinct real OSes in first-seen order', () => {
    expect(concreteOses(['linux/amd64', 'linux/arm64', 'darwin/arm64'])).toEqual(['linux', 'darwin'])
  })

  test('is empty for an agnostic package, whether or not real platforms sit beside any', () => {
    expect(concreteOses(['any/any'])).toEqual([])
    expect(concreteOses(['any/any', 'linux/amd64'])).toEqual([])
  })
})

describe('osRank', () => {
  test('ranks linux, darwin, windows in OS_ORDER position', () => {
    expect(osRank('linux')).toBe(0)
    expect(osRank('darwin')).toBe(1)
    expect(osRank('windows')).toBe(2)
  })

  test('ranks an unknown OS after every known one', () => {
    expect(osRank('freebsd')).toBe(OS_ORDER.length)
  })

  test('ranks the platform-agnostic entry ahead of every real OS', () => {
    expect(osRank(AGNOSTIC_OS)).toBeLessThan(osRank('linux'))
  })
})

describe('displayOses', () => {
  test('lists the glyphed OSes a package ships in canonical order, once each', () => {
    expect(displayOses(['windows/amd64', 'linux/arm64', 'linux/amd64'])).toEqual(['linux', 'windows'])
    expect(OS_ORDER).toEqual(['linux', 'darwin', 'windows'])
  })

  test('draws the globe alone for a platform-agnostic package, any real OS beside it subsumed', () => {
    expect(displayOses(['any/any'])).toEqual(['any'])
    expect(displayOses(['linux/amd64', 'any/any'])).toEqual(['any'])
  })

  test('an OS with no glyph draws nothing; a package without platforms draws nothing', () => {
    expect(displayOses(['freebsd/amd64'])).toEqual([])
    expect(displayOses([])).toEqual([])
  })
})
