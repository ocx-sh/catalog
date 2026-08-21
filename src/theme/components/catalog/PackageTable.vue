<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import type { CatalogPackage } from '../../composables/useCatalog'
import { monogramHue, monogramInitials } from '../../utils/monogram'
import { OS_GLYPHS, osRank } from '../../utils/osGlyphs'
import LogoTile from './LogoTile.vue'
import CopyContextMenu, { buildTagCopyActions } from '../shared/CopyContextMenu.vue'
import { useInstallFlavors } from '../../composables/useInstallFlavors'

// Concise table view — CatalogPage's cards/table toggle picks between this
// and CatalogGrid+PackageCard. Rows are anchors (same navigation + Tab
// behavior as cards); no InstallRow, no keywords — that detail lives on
// cards and the detail page.

defineProps<{ packages: CatalogPackage[] }>()

const bare = (p: CatalogPackage) => `${p.namespace}/${p.package}`
const oses = (p: CatalogPackage) =>
  [...new Set(p.platforms.map(x => x.split('/')[0]))].sort((a, b) => osRank(a) - osRank(b))

// Right-click copy menu per row — same shared action list as the card's
// install box (InstallRow): `ocx.sh/`-prefixed name + latest version tag.
const flavors = useInstallFlavors()
const rowActions = (p: CatalogPackage) =>
  buildTagCopyActions(`ocx.sh/${bare(p)}`, p.latestVersion, flavors.value)
const { copy: copyText } = useClipboard()
</script>

<template>
  <div class="package-table">
    <CopyContextMenu v-for="pkg in packages" :key="pkg.name" :actions="rowActions(pkg)" :copy-text="copyText">
      <a :href="`/${bare(pkg)}`" class="table-row">
      <LogoTile :logo-url="pkg.logoUrl" :hue="monogramHue(bare(pkg))" :initials="monogramInitials(pkg.package)" :size="22" />
      <span class="t-name">
        <span class="t-title" :title="pkg.title">{{ pkg.title }}</span>
        <span class="t-bare" :title="bare(pkg)">{{ bare(pkg) }}</span>
        <span v-if="pkg.status === 'deprecated'" class="t-deprecated">DEPRECATED</span>
      </span>
      <span class="t-desc">{{ pkg.description }}</span>
      <span class="t-version">{{ pkg.latestVersion ?? '—' }}</span>
      <span class="t-platforms">
        <svg
          v-for="os in oses(pkg)"
          :key="os"
          width="12"
          height="12"
          :viewBox="OS_GLYPHS[os]?.viewBox ?? '0 0 24 24'"
          fill="currentColor"
          :aria-label="OS_GLYPHS[os]?.label ?? os"
        >
          <path v-for="(p, i) in OS_GLYPHS[os]?.paths" :key="i" :d="p" />
          <rect v-for="(r, i) in OS_GLYPHS[os]?.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" />
        </svg>
      </span>
        <span class="t-tags">{{ pkg.tagCount }} tags</span>
      </a>
    </CopyContextMenu>
  </div>
</template>

<style scoped>
.package-table {
  display: grid;
  /* tile | title+name | desc | version | platforms | tag count.
   * Hard cap on the name column — max-content let a long title+namespace
   * eat the description's space; past the cap both truncate instead. */
  grid-template-columns: auto minmax(140px, 260px) 1fr auto auto auto;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  gap: var(--space-3);
  padding: 8px 14px;
  color: inherit;
  transition: background-color 0.15s;
}

.table-row + .table-row {
  border-top: 1px solid var(--c-line);
}

.table-row:hover,
.table-row:focus-visible {
  background: var(--c-surface-2);
}

/* Default outline hugs the row's outer edge and gets clipped by the
 * table's overflow:hidden — leaving only a stray line below (or above, on
 * the last row). Inset keeps the full focus rectangle inside the row, and
 * the first/last rows carry the table's own corner radius so the focus
 * rectangle (and hover fill) follows the rounded container instead of
 * cutting straight across its corners. */
.table-row:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

.table-row:first-child {
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
}

.table-row:last-child {
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
}

.package-table :deep(.monogram-tile) {
  font-size: var(--text-2xs);
  border-radius: var(--radius-sm);
}

.t-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.t-title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.t-bare {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Shrinks before the title — ns/pkg is the redundant half (tooltip has it). */
  flex-shrink: 3;
}

.t-deprecated {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--c-text-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.t-desc {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.t-version,
.t-tags {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
  white-space: nowrap;
}

.t-platforms {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--c-text-3);
}

@media (max-width: 899px) {
  .package-table {
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  }

  .t-desc {
    display: none;
  }
}

@media (max-width: 639px) {
  .package-table {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .t-platforms,
  .t-tags {
    display: none;
  }
}
</style>
