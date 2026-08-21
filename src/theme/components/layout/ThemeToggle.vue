<script setup lang="ts">
import { useData } from 'vitepress'

// Writes VitePress core's own `isDark` ref directly — never a shadow ref.
// Core already persists the override to `localStorage`
// (`vitepress-theme-appearance`) and re-applies the pre-hydration dark-class
// script on next load (`appearance: true`, the default) — this component
// only flips the boolean.
const { isDark } = useData()

function toggle() {
  isDark.value = !isDark.value
}
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
    @click="toggle"
  >
    <!-- ponytail: v-show, not v-if/v-else, on purpose. SSR always renders
    isDark=false (server has no OS-preference/localStorage signal), but
    VitePress's pre-hydration inline script sets <html class="dark"> from
    localStorage/matchMedia before Vue hydrates, and `useDark()` (core's
    isDark) picks that up synchronously during client setup -- so a
    v-if/v-else here hydrates wanting the OTHER svg subtree than the one
    SSR shipped, a structural mismatch that corrupts Vue's DOM anchors and
    crashes the next patch (any client-side route change) with
    "Cannot read properties of null (reading 'nextSibling')". v-show keeps
    both svgs in the DOM on both sides (only `style` differs, an attribute
    patch, not a structural one) so hydration never disagrees on shape. -->
    <svg
      v-show="isDark"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
    <svg v-show="!isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 0;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color 0.15s;
}

.theme-toggle:hover {
  color: var(--c-text-1);
}
</style>
