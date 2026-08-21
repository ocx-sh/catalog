// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

// WP-03 coverage-gap closure: useCommandPalette had no ported test (source
// repo didn't carry one either). `useGlobalPaletteShortcut` registers a real
// `window` keydown listener from `onMounted` — both need an active Vue
// component instance (a mount host, via @vue/test-utils) and a DOM
// (happy-dom, scoped to this file).

const routeState = { path: '/kitware/cmake' }
vi.mock('vitepress', () => ({ useRoute: () => routeState }))

const { useCommandPalette, useGlobalPaletteShortcut } = await import(
  '../../../src/theme/composables/useCommandPalette.js'
)

function mountShortcut() {
  const Host = defineComponent({
    setup() {
      useGlobalPaletteShortcut()
      return () => null
    },
  })
  return mount(Host)
}

function keydown(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

describe('useCommandPalette', () => {
  afterEach(() => {
    // Module-singleton `isOpen` — reset between tests.
    useCommandPalette().close()
  })

  test('open/close/toggle mutate the shared isOpen ref', () => {
    const { isOpen, open, close, toggle } = useCommandPalette()
    expect(isOpen.value).toBe(false)
    open()
    expect(isOpen.value).toBe(true)
    close()
    expect(isOpen.value).toBe(false)
    toggle()
    expect(isOpen.value).toBe(true)
    toggle()
    expect(isOpen.value).toBe(false)
  })

  test('a second useCommandPalette() call shares the same isOpen state', () => {
    const a = useCommandPalette()
    const b = useCommandPalette()
    a.open()
    expect(b.isOpen.value).toBe(true)
  })
})

describe('useGlobalPaletteShortcut', () => {
  afterEach(() => {
    useCommandPalette().close()
    document.body.replaceChildren()
  })

  test('Cmd/Ctrl+K toggles the palette open', () => {
    const wrapper = mountShortcut()
    keydown({ key: 'k', metaKey: true })
    expect(useCommandPalette().isOpen.value).toBe(true)
    keydown({ key: 'K', ctrlKey: true })
    expect(useCommandPalette().isOpen.value).toBe(false)
    wrapper.unmount()
  })

  test('"/" opens the palette when the route is not "/"', () => {
    routeState.path = '/kitware/cmake'
    const wrapper = mountShortcut()
    keydown({ key: '/' })
    expect(useCommandPalette().isOpen.value).toBe(true)
    wrapper.unmount()
  })

  test('"/" is a no-op on the catalog route ("/") — that page owns its own handler', () => {
    routeState.path = '/'
    const wrapper = mountShortcut()
    keydown({ key: '/' })
    expect(useCommandPalette().isOpen.value).toBe(false)
    wrapper.unmount()
    routeState.path = '/kitware/cmake'
  })

  test('a shortcut is skipped while an editable element is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const wrapper = mountShortcut()
    keydown({ key: 'k', metaKey: true })
    expect(useCommandPalette().isOpen.value).toBe(false)
    wrapper.unmount()
  })

  test('unmount removes the listener — a later keydown is a no-op', () => {
    const wrapper = mountShortcut()
    wrapper.unmount()
    keydown({ key: 'k', metaKey: true })
    expect(useCommandPalette().isOpen.value).toBe(false)
  })

  test('an unrelated key is ignored', () => {
    const wrapper = mountShortcut()
    keydown({ key: 'a' })
    expect(useCommandPalette().isOpen.value).toBe(false)
    wrapper.unmount()
  })
})
