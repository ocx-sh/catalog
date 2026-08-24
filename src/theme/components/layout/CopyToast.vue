<script setup lang="ts">
import { useToast } from '../../composables/useToast'

// Bottom-right copy confirmation (owner spec): shows the semantic meaning
// of what landed on the clipboard, not the payload. Mounted once in Layout.
const { message } = useToast()
</script>

<template>
  <Transition name="copy-toast">
    <div v-if="message" class="copy-toast" role="status" aria-live="polite">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
@layer ocx {
.copy-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--ocx-color-surface);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  box-shadow: var(--ocx-shadow-overlay);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg);
}

.copy-toast svg {
  color: var(--ocx-color-success);
  flex-shrink: 0;
}

.copy-toast-enter-active,
.copy-toast-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.copy-toast-enter-from,
.copy-toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
}
</style>
