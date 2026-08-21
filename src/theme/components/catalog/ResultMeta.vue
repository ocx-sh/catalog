<script setup lang="ts">
defineProps<{
  total: number
  filtered: number
  /** Active FILTER CHIP labels only (platforms/keywords/deprecated). */
  activeFilterLabels: string[]
  /** Free-text query active — the clear button covers it too ("clear all
   * filters"), it just isn't echoed in the labels line. */
  hasQuery: boolean
}>()

defineEmits<{ 'clear-filters': [] }>()

// "updated Xm ago" moved to SiteFooter (owner finding: off-place here).</script>

<template>
  <div class="result-meta">
    <span class="count">{{ filtered === total ? `${total} packages` : `${filtered} of ${total} packages` }}</span>
    <!-- No placeholder text when unfiltered — the meta row's sort select
         (CatalogPage) states the order now. -->
    <span v-if="activeFilterLabels.length" class="filters">{{ activeFilterLabels.join(' · ') }}</span>
    <button v-if="activeFilterLabels.length || hasQuery" type="button" class="clear-btn" tabindex="-1" @click="$emit('clear-filters')">
      clear filters
    </button>
  </div>
</template>

<style scoped>
.result-meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.count {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--c-text-1);
}

.filters {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
}

.clear-btn {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--c-accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.clear-btn:hover,
.clear-btn:focus-visible {
  color: var(--c-accent-hover);
  outline: none;
  text-decoration: underline;
}
</style>
