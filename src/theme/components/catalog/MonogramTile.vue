<script setup lang="ts">
// Pure render — `hue`/`initials` are already-computed pure values (see
// `monogramHue`/`monogramInitials`), so this component has no external reads
// at all. It used to read core's `isDark` to pick a hue array in JS; the
// light/dark swap now lives in palette.css with every other token, which
// removed that dependency outright.

withDefaults(
  defineProps<{
    hue: number
    initials: string
    /** Tile edge length in px — 34 here (`PackageCard`); WP-D's
     * `IdentityBlock` (52px) is a documented second caller. */
    size?: number
  }>(),
  { size: 34 },
)
</script>

<template>
  <div
    class="monogram-tile"
    :class="`mg-${hue}`"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    {{ initials }}
  </div>
</template>

<style scoped>
@layer ocx {
.monogram-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--ocx-radius-lg);
  font-family: var(--ocx-font-mono);
  font-weight: var(--ocx-font-weight-semibold);
  font-size: var(--ocx-text-md);
}

/* Hue rotation is a class, not an inline style: an inline style is beatable
 * only by `!important`, so a mirror could never restyle a tile. */
.monogram-tile.mg-0 { background: var(--ocx-color-monogram-0-tint); color: var(--ocx-color-monogram-0); }
.monogram-tile.mg-1 { background: var(--ocx-color-monogram-1-tint); color: var(--ocx-color-monogram-1); }
.monogram-tile.mg-2 { background: var(--ocx-color-monogram-2-tint); color: var(--ocx-color-monogram-2); }
.monogram-tile.mg-3 { background: var(--ocx-color-monogram-3-tint); color: var(--ocx-color-monogram-3); }
}
</style>
