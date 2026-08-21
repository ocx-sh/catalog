<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { SelectRoot, SelectTrigger, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText } from 'reka-ui'
import { useCatalog } from '../../composables/useCatalog'
import { filterPackages } from '../../utils/filterPackages'
import { selectRailKeywords } from '../../utils/keywordRail'
import { isEditableTarget } from '../../utils/dom'
import SearchInput from './SearchInput.vue'
import FilterChips from './FilterChips.vue'
import ResultMeta from './ResultMeta.vue'
import CatalogGrid from './CatalogGrid.vue'
import PackageCard from './PackageCard.vue'
import PackageTable from './PackageTable.vue'
import SkeletonGrid from './SkeletonGrid.vue'
import EmptyState from './EmptyState.vue'

// Sole `useCatalog()` consumer among `catalog/**` components — every other
// catalog component is a plain props-in/events-out leaf, and this one owns
// all search/filter state. (The command palette also calls `useCatalog()`,
// lazily on first open, for its package results — see `useCatalog.ts` and
// `search/SearchModal.vue`.)
const { catalog, loading, load: loadCatalog } = useCatalog()
onMounted(() => {
  // Prefill from `/?q=` (detail-page keyword chips link here) BEFORE the
  // catalog fetch resolves — the grid's first paint is already filtered,
  // never all-packages-then-filter. onMounted runs pre-paint, so the input
  // never flashes empty either.
  const q = new URLSearchParams(window.location.search).get('q')
  if (q) query.value = q
  loadCatalog()
})

const query = ref('')

// Mirror the query into the URL with replaceState — no history entry per
// keystroke, but the CURRENT entry always carries `?q=`. Navigating to a
// detail page pushes its own entry on top, so Back lands on `/?q=…` and the
// onMounted prefill above restores the search (owner finding: Back from a
// detail page must not lose the query). Client-only by nature: the watch
// only fires on user input. `history.state` is passed through untouched —
// VitePress's router owns it.
watch(query, (q) => {
  const url = q ? `${window.location.pathname}?q=${encodeURIComponent(q)}` : window.location.pathname
  window.history.replaceState(window.history.state, '', url)
})
// Cards ↔ concise table, persisted across visits. SSR-safe: the grid/table
// only renders post-mount (after the catalog fetch), so the stored value
// never causes a hydration mismatch.
const view = useLocalStorage<'cards' | 'table'>('ocx-catalog-view', 'cards')
// Sort order — name (catalog's stable order), recently updated (last tag
// activity), newest (announce date). Persisted like the view choice.
// Direction: each key has a natural order (name A–Z, dates newest-first);
// the arrow button inverts it, and switching keys resets to natural.
const sortBy = useLocalStorage<'name' | 'updated' | 'created'>('ocx-catalog-sort', 'name')
const sortInverted = ref(false)
watch(sortBy, () => {
  sortInverted.value = false
})

const SORT_LABELS = { name: 'name', updated: 'recent', created: 'newest' } as const
const activePlatforms = ref<string[]>([])
const activeKeywords = ref<string[]>([])
const deprecatedOnly = ref(false)

const KEYWORD_CHIP_LIMIT = 8

// ponytail: no debounce — this filters over at most ~500 in-memory objects
// synchronously on every keystroke via a plain computed, well under a
// frame budget. Upgrade path if the catalog grows large enough to jank:
// @vueuse/core's `watchDebounced` on `query`, feeding a separate debounced
// ref into `filterPackages` instead of `query` directly.
const filtered = computed(() =>
  filterPackages(catalog.value.packages, {
    query: query.value,
    platforms: activePlatforms.value,
    keywords: activeKeywords.value,
    deprecatedOnly: deprecatedOnly.value,
  }),
)

// Timestamp sorts are newest-first; `updated: null` (tagless) sinks to the
// end. 'name' keeps the catalog's own package-id order untouched.
const sorted = computed(() => {
  const key = sortBy.value
  const list = key === 'name'
    ? filtered.value
    : [...filtered.value].sort((a, b) => (b[key] ?? '').localeCompare(a[key] ?? ''))
  return sortInverted.value ? [...list].reverse() : list
})

