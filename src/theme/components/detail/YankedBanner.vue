<script setup lang="ts">
// Whole-package `status: 'yanked'` (distinct from a PER-TAG yank, which
// `TagBadge`/`VersionTree` already surface) — C-603. DetailPage owns the
// `v-else-if="root.status === 'yanked'"` gate, mutually exclusive with
// DeprecationBanner's `deprecated` gate (a root's `status` is one of the
// two, never both). No `message`/`supersededBy` props to thread through
// like DeprecationBanner: the wire root carries no accompanying reason
// field for a whole-package yank (unlike `deprecated_message`) — see
// `usePackageRoot.ts`'s `PackageRoot.status` doc — so this banner's copy is
// fixed, not wire-sourced.
</script>

<template>
  <div class="yanked-banner">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="yanked-icon">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="yanked-text">
      <strong>Yanked</strong> — this package has been withdrawn by its maintainers. Existing installs may keep working, but it should not be newly installed.
    </span>
  </div>
</template>

<style scoped>
@layer ocx {
.yanked-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--ocx-color-warning-tint);
  border: var(--ocx-border-width) solid color-mix(in srgb, var(--ocx-color-warning) 45%, transparent);
  border-radius: var(--ocx-radius-lg);
  padding: 11px 14px;
}

.yanked-icon {
  color: var(--ocx-color-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.yanked-text {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-sm);
  line-height: 1.55;
  color: var(--ocx-color-fg);
}
}
</style>
