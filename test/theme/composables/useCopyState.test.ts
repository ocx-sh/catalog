import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// WP-03 coverage-gap closure: useCopyState had no ported test (source repo
// didn't carry one either). `useClipboard` (`@vueuse/core`) touches
// `navigator.clipboard`, unavailable in this package's Node test
// environment — mocked rather than pulling in a DOM environment for one
// composable.
vi.mock('@vueuse/core', () => ({
  useClipboard: () => ({ copy: vi.fn().mockResolvedValue(undefined) }),
}))

const { useCopyState } = await import('../../../src/theme/composables/useCopyState.js')

describe('useCopyState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('copyText() sets copied, which clears after timeoutMs', async () => {
    const { copied, copyText } = useCopyState(1500)
    await copyText('ocx.sh/kitware/cmake')
    expect(copied.value).toBe(true)
    vi.advanceTimersByTime(1499)
    expect(copied.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(copied.value).toBe(false)
  })

  test('a second copyText() before the first clears resets the timer', async () => {
    const { copied, copyText } = useCopyState(1500)
    await copyText('first')
    vi.advanceTimersByTime(1000)
    await copyText('second')
    // Original 1500ms mark from the first call — without the clearTimeout,
    // this would wrongly reset `copied` early.
    vi.advanceTimersByTime(1000)
    expect(copied.value).toBe(true)
    vi.advanceTimersByTime(500)
    expect(copied.value).toBe(false)
  })

  test('defaults timeoutMs to 1500', async () => {
    const { copied, copyText } = useCopyState()
    await copyText('x')
    vi.advanceTimersByTime(1500)
    expect(copied.value).toBe(false)
  })
})
