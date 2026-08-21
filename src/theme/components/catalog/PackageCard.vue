<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '@vueuse/core'
import type { CatalogPackage } from '../../composables/useCatalog'
import CopyContextMenu, { buildTagCopyActions } from '../shared/CopyContextMenu.vue'
import { useInstallFlavors } from '../../composables/useInstallFlavors'
import { monogramHue, monogramInitials } from '../../utils/monogram'
import { OS_GLYPHS, osRank } from '../../utils/osGlyphs'
import LogoTile from './LogoTile.vue'
import InstallRow from './InstallRow.vue'

const props = defineProps<{ pkg: CatalogPackage, keywordRank?: Map<string, number> }>()

// Cards show at most 3 keywords, the globally most common first (rank map
// from CatalogPage's frequency list) — full list lives on the detail page.
const displayKeywords = computed(() => {
  const rank = props.keywordRank
  const kws = rank
    ? [...props.pkg.keywords].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
    : props.pkg.keywords
  return kws.slice(0, 3)
})

/** Bare `<ns>/<pkg>` — the route path, the monogram hash input, and
 * `InstallRow`'s prop all use this, never `pkg.name` (which carries the
 * `ocx.sh/` prefix — same CAS-gotcha trap documented in `usePackageRoot`). */
const bareName = computed(() => `${props.pkg.namespace}/${props.pkg.package}`)

// Card-wide right-click copy menu (shared builder, like the table rows).
// InstallRow deliberately has no menu of its own any more — see its note.
const flavors = useInstallFlavors()
const menuActions = computed(() =>
  buildTagCopyActions(`ocx.sh/${bareName.value}`, props.pkg.latestVersion, flavors.value),
)
const { copy: menuCopy } = useClipboard()

const hue = computed(() => monogramHue(bareName.value))
const initials = computed(() => monogramInitials(props.pkg.package))

// Tile rendering (logo cross-fade over monogram, svg->png retry) lives in
// the shared `LogoTile`. The cube branch here is a defensive last resort
// for an empty-initials edge case (never expected in practice — `package`
// is non-empty per schema) rather than a designed "sometimes" toggle; the
// mock's own two example tile styles are visual variety in the fixture
// generator, not two independently-random UI states.

const platforms = computed(() =>
  [...new Set(props.pkg.platforms.map(p => p.split('/')[0]))].sort((a, b) => osRank(a) - osRank(b)),
)
</script>

<template>
  <CopyContextMenu :actions="menuActions" :copy-text="menuCopy">
    <a :href="`/${bareName}`" class="package-card">
    <div class="card-header">
      <LogoTile v-if="pkg.logoUrl || initials" :logo-url="pkg.logoUrl" :hue="hue" :initials="initials" />
      <div v-else class="card-tile-cube">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>
      <div class="card-title-block">
        <div class="card-title-row">
          <span class="card-title" :title="pkg.title">{{ pkg.title }}</span>
          <span v-if="pkg.latestVersion" class="card-version">{{ pkg.latestVersion }}</span>
          <span v-if="pkg.status === 'deprecated'" class="card-deprecated">DEPRECATED</span>
        </div>
        <div class="card-name">{{ bareName }}</div>
      </div>
    </div>

    <p class="card-desc">{{ pkg.description }}</p>

    <div class="card-meta">
      <span class="card-keywords">
        <span v-for="kw in displayKeywords" :key="kw" class="card-keyword">{{ kw }}</span>
      </span>
      <span class="card-platforms">
        <svg
          v-for="os in platforms"
          :key="os"
          width="13"
          height="13"
          :viewBox="OS_GLYPHS[os]?.viewBox ?? '0 0 24 24'"
          fill="currentColor"
          :aria-label="OS_GLYPHS[os]?.label ?? os"
        >
          <path v-for="(p, i) in OS_GLYPHS[os]?.paths" :key="i" :d="p" />
          <rect v-for="(r, i) in OS_GLYPHS[os]?.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" />
        </svg>
        <span class="card-tag-count">{{ pkg.tagCount }} tags</span>
      </span>
    </div>

      <InstallRow :name="bareName" />
    </a>
  </CopyContextMenu>
</template>

<style scoped>
.package-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  padding: 14px 14px 12px;
  color: inherit;
  transition: border-color 0.15s;
}

.package-card:hover,
.package-card:focus-visible {
  border-color: var(--c-accent);
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.card-tile-cube {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-lg);
  background: var(--c-surface-2);
  color: var(--c-text-3);
}

.card-title-block {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.card-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.card-title {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.3;
  color: var(--c-text-1);
  /* One line always — a wrapped title makes the header taller and the tile
   * drift off the grid's shared logo baseline. Full name via title attr. */
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-version,
.card-deprecated {
  flex-shrink: 0;
}

.card-version {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--c-text-3);
}

/* Same shape/sizing as IdentityBlock's `.identity-deprecated` badge, but
 * muted tokens instead of coral (`--c-accent-hover`) — a grid of cards is
 * not the place for the site's one interactive/highlight color (see
 * palette.css's "coral is the only interactive color" note); deprecated on
 * a card is a status fact, not a call to action. */
.card-deprecated {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--c-text-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  letter-spacing: 0.05em;
}

.card-name {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 37px;
}

.card-meta {
  display: flex;
  /* Bottom-anchor: meta row hugs the install box, and platforms/tag-count
   * sit on the row's last line even if keywords wrap. */
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: auto;
}

.card-keywords {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.card-keyword {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--c-kw);
  background: var(--c-kw-bg);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
}

.card-platforms {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--c-text-3);
  flex-shrink: 0;
}

.card-tag-count {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
</style>

<style>
/* Unscoped: `.install-row` lives inside `InstallRow.vue`'s own scoped
 * style, one component layer through `CopyContextMenu`'s slot passthrough —
 * a `scoped` selector here isn't guaranteed to reach across that boundary.
 * `:has()` gives `.package-card` here higher specificity than its own
 * `:hover` rule above (a `:has()` argument's specificity counts toward the
 * whole selector), so hovering the install box cancels the card's own
 * hover border without touching the box's unrelated hover style. */
.package-card:has(.install-row:hover) {
  border-color: var(--c-line);
}
</style>