// Tab order (owner spec #44, reaffirmed 2026-08-05 — the UX-overhaul
// natural-stop pass was a regression): Tab walks search bar → first
// card/row → next → …. Every toolbar affordance (chips, clear buttons,
// sort, view toggle) and the card's own install box stays pulled out via
// `tabindex="-1"` — mouse/"/"-reachable, never a Tab stop. Arrow keys
// remain as a faster grid-shaped movement on top.
const ARROW_DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

function onGridKeydown(event: KeyboardEvent) {
  const grid = event.currentTarget as HTMLElement
  const cards = [...grid.querySelectorAll<HTMLAnchorElement>('.package-card')]
  const currentIndex = cards.indexOf(document.activeElement as HTMLAnchorElement)
  if (currentIndex === -1) return

  // Column count read straight off the resolved grid track list — cheap,
  // and always right for the auto-fill/responsive breakpoints in
  // CatalogGrid's CSS without duplicating its media queries here.
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  const delta = ARROW_DELTA[event.key] ?? (event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : undefined)
  if (delta === undefined) return

  event.preventDefault()
  const nextIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + delta))
  if (nextIndex === currentIndex) return
  cards[nextIndex]?.focus()
}

// Table view is a flat list — every arrow key moves one row (no column
// math; each row is a single focusable anchor).
function onTableKeydown(event: KeyboardEvent) {
  const rows = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLAnchorElement>('.table-row')]
  const currentIndex = rows.indexOf(document.activeElement as HTMLAnchorElement)
  if (currentIndex === -1) return
  const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    ? -1
    : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : undefined
  if (delta === undefined) return
  event.preventDefault()
  rows[Math.min(rows.length - 1, Math.max(0, currentIndex + delta))]?.focus()
}

