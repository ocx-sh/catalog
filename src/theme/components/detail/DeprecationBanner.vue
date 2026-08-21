<script setup lang="ts">
// DetailPage owns the `v-if="root.status === 'deprecated'"` gate.
defineProps<{
  message: string | null
  /** Bare `<ns>/<pkg>` (never `ocx.sh/`-prefixed — schema:
   * `root.schema.json`'s `superseded_by`). */
  supersededBy: string | null
}>()
</script>

<template>
  <div class="deprecation-banner">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="deprecation-icon">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="deprecation-text">
      <strong>Deprecated</strong>
      <template v-if="supersededBy"> — superseded by <a :href="`/${supersededBy}`">{{ supersededBy }}</a>.</template>
      <template v-if="message"> {{ message }}</template>
      <template v-else> Existing versions remain installable; no new releases will be mirrored.</template>
    </span>
  </div>
</template>

<style scoped>
.deprecation-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: color-mix(in srgb, var(--c-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
  border-radius: var(--radius-lg);
  padding: 11px 14px;
}

.deprecation-icon {
  color: var(--c-accent-hover);
  flex-shrink: 0;
  margin-top: 1px;
}

.deprecation-text {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--c-text-1);
}

.deprecation-text a {
  color: var(--c-accent);
}

.deprecation-text a:hover {
  color: var(--c-accent-hover);
}
</style>
