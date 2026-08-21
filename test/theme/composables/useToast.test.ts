import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useToast } from '../../../src/theme/composables/useToast.js'

// WP-03 coverage-gap closure: useToast had no ported test (source repo
// didn't carry one either). `message`/`timer` are module-level singletons
// (one toast surface for the whole site) — fake timers keep each case's
// auto-clear deterministic and isolated.
describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('toast() sets the message', () => {
    const { message, toast } = useToast()
    toast('Copied — install command')
    expect(message.value).toBe('Copied — install command')
  })

  test('message auto-clears after 2000ms', () => {
    const { message, toast } = useToast()
    toast('Copied')
    vi.advanceTimersByTime(1999)
    expect(message.value).toBe('Copied')
    vi.advanceTimersByTime(1)
    expect(message.value).toBeNull()
  })

  test('a second toast() before the first clears resets the timer (no stale clear)', () => {
    const { message, toast } = useToast()
    toast('first')
    vi.advanceTimersByTime(1000)
    toast('second')
    // Original 2000ms mark from "first" — without the clearTimeout, this
    // would wrongly null out "second" early.
    vi.advanceTimersByTime(1000)
    expect(message.value).toBe('second')
    vi.advanceTimersByTime(1000)
    expect(message.value).toBeNull()
  })
})
