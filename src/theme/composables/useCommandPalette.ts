import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vitepress'
import { isEditableTarget } from '../utils/dom'

// Module-singleton — `isOpen` is one shared ref so every consumer (the
// SiteHeader trigger button, the global shortcut listener below, and
// SearchModal.vue itself) agrees on state without prop drilling or an
// event bus. Safe as module state (not per-component) because there is
// exactly one palette in the whole app (mounted once in Layout.vue).
const isOpen = ref(false)

export function useCommandPalette() {
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false },
    toggle: () => { isOpen.value = !isOpen.value },
  }
}

/**
 * Global ⌘K/Ctrl-K + "/" shortcut. Call once, from the singleton modal
 * consumer (`components/search/SearchModal.vue`, mounted once in
 * `Layout.vue`) — the listener is a real `window` event, so a second
 * caller would double-fire opens/toggles since `isOpen` is shared state.
 *
 * Frozen cross-WP "/" decision (plan_site_redesign.md Status block): the
 * catalog route ("/") owns its own scoped "/" handler that focuses its
 * inline SearchInput (WP-C). This listener explicitly skips "/" there so
 * the two never race — it never imports anything from WP-C's scope to
 * make that check, just the route path.
 */
export function useGlobalPaletteShortcut() {
  const { open, toggle } = useCommandPalette()
  const route = useRoute()

  function onKeydown(e: KeyboardEvent) {
    if (isEditableTarget(document.activeElement)) return

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      toggle()
      return
    }

    if (e.key === '/' && route.path !== '/') {
      e.preventDefault()
      open()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
