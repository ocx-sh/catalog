<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '@vueuse/core'
import type { CatalogIndexInfo, CatalogPackage } from '../../composables/useCatalog'
import { elideMiddle } from '../../utils/elideMiddle'
import { monogramHue, monogramInitials } from '../../utils/monogram'
import { packageRoutePath } from '../../utils/packageRoute'
import { OS_GLYPHS, osRank } from '../../utils/osGlyphs'
import LogoTile from './LogoTile.vue'
import CopyContextMenu, { buildTagCopyActions } from '../shared/CopyContextMenu.vue'
import { useInstallFlavors } from '../../composables/useInstallFlavors'

// Concise table view — CatalogPage's cards/table toggle picks between this
// and CatalogGrid+PackageCard. Rows are anchors (same navigation + Tab
// behavior as cards); no InstallRow, no keywords — that detail lives on
// cards and the detail page.

const props = defineProps<{
  packages: CatalogPackage[]
  /** `catalog.indexes` — optional only for a catalog.json this renderer did
   * not write. Routes only. */
  indexes?: CatalogIndexInfo[]
  /** One column per OS, in canonical order — every row draws a cell for each,
   * so the icons line up down the table instead of packing left. CatalogPage
   * derives this from the WHOLE catalog, deliberately not from the filtered
   * rows: columns that appear and vanish as you filter defeat the alignment
   * they exist for. Omitted (a standalone mount) falls back to the OSes in
   * the rows actually passed. */
  osColumns?: string[]
}>()

const bare = (p: CatalogPackage) => `${p.namespace}/${p.package}`
const route = (p: CatalogPackage) => packageRoutePath(p.name, props.indexes)
/** ~230px of `--ocx-text-2xs` mono in the identifier column. */
const IDENT_BUDGET = 34
const identifier = (p: CatalogPackage) => elideMiddle(p.name, IDENT_BUDGET)

const columns = computed(
  () =>
    props.osColumns ??
    [...new Set(props.packages.flatMap(p => p.platforms.map(x => x.split('/')[0]!)))].sort(
      (a, b) => osRank(a) - osRank(b) || a.localeCompare(b),
    ),
)
// Asked once per column per row. `split` still allocates a 2-element array
// per platform, so this is cheaper than the `new Set` per cell it replaced,
// not free: measured over 1000 rows x 3 columns x 3 platforms, 0.308ms
// before, 0.163ms after. A prefix compare (`x.startsWith(os) && x[os.length]
// === '/'`) measures 0.058ms and is the remaining headroom — left alone
// because at index.ocx.sh's 125 packages the whole column is sub-millisecond
// either way.
const supports = (p: CatalogPackage, os: string) => p.platforms.some(x => x.split('/')[0] === os)

// Right-click copy menu per row — same shared action list as the card's
// install box (InstallRow): the wire-qualified name (`p.name`, already
// carrying this deployment's own brand prefix — C-601, never a hardcoded
// `ocx.sh/` re-synthesis) + latest version tag.
const flavors = useInstallFlavors()
const rowActions = (p: CatalogPackage) =>
  buildTagCopyActions(p.name, p.latestVersion, flavors.value, route(p))
const { copy: copyText } = useClipboard()
</script>

<template>
  <div class="package-table">
    <CopyContextMenu v-for="pkg in packages" :key="pkg.name" :actions="rowActions(pkg)" :copy-text="copyText">
      <a :href="route(pkg)" class="table-row">
      <LogoTile :logo-url="pkg.logoUrl" :hue="monogramHue(bare(pkg))" :initials="monogramInitials(pkg.package)" :size="22" />
      <span class="t-name">
        <span class="t-title" :title="pkg.title">{{ pkg.title }}</span>
        <span v-if="pkg.status === 'deprecated'" class="t-deprecated">DEPRECATED</span>
        <span v-else-if="pkg.status === 'yanked'" class="t-deprecated t-yanked">YANKED</span>
      </span>
      <span class="t-ident" :title="pkg.name">{{ identifier(pkg) }}</span>
      <span class="t-desc">{{ pkg.description }}</span>
      <span class="t-version">{{ pkg.latestVersion ?? '—' }}</span>
      <span class="t-platforms" :style="{ '--os-cols': columns.length }">
        <template v-for="os in columns" :key="os">
          <svg
            v-if="supports(pkg, os)"
            width="12"
            height="12"
            :viewBox="OS_GLYPHS[os]?.viewBox ?? '0 0 24 24'"
            fill="currentColor"
            :aria-label="OS_GLYPHS[os]?.label ?? os"
          >
            <path v-for="(p, i) in OS_GLYPHS[os]?.paths" :key="i" :d="p" />
            <rect v-for="(r, i) in OS_GLYPHS[os]?.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" />
          </svg>
          <!-- Unsupported: the slot still exists, so the next row's icons sit
               in the same column. Nothing to announce. -->
          <span v-else class="t-os-empty" aria-hidden="true" />
        </template>
      </span>
        <span class="t-tags">{{ pkg.tagCount }} tags</span>
      </a>
    </CopyContextMenu>
  </div>
