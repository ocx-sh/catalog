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
.docs-sidebar {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 12px 28px;
}

.docs-nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs-nav-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.09em;
  color: var(--c-text-3);
  padding: 6px 12px;
}

.docs-nav-label:hover,
.docs-nav-label.active {
  color: var(--c-accent);
}

.docs-nav-item {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--c-text-2);
  padding: 6px 12px;
  border-radius: var(--radius-md);
}

.docs-nav-item:hover {
  color: var(--c-text-1);
}

.docs-nav-item.active {
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 8%, transparent);
  font-weight: 500;
}
</style>
