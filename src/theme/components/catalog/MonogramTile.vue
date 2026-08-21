<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { MONOGRAM_HUES } from '../../utils/monogram'

// Pure render of `utils/monogram.ts`'s hue arrays — `hue`/`initials` are
// already-computed pure values (see `monogramHue`/`monogramInitials`), so
// this component itself is SSR-safe: its only external read is core's
// `isDark`, the same established pattern as `ThemeToggle.vue`.

const props = withDefaults(
  defineProps<{
    hue: number
    initials: string
    /** Tile edge length in px — 34 here (`PackageCard`); WP-D's
     * `IdentityBlock` (52px) is a documented second caller. */
    size?: number
  }>(),
  { size: 34 },
)

const { isDark } = useData()

const palette = computed(() => (isDark.value ? MONOGRAM_HUES.dark : MONOGRAM_HUES.light))
const textColor = computed(() => palette.value.text[props.hue])
const bgColor = computed(() => palette.value.bg[props.hue])
</script>

<template>
  <div
    class="monogram-tile"
    :style="{ width: `${size}px`, height: `${size}px`, color: textColor, background: bgColor }"
  >
    {{ initials }}
  </div>
</template>

<style scoped>
.monogram-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--radius-lg);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: var(--text-md);
}
</style>