// Keyword chips = top-N by frequency across the WHOLE catalog (not the
// filtered subset — the chip rail stays stable as filters are applied).
const keywordFrequency = computed(() => {
  const freq = new Map<string, number>()
  for (const pkg of catalog.value.packages) {
    for (const kw of pkg.keywords) {
      freq.set(kw, (freq.get(kw) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
})

// Rank lookup for PackageCard's top-3 keyword cut — same global frequency
// list, so card chips and the chip rail agree on what "common" means.
const keywordRank = computed(() => new Map(keywordFrequency.value.map((e, i) => [e.keyword, i])))

// Rail = 8 chips picked by SPLITTING POWER (greedy balanced-coverage, see
// utils/keywordRail.ts — not raw frequency, which surfaces ubiquitous and
// redundant tags), plus any ACTIVE keyword picked from the popover that
// isn't on the rail (an invisible active filter would be baffling). The
// rest live behind the searchable "+N more" popover, frequency-sorted.
const railKeywords = computed(() => selectRailKeywords(catalog.value.packages, KEYWORD_CHIP_LIMIT))

const visibleKeywords = computed(() => {
  const shown = new Set(railKeywords.value.map(k => k.keyword))
  const activeExtra = keywordFrequency.value.filter(
    k => activeKeywords.value.includes(k.keyword) && !shown.has(k.keyword),
  )
  return [...railKeywords.value, ...activeExtra]
})
const hiddenKeywordCount = computed(() => Math.max(0, keywordFrequency.value.length - visibleKeywords.value.length))

const activeFilterLabels = computed(() => [
  ...activePlatforms.value,
  ...activeKeywords.value,
  ...(deprecatedOnly.value ? ['deprecated'] : []),
])

function togglePlatform(os: string) {
  activePlatforms.value = activePlatforms.value.includes(os)
    ? activePlatforms.value.filter(p => p !== os)
    : [...activePlatforms.value, os]
}

function toggleKeyword(keyword: string) {
  activeKeywords.value = activeKeywords.value.includes(keyword)
    ? activeKeywords.value.filter(k => k !== keyword)
    : [...activeKeywords.value, keyword]
}

function clearFilters() {
  activePlatforms.value = []
  activeKeywords.value = []
  deprecatedOnly.value = false
  query.value = ''
}

// Page-scoped "/" handler — focuses the inline SearchInput. This is
// deliberately separate from WP-E's global ⌘K command palette (frozen
// cross-WP decision, plan_site_redesign.md Status block): no import from
// or dependency on any `search/`/`useCommandPalette` module here (`utils/
// dom.ts` is a neutral leaf, not scoped under either, so importing it
// doesn't break that rule).
const searchInputRef = ref<InstanceType<typeof SearchInput> | null>(null)

function onKeydown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return
  if (event.key === '/') {
    event.preventDefault()
    searchInputRef.value?.focus()
    return
  }
  // Escape drops whatever card/row/control focus is active (owner finding).
  // The search input never reaches here (editable target) — it keeps its
  // own two-stage clear-then-blur Escape.
  if (event.key === 'Escape') {
    (document.activeElement as HTMLElement | null)?.blur()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <main class="catalog-page">
    <template v-if="loading">
      <div class="toolbar-skeleton" />
      <SkeletonGrid />
    </template>

    <EmptyState v-else-if="catalog.packages.length === 0" variant="no-data" />

    <template v-else>
      <div class="catalog-toolbar">
        <SearchInput ref="searchInputRef" v-model="query" />
        <FilterChips
          :active-platforms="activePlatforms"
          :visible-keywords="visibleKeywords"
          :all-keywords="keywordFrequency"
          :active-keywords="activeKeywords"
          :hidden-keyword-count="hiddenKeywordCount"
          :deprecated-active="deprecatedOnly"
          @toggle-platform="togglePlatform"
          @toggle-keyword="toggleKeyword"
          @toggle-deprecated="deprecatedOnly = !deprecatedOnly"
        />
        <div class="meta-row">
          <ResultMeta
            class="meta-grow"
            :total="catalog.packages.length"
            :filtered="filtered.length"
            :active-filter-labels="activeFilterLabels"
            :has-query="query.length > 0"
            @clear-filters="clearFilters"
          />
          <SelectRoot v-model="sortBy">
            <SelectTrigger class="sort-trigger" aria-label="Sort by" tabindex="-1">
              <!-- Direction toggle lives INSIDE the box (owner spec, grimoire-
                   index style): stop pointerdown/click so toggling never opens
                   the select. Icon = narrow→wide bars for natural, wide→narrow
                   for inverted. -->
              <span
                class="sort-dir-icon"
                role="button"
                :title="sortInverted ? 'natural order' : 'invert order'"
                :aria-pressed="sortInverted"
                @pointerdown.stop.prevent
                @click.stop.prevent="sortInverted = !sortInverted"
              >
                <svg v-if="sortInverted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /><path d="M11 12h4" /><path d="M11 16h7" /><path d="M11 20h10" /></svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h4" /><path d="M11 8h7" /><path d="M11 12h10" /></svg>
              </span>
              <span class="sort-label">{{ SORT_LABELS[sortBy] }}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent class="sort-dropdown" position="popper" :side-offset="6" align="end">
                <SelectViewport>
                  <SelectItem v-for="(label, key) in SORT_LABELS" :key="key" :value="key" class="sort-item">
                    <SelectItemText>{{ label }}</SelectItemText>
                  </SelectItem>
                </SelectViewport>
              </SelectContent>
            </SelectPortal>
          </SelectRoot>
          <span class="view-toggle" role="group" aria-label="Catalog view">
            <button type="button" title="Card view" tabindex="-1" :class="{ active: view === 'cards' }" @click="view = 'cards'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
            </button>
            <button type="button" title="Table view" tabindex="-1" :class="{ active: view === 'table' }" @click="view = 'table'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
          </span>
        </div>
      </div>

      <EmptyState
        v-if="filtered.length === 0"
        variant="no-match"
        :query="query"
        :total="catalog.packages.length"
        @clear-search="query = ''"
      />
      <CatalogGrid v-else-if="view === 'cards'" @keydown="onGridKeydown">
        <PackageCard
          v-for="pkg in sorted"
          :key="pkg.name"
          :pkg="pkg"
          :keyword-rank="keywordRank"
        />
      </CatalogGrid>
      <PackageTable v-else :packages="sorted" @keydown="onTableKeydown" />
    </template>
  </main>
</template>

<style scoped>
.catalog-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-5) var(--space-6) var(--space-8);
}

.catalog-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toolbar-skeleton {
  height: 44px;
  background: var(--c-surface);
  border: 1.5px solid var(--c-line);
  border-radius: var(--radius-lg);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  /* Optical inset — flush-left plain text next to a column of rounded
   * boxes reads as misaligned. */
  padding-left: 4px;
  /* Mobile: sort + view toggle drop to their own line instead of
   * squeezing the count. */
  flex-wrap: wrap;
}

@media (max-width: 639px) {
  .catalog-page {
    padding: var(--space-4) var(--space-4) var(--space-6);
  }
}

.meta-grow {
  flex: 1;
  min-width: 0;
}

/* One shared control height — trigger and view toggle line up exactly. */
.sort-trigger,
.view-toggle {
  height: 28px;
  box-sizing: border-box;
}

.sort-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  /* Fixed width sized for the WIDEST label ("recent"/"newest") — the box
   * must never resize with the selection. */
  width: 118px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  color: var(--c-text-2);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-md);
  padding: 0 9px 0 0;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  /* Reka refocuses the trigger after selection — the UA focus ring then
   * stacks with the hover border ("double bar"). The trigger is already
   * pulled out of the Tab order (site convention: only cards are Tab
   * stops), so the ring carries no keyboard-nav signal here; hover border
   * is the one cue. */
  outline: none;
}

.sort-label {
  flex: 1;
  text-align: left;
  margin-left: 4px;
}

.sort-trigger:hover,
.sort-trigger:focus-visible {
  color: var(--c-text-1);
  border-color: var(--c-accent);
}

.sort-trigger svg {
  color: var(--c-text-3);
}

/* In-box direction toggle — full-height hit area with its own divider so
 * it reads as a distinct clickable segment. */
.sort-dir-icon {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  padding: 0 8px;
  border-right: 1px solid var(--c-line);
  cursor: pointer;
}

.sort-dir-icon:hover svg {
  color: var(--c-accent);
}

/* Joined two-button segment — same pattern as MetaRail's install toggle. */
.view-toggle {
  display: inline-flex;
  border: 1px solid var(--c-line);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.view-toggle button {
  display: flex;
  align-items: center;
  height: 100%;
  color: var(--c-text-3);
  background: none;
  border: none;
  padding: 0 9px;
  cursor: pointer;
}

.view-toggle button + button {
  border-left: 1px solid var(--c-line);
}

.view-toggle button:hover,
.view-toggle button:focus-visible {
  color: var(--c-text-1);
  outline: none;
}

.view-toggle button.active {
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 8%, transparent);
}
</style>

<style>
/* Unscoped — SelectContent portals to <body> (same reasoning as
 * .copy-ctx-menu / .kw-popover). Popper-positioned with a 6px offset so
 * the dropdown floats clear of the trigger instead of overlapping it. */
.sort-dropdown {
  min-width: 160px;
  padding: 0.35rem;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  z-index: 100;
  animation: copy-ctx-fade-in 0.12s ease-out;
}

.sort-item {
  display: flex;
  align-items: center;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-2);
  cursor: pointer;
  outline: none;
  transition: background 0.1s, color 0.1s;
}

.sort-item:hover,
.sort-item[data-highlighted] {
  background: var(--c-surface-2);
  color: var(--c-accent);
}

.sort-item[data-state='checked'] {
  color: var(--c-accent);
}
</style>
