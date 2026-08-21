<script setup lang="ts">
import { computed } from 'vue'
import { OS_GLYPHS, osRank } from '../../utils/osGlyphs'
import { visiblePlatforms } from '../../utils/platforms'
import type { ManifestDescriptor } from '../../composables/useImageIndex'

// Presentational only — glyph + label + arch chips from one OCI image
// index's `manifests[]`. DetailPage/MetaRail own the hover-driven fetch
// (`useImageIndex`); this component just renders whatever it's handed,
// after `visiblePlatforms` drops descriptors that aren't a real platform
// (no `platform` key, or an `unknown/unknown` attestation descriptor).
const props = defineProps<{
  platforms: ManifestDescriptor[]
}>()

const shown = computed(() => visiblePlatforms(props.platforms))

interface PlatformGroup {
  os: string
  label: string
  arches: Set<string>
}

// Fixed column order (design finding: "amd64 should be left to arm64" /
// "same position regardless of whether one is missing") — amd64 and arm64
// always lead, any other observed architecture follows alphabetically.
// `columns` below is computed once across every OS row in the *whole*
// image index (not per-row), so a row missing an arch renders an empty
// cell in that arch's column instead of its neighbors packing left to fill
// the gap — the bug: a flex row with only "arm64" present used to render
// that badge in the "amd64" slot, visually indistinguishable from an actual
// amd64 entry.
const ARCH_PRIORITY = ['amd64', 'arm64']

function archRank(arch: string): number {
  const index = ARCH_PRIORITY.indexOf(arch)
  return index === -1 ? ARCH_PRIORITY.length : index
}

const columns = computed<string[]>(() => {
  const arches = new Set(shown.value.map(p => p.platform.architecture))
  return [...arches].sort((a, b) => archRank(a) - archRank(b) || a.localeCompare(b))
})

const groups = computed<PlatformGroup[]>(() => {
  const byOs = new Map<string, Set<string>>()
  for (const entry of shown.value) {
    const os = entry.platform.os
    if (!byOs.has(os)) byOs.set(os, new Set())
    byOs.get(os)!.add(entry.platform.architecture)
  }
  return [...byOs.entries()]
    .map(([os, arches]) => ({ os, label: OS_GLYPHS[os]?.label ?? os, arches }))
    .sort((a, b) => osRank(a.os) - osRank(b.os) || a.os.localeCompare(b.os))
})
</script>

<template>
  <div v-if="groups.length" class="platform-matrix" :style="{ '--arch-cols': columns.length }">
    <div v-for="group in groups" :key="group.os" class="platform-row">
      <span class="platform-glyph">
        <svg v-if="OS_GLYPHS[group.os]" width="16" height="16" :viewBox="OS_GLYPHS[group.os].viewBox" aria-hidden="true">
          <path v-for="(d, i) in OS_GLYPHS[group.os].paths || []" :key="`p${i}`" :d="d" fill="currentColor" />
          <rect v-for="(r, i) in OS_GLYPHS[group.os].rects || []" :key="`r${i}`" :x="r.x" :y="r.y" :width="r.w" :height="r.h" fill="currentColor" />
        </svg>
      </span>
      <span class="platform-label">{{ group.label }}</span>
      <!-- One cell per arch column, always — a missing arch for this OS
           renders an empty cell rather than being omitted, so every OS
           row's badges land in the same fixed column across the card.
           These cells are direct children of the shared grid below
           (`.platform-row` is `display: contents`, see its style) rather
           than a nested grid of their own — a per-row grid would size its
           own columns from just that row's content, so an empty cell
           (nothing to size against) collapses narrower than a filled one
           and every row's columns drift out of alignment with each other,
           the exact bug this fix exists to remove. -->
      <span v-for="arch in columns" :key="arch" class="platform-arch-cell">
        <span v-if="group.arches.has(arch)" class="platform-arch">{{ arch }}</span>
      </span>
    </div>
  </div>
  <p v-else class="platform-empty">Hover a version to preview its platforms.</p>
</template>

<style scoped>
/* One shared grid for the whole card, not one grid per row — a grid's
   column tracks are sized (with `auto`) from the widest content *within
   that one grid container*. Nesting a separate grid per `.platform-row`
   would let each row size its arch columns independently, so an OS with a
   missing arch (nothing in that cell) computes a narrower column than an
   OS with every arch present — cells drift out of alignment between rows,
   defeating the fixed-column point. One grid across every row (each
   `.platform-row` participates via `display: contents` instead of being a
   layout box itself) gives every column one width, shared by all rows —
   OS glyph left-aligned, arch badges in fixed columns to its right, amd64
   before arm64, stable position whether or not a given OS has that arch. */
.platform-matrix {
  display: grid;
  /* 1fr label column absorbs the slack so the arch-badge block sits flush
     against the card's right edge; each arch track is minmax'd — a shared
     minimum keeps amd64/arm64 cells uniform, an unusually long arch name
     can still widen its own track instead of clipping. */
  grid-template-columns: 18px 1fr repeat(var(--arch-cols), minmax(3.5rem, auto));
  align-items: center;
  row-gap: 10px;
  column-gap: 10px;
}

.platform-row {
  display: contents;
}

.platform-glyph {
  color: var(--c-text-2);
  display: inline-flex;
  justify-content: center;
}

.platform-label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--c-text-1);
}

.platform-arch-cell {
  display: flex;
}

.platform-arch {
  flex: 1;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--c-text-2);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
}

.platform-empty {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--c-text-3);
  margin: 0;
}
</style>
