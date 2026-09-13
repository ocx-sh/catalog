<script setup lang="ts">
defineProps<{
  total: number
  filtered: number
  /** Active FILTER CHIP labels only (platforms/keywords/deprecated). Not
   * rendered — the rail's lit chips already say it — only consulted for
   * whether there is anything to clear. */
  activeFilterLabels: string[]
  /** Free-text query active — the clear button covers it too ("clear all
   * filters"), it just isn't echoed in the labels line. */
  hasQuery: boolean
}>()

defineEmits<{ 'clear-filters': [] }>()

// "updated Xm ago" moved to SiteFooter (owner finding: off-place here).</script>

<template>
  <div class="result-meta">
    <!-- C-607: role="status" + aria-atomic on the COUNT ONLY — announces
         "N of M packages" as filters change, never the result list itself
         (that would spam a screen reader on every keystroke/toggle). -->
    <span class="count" role="status" aria-atomic="true">{{ filtered === total ? `${total} packages` : `${filtered} of ${total} packages` }}</span>
    <!-- No echo of the active filters here: each one is already a lit chip
         in the rail directly above, so a second line naming them read as a
         repeat. The labels still arrive as a prop because they decide whether
         the clear button shows, and EmptyState names them when the result is
         empty — the one place the reader cannot see which chips did it. -->
    <button v-if="activeFilterLabels.length || hasQuery" type="button" class="clear-btn" @click="$emit('clear-filters')">
      clear filters
    </button>
  </div>
</template>

<style scoped>
@layer ocx {
.result-meta {
  display: flex;
  align-items: baseline;
  gap: var(--ocx-space-3);
  flex-wrap: wrap;
}

.count {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg);
}

.clear-btn {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.clear-btn:hover,
.clear-btn:focus-visible {
  color: var(--ocx-color-accent-hover);
  outline: none;
  text-decoration: underline;
}
}
</style>
