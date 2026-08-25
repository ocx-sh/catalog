import { afterEach, describe, expect, test, vi } from 'vitest'
import { CTRL, COMMAND, isApplePlatform, paletteModifier } from '../../../src/theme/utils/modifierKey.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isApplePlatform', () => {
  test('false when navigator is undefined (SSR/Node)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isApplePlatform()).toBe(false)
  })

  test('true via userAgentData.platform', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } })
    expect(isApplePlatform()).toBe(true)
  })

  test('false via userAgentData.platform on a non-Apple platform', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Linux x86_64' } })
    expect(isApplePlatform()).toBe(false)
  })

  test('true via the deprecated navigator.platform fallback, when userAgentData is absent', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(isApplePlatform()).toBe(true)
  })

  test('false when neither userAgentData nor platform is set', () => {
    vi.stubGlobal('navigator', {})
    expect(isApplePlatform()).toBe(false)
  })

  test('matches iPhone/iPad/iPod too, not just mac', () => {
    vi.stubGlobal('navigator', { platform: 'iPhone' })
    expect(isApplePlatform()).toBe(true)
  })
})

describe('paletteModifier', () => {
  test('COMMAND on an Apple platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(paletteModifier()).toBe(COMMAND)
  })

  test('CTRL everywhere else', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(paletteModifier()).toBe(CTRL)
  })
})
