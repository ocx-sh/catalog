<script setup lang="ts">
import CatalogGrid from './CatalogGrid.vue'

// Reuses CatalogGrid's own layout so skeleton and real-card dims are
// identical by construction (design mock 1e: "skeletons, not spinners —
// no layout jump") instead of duplicating the grid CSS here.
const PLACEHOLDER_COUNT = 9
</script>

<template>
  <CatalogGrid>
    <div v-for="i in PLACEHOLDER_COUNT" :key="i" class="skeleton-card" :class="{ offbeat: i % 2 === 0 }">
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
  </CatalogGrid>
</template>

<style scoped>
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
  gap: 10px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  padding: 14px;
  animation: catalog-skeleton-pulse 1.6s ease-in-out infinite;
}

.skeleton-card.offbeat {
  animation-delay: 0.2s;
}

.skeleton-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.skeleton-tile {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-lg);
  background: var(--c-surface-2);
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skeleton-line {
  height: 11px;
  border-radius: var(--radius-sm);
  background: var(--c-surface-2);
}

.skeleton-line-sm {
  height: 9px;
}

.skeleton-install {
  height: 26px;
  border-radius: var(--radius-md);
  background: var(--c-surface-2);
}
</style>
