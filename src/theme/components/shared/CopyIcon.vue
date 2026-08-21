<script setup lang="ts">
// The clipboard-icon/check-icon pair every copy affordance in the theme
// renders (`InstallRow`, `IdentityBlock`, `MetaRail`, `TagBadge`) — same
// two SVG paths, previously pasted at each call site. `size`/`checkClass`
// cover the per-site variance (icon size, an extra class only the
// check-state SVG carries for a CSS-driven fade/position hook); plain
// `class` on the component itself falls through to whichever branch
// renders, same as any other single-root component.
withDefaults(defineProps<{
  copied: boolean
  size?: number
  checkClass?: string
}>(), {
  size: 13,
})
</script>

<template>
  <svg v-if="!copied" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
  <svg v-else :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" :class="checkClass">
    <polyline points="20 6 9 17 4 12" />
  </svg>
</template>
