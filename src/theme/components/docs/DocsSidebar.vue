<script setup lang="ts">
import { useRoute } from 'vitepress'
import { DOCS_NAV, type DocsNavGroup } from './data/docsNav'

const route = useRoute()

function isActive(link: string): boolean {
  return route.path === link
}

// A group whose header links to the same page as one of its items (LEGAL →
// Privacy) must not double-highlight — the item is the canonical marker.
function isGroupActive(group: DocsNavGroup): boolean {
  return isActive(group.link) && !group.items.some(item => item.link === group.link)
}
</script>

<template>
  <nav class="docs-sidebar" aria-label="Docs navigation">
    <div v-for="group in DOCS_NAV" :key="group.label" class="docs-nav-group">
      <a
        :href="group.link"
        class="docs-nav-label"
        :class="{ active: isGroupActive(group) }"
      >{{ group.label }}</a>
      <a
        v-for="item in group.items"
        :key="item.link"
        :href="item.link"
        class="docs-nav-item"
        :class="{ active: isActive(item.link) }"
        :aria-current="isActive(item.link) ? 'page' : undefined"
      >{{ item.text }}</a>
    </div>
  </nav>
</template>

<style scoped>
@layer ocx {
.docs-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-5);
  padding: var(--ocx-space-6) var(--ocx-space-4) var(--ocx-space-7);
}

.docs-nav-group {
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-1);
}

.docs-nav-label {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: var(--ocx-font-weight-semibold);
  letter-spacing: 0.09em;
  color: var(--ocx-color-fg-subtle);
  padding: var(--ocx-space-3) var(--ocx-space-4);
}

.docs-nav-label:hover,
.docs-nav-label.active {
  color: var(--ocx-color-accent);
}

.docs-nav-item {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-base);
  color: var(--ocx-color-fg-muted);
  padding: var(--ocx-space-3) var(--ocx-space-4);
  border-radius: var(--ocx-radius-md);
}

.docs-nav-item:hover {
  color: var(--ocx-color-fg);
}

.docs-nav-item.active {
  color: var(--ocx-color-accent);
  background: color-mix(in srgb, var(--ocx-color-accent) 8%, transparent);
  font-weight: var(--ocx-font-weight-medium);
}
}
</style>