</template>

<style scoped>
@layer ocx {
.package-table {
  display: grid;
  /* tile | title | identifier | desc | version | platforms | tag count.
   * Hard cap on the title column — max-content let a long title eat the
   * description's space; past the cap both truncate instead. The identifier
   * has its OWN track: it used to share the title cell at `flex-shrink: 3`,
   * which made it the first thing to disappear — and it is the half naming
   * which index the package came from. */
  grid-template-columns: auto minmax(120px, 220px) minmax(140px, 230px) 1fr auto auto auto;
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  overflow: hidden;
}

.table-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  gap: var(--ocx-space-3);
  padding: var(--ocx-space-3) var(--ocx-space-5);
  color: inherit;
  transition: background-color var(--ocx-duration-base);
}

.table-row + .table-row {
  border-top: var(--ocx-border-width) solid var(--ocx-color-border);
}

.table-row:hover,
.table-row:focus-visible {
  background: var(--ocx-color-surface-subtle);
}

/* Default outline hugs the row's outer edge and gets clipped by the
 * table's overflow:hidden — leaving only a stray line below (or above, on
 * the last row). Inset keeps the full focus rectangle inside the row, and
 * the first/last rows carry the table's own corner radius so the focus
 * rectangle (and hover fill) follows the rounded container instead of
 * cutting straight across its corners. */
.table-row:focus-visible {
  outline: 2px solid var(--ocx-color-accent);
  outline-offset: -2px;
}

.table-row:first-child {
  border-top-left-radius: var(--ocx-radius-lg);
  border-top-right-radius: var(--ocx-radius-lg);
}

.table-row:last-child {
  border-bottom-left-radius: var(--ocx-radius-lg);
  border-bottom-right-radius: var(--ocx-radius-lg);
}

.package-table :deep(.monogram-tile) {
  font-size: var(--ocx-text-2xs);
  border-radius: var(--ocx-radius-sm);
}

.t-name {
  display: flex;
  align-items: baseline;
  gap: var(--ocx-space-3);
  min-width: 0;
}

.t-title {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-sm);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.t-ident {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
  white-space: nowrap;
  overflow: hidden;
  /* Backstop only: `elideMiddle` has already dropped the middle segments, so
   * anything still over-long is a two-segment name with no middle to lose. */
  text-overflow: ellipsis;
  min-width: 0;
}

.t-deprecated {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg-subtle);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-sm);
  padding: var(--ocx-space-1) var(--ocx-space-3);
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

/* Whole-package yanked (C-603) — same shape as .t-deprecated, warn tokens. */
.t-yanked {
  color: var(--ocx-color-warning);
  border-color: var(--ocx-color-warning);
}

.t-desc {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.t-version,
.t-tags {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-subtle);
  white-space: nowrap;
}

/* A fixed grid, not a packed flex row: one 12px track per OS the catalog
 * publishes anywhere, so linux always sits under linux. `--os-cols` is bound
 * per instance in the template — a structural knob, not a design token, the
 * same way `PlatformMatrix.vue` binds `--arch-cols`. */
.t-platforms {
  display: grid;
  /* max(1, …): `repeat(0, 12px)` is invalid CSS and drops the whole
     declaration — reachable when a catalog's packages declare no platforms
     at all, so `--os-cols` is 0. No visible defect today (the cell is
     childless then too), but a silently-dropped value either way. */
  grid-template-columns: repeat(max(1, var(--os-cols)), 12px);
  align-items: center;
  justify-items: center;
  gap: var(--ocx-space-3);
  color: var(--ocx-color-fg-subtle);
}

.t-os-empty {
  width: 12px;
  height: 12px;
}

@media (max-width: 899px) {
  .package-table {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto auto auto;
  }

  .t-desc {
    display: none;
  }
}

/* Phone: the identifier survives alongside the title and version — it is the
 * only thing on the row naming which index the package came from, so it
 * outranks the platform icons that fold here. */
@media (max-width: 639px) {
  .package-table {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto;
  }

  .t-platforms,
  .t-tags {
    display: none;
  }
}
}
</style>
