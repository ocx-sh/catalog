<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import type { Header } from 'vitepress'
import DocsSidebar from './DocsSidebar.vue'
import OnThisPage from './OnThisPage.vue'

defineProps<{ headers: Header[] }>()

const open = ref(false)
const route = useRoute()

// Close on any navigation, including same-page hash jumps from
// OnThisPage.vue links inside the drawer (route.path alone wouldn't catch
// those, so any <a> click inside the drawer closes it too — see
// onDrawerClick below).
watch(() => route.path, () => { open.value = false })

function onDrawerClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) open.value = false
}
</script>

<template>
  <div class="docs-mobile-nav">
    <button
      type="button"
      class="docs-mobile-trigger"
      :aria-expanded="open"
      aria-controls="docs-mobile-drawer"
      @click="open = !open"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
      Contents
    </button>

    <Teleport to="body">
      <div v-if="open" class="docs-mobile-backdrop" @click="open = false" />
      <div
        v-if="open"
        id="docs-mobile-drawer"
        class="docs-mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Docs navigation"
        @click="onDrawerClick"
      >
        <button type="button" class="docs-mobile-close" aria-label="Close navigation" @click="open = false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
        <DocsSidebar />
        <OnThisPage v-if="headers.length" :headers="headers" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@layer ocx {
.docs-mobile-trigger {
  display: none;
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: var(--ocx-z-drawer-backdrop);
  align-items: center;
  gap: 6px;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-fg);
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-full);
  padding: 8px 14px;
}

@media (max-width: 639px) {
  .docs-mobile-trigger {
    display: inline-flex;
  }
}

.docs-mobile-backdrop {
  position: fixed;
  inset: 0;
  background: var(--ocx-color-overlay);
  z-index: var(--ocx-z-drawer);
}

.docs-mobile-drawer {
  position: fixed;
  inset: 0 25% 0 0;
  min-width: 260px;
  z-index: var(--ocx-z-drawer-close);
  background: var(--ocx-color-surface);
  border-right: var(--ocx-border-width) solid var(--ocx-color-border);
  overflow-y: auto;
  padding: 20px 0 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.docs-mobile-close {
  align-self: flex-end;
  margin: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--ocx-color-fg-subtle);
  background: none;
  border: none;
  border-radius: var(--ocx-radius-sm);
}

.docs-mobile-close:hover {
  color: var(--ocx-color-fg);
}
}
</style>
