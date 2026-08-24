<script setup lang="ts">
import CatalogGrid from './CatalogGrid.vue'

// Reuses CatalogGrid's own layout so skeleton and real-card dims are
// identical by construction (design mock 1e: "skeletons, not spinners —
// no layout jump") instead of duplicating the grid CSS here.
const PLACEHOLDER_COUNT = 9
</script>

<template>
  <!-- C-607: `aria-hidden` on the whole grid — a screen reader has nothing
       useful to announce for placeholder boxes (no package data yet), and
       ResultMeta's `role="status"` region announces the real count once it
       arrives. Vue's attribute fallthrough puts this on CatalogGrid's own
       rendered <ul> root. -->
  <CatalogGrid aria-hidden="true">
    <li v-for="i in PLACEHOLDER_COUNT" :key="i" class="skeleton-item">
      <div class="skeleton-card" :class="{ offbeat: i % 2 === 0 }">
        <div class="skeleton-row">
          <div class="skeleton-tile" />
          <div class="skeleton-lines">
            <div class="skeleton-line" style="width: 50%" />
            <div class="skeleton-line skeleton-line-sm" style="width: 65%" />
          </div>
        </div>
        <div class="skeleton-line skeleton-line-sm" style="width: 90%" />
        <div class="skeleton-install" />
      </div>
    </li>
  </CatalogGrid>
</template>

<style scoped>
@layer ocx {
/* Same `display: contents` reasoning as CatalogPage.vue's `.catalog-grid-item`
 * — the <li> is a list-semantics wrapper only, `.skeleton-card` stays the
 * actual CSS grid item so the placeholder layout is unchanged. */
.skeleton-item {
  display: contents;
}

/* prefers-reduced-motion is already handled globally (styles/base.css
 * zeroes all animation durations under that media query) — no local
 * override needed here. */
@keyframes catalog-skeleton-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  padding: var(--ocx-space-5);
  animation: catalog-skeleton-pulse var(--ocx-duration-shimmer) ease-in-out infinite;
}

.skeleton-card.offbeat {
  animation-delay: var(--ocx-duration-moderate);
}

.skeleton-row {
  display: flex;
  gap: var(--ocx-space-3);
  align-items: center;
}

.skeleton-tile {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--ocx-radius-lg);
  background: var(--ocx-color-surface-subtle);
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-3);
}

.skeleton-line {
  height: 11px;
  border-radius: var(--ocx-radius-sm);
  background: var(--ocx-color-surface-subtle);
}

.skeleton-line-sm {
  height: 9px;
}

.skeleton-install {
  height: 26px;
  border-radius: var(--ocx-radius-md);
  background: var(--ocx-color-surface-subtle);
}
}
</style>
