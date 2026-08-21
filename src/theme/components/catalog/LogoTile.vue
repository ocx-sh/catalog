<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useImageFallback } from '../../composables/useImageFallback'
import MonogramTile from './MonogramTile.vue'

// Shared logo tile for PackageCard (34px) and PackageTable rows (22px),
// grimoire-index's async tile pattern: the monogram paints instantly with
// the grid, the logo <img> lazy-loads on top at opacity 0 and cross-fades
// in on @load — the catalog never waits on (or pops in with) logo bytes.
// Errors walk the svg→png candidate chain (`useImageFallback`); exhausted
// candidates just leave the monogram standing, same look as no logo at
// all. Fixed box = zero layout shift. Unlike grimoire's island the grid
// mounts client-side AFTER the catalog fetch, so no image can settle
// before Vue's listeners attach — plain @load/@error is race-free here.

const props = defineProps<{
  logoUrl: string | null
  hue: number
  initials: string
  /** Tile edge length in px — see MonogramTile's size note. */
  size?: number
}>()

const candidates = computed<(string | null)[]>(() => {
  const url = props.logoUrl
  if (!url) return []
  return url.endsWith('.svg') ? [url, url.replace(/\.svg$/, '.png')] : [url]
})
const { src, onError } = useImageFallback(candidates)

const loaded = ref(false)
watch(src, () => { loaded.value = false })
</script>

<template>
  <span
    class="logo-tile"
    :data-state="src && loaded ? 'ready' : 'loading'"
    :style="{ width: `${size ?? 34}px`, height: `${size ?? 34}px` }"
  >
    <MonogramTile v-if="initials" class="tile-under" :hue="hue" :initials="initials" :size="size ?? 34" />
    <img
      v-if="src"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      @load="loaded = true"
      @error="onError"
    >
  </span>
</template>

<style scoped>
.logo-tile {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.logo-tile img,
.logo-tile .tile-under {
  transition: opacity 0.2s ease;
}

/* Bare logo — no box, background, or radius (owner finding); the monogram
 * fallback keeps its tile look, it IS a box by design. */
.logo-tile img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
}

.logo-tile[data-state='ready'] img {
  opacity: 1;
}

.logo-tile[data-state='ready'] .tile-under {
  opacity: 0;
}
</style>
