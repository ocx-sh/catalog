<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useData } from 'vitepress'
import { useLocalStorage } from '@vueuse/core'
import { SelectRoot, SelectTrigger, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText } from 'reka-ui'
import { useCatalog } from '../../composables/useCatalog'
import { filterPackages } from '../../utils/filterPackages'
import { selectRailKeywords } from '../../utils/keywordRail'
import { isEditableTarget } from '../../utils/dom'
import { osRank } from '../../utils/osGlyphs'
import SearchInput from './SearchInput.vue'
import FilterChips from './FilterChips.vue'
import IndexTabs from './IndexTabs.vue'
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
const { catalog, loading, error, load: loadCatalog } = useCatalog()

// C-607: the landing page had ZERO headings — an axe/Lighthouse a11y
// failure (every page needs exactly one `<h1>`). Visually hidden is fine
// here: the wordmark in SiteHeader already carries the visible brand
// identity, this is purely a document-outline/screen-reader landmark.
const { theme } = useData()
const brandTitle = computed(() => (theme.value.brand?.title ?? '') as string)
onMounted(() => {
  // Prefill from `/?q=` (detail-page keyword chips link here) and `/?index=`
  // BEFORE the catalog fetch resolves — the grid's first paint is already
  // filtered and already scoped, never all-packages-then-filter. onMounted
  // runs pre-paint, so the input never flashes empty either.
  const params = new URLSearchParams(window.location.search)
  const q = params.get('q')
  if (q) query.value = q
  // Three states, and they are all distinct: absent (`null`) is "no scope
  // chosen yet", an empty value is "all indexes", anything else names one.
  urlIndex = params.get('index')
  // Settles immediately when the catalog is already cached; a no-op on a
  // cold load, where the `indexes` watch takes over once the fetch lands.
  resolveScope()
  loadCatalog()
})

const query = ref('')

// Index scope. `null` is "all". Read off `?index=` at mount, before the
// catalog resolves, so the first paint is already scoped; once the catalog
// arrives, an absent param settles on the index the envelope marks `default`
// — and only falls back to "all" when a config named neither a `default: true`
// source nor a `root: true` one, in which case no index is more default than
// another. `default` is NOT `root`: a catalog with no root source (every
// route qualified, nothing at the site root) can still name where to land.
//
// A scope is a place, not a filter: it stays out of `activeFilterLabels` and
// `clearFilters` below, and an unknown `?index=` value is ignored rather than
// showing an empty grid for an index this deployment does not have.
/** How "all indexes" is spelled in the URL: an EMPTY value, not an absent
 * param. Absent has to keep meaning "no scope chosen yet" — that is what a
 * first visit looks like, and what resolves to the default index — so if
 * "all" were also absent, a shared link to the all view would silently
 * reopen scoped to the default. An empty string can never collide with a
 * real index either: a label is `^[A-Za-z0-9._-]+$`, so it is never empty. */
const ALL_INDEXES = ''
let urlIndex: string | null = null
const activeIndex = ref<string | null>(null)
const indexes = computed(() => catalog.value.indexes)
/**
 * Is there a scope to CHOOSE? One question, one place — the tab row and the
 * `?index=` mirror both ask it and must never disagree.
 *
 * Presence of `indexes` is NOT that question. The envelope now ships for
 * every catalog, one source included, because the route rule needs it
 * (`utils/packageRoute.ts`); a one-entry envelope means there is exactly one
 * place to be, so there is no tab row to render and no scope to spell in the
 * URL. Keying either off `indexes !== undefined` would put `?index=ocx.sh`
 * on every single-source deployment's address bar.
 */
const hasScope = computed(() => (indexes.value?.length ?? 0) > 1)

/**
 * Settles the scope against whatever the URL asked for and whatever indexes
 * the catalog turned out to have. Idempotent, and called from BOTH places
 * either input can arrive:
 *
 * - `onMounted`, once `urlIndex` has been read; and
 * - the `indexes` watch, once a cold fetch resolves.
 *
 * Both are load-bearing. `useCatalog` caches the catalog at module level, so
 * on any return visit — Back from a package page, or any client-side
 * navigation to the catalog — `catalog.value` is already populated when this
 * component sets up, and `indexes` therefore never CHANGES. A watch alone
 * would never run, the URL would be read and then ignored, and the grid
 * would silently open on "all" while the address bar said otherwise.
 */
function resolveScope() {
  const list = indexes.value
  if (list === undefined) return
  if (urlIndex === ALL_INDEXES) {
    activeIndex.value = null
    return
  }
  if (urlIndex !== null && list.some(entry => entry.name === urlIndex)) {
    activeIndex.value = urlIndex
    return
  }
  activeIndex.value = list.find(entry => entry.default)?.name ?? null
}

watch(indexes, resolveScope)

// Mirror the query AND the index scope into the URL with replaceState — no
// history entry per keystroke or per tab click, but the CURRENT entry always
// carries them. Navigating to a detail page pushes its own entry on top, so
// Back lands on `/?index=…&q=…` and the onMounted prefill above restores both
// (owner finding: Back from a detail page must not lose the query — and the
// same must hold for which index you were browsing). The scope is therefore
// linkable without any copy affordance of its own: it is in the address bar,
// which is where a URL belongs.
//
// Both params are written from ONE URLSearchParams. Rebuilding the string
// from `q` alone — as this did while `q` was the only mirrored state — would
// silently drop `index` on the next keystroke.
//
// `indexes` is a watch SOURCE too, not just something `hasScope`/`resolveScope`
// read — on a cold load with a `?q=` already in the URL, `query.value` is set
// (and this watch fires) in `onMounted`, BEFORE the catalog fetch resolves, so
// `indexes` is still undefined and `hasScope` is false: the URL got rewritten
// to just `?q=…`, silently dropping an `index=` (including the explicit empty
// value that means "all"). `resolveScope` then settles `activeIndex`, which
// started `null`, so an "all" scope produces no VALUE change and this watch
// never fires again — the param stayed lost. Including `indexes` here makes
// the undefined→defined transition itself trigger one more write, with the
// scope now settled.
// Client-only by nature: the watch only fires on user input. `history.state`
// is passed through untouched — VitePress's router owns it.
watch([query, activeIndex, indexes], ([q, index]) => {
  const params = new URLSearchParams()
  // Written for every aggregating catalog, including the default index and
  // including "all", so the address bar always says exactly what is on
  // screen — it is the only thing anyone can copy. A catalog with one index
  // has no scope to state, so it gets no param at all (`hasScope`).
  if (hasScope.value) params.set('index', index ?? ALL_INDEXES)
  if (q) params.set('q', q)
  const search = params.toString()
  window.history.replaceState(window.history.state, '', search ? `${window.location.pathname}?${search}` : window.location.pathname)
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
const yankedOnly = ref(false)

const KEYWORD_CHIP_LIMIT = 8

// ponytail: no debounce. The keystroke chain is `filtered` -> `railKeywords`
// (which rescores over the SURVIVORS now, so unlike before it is per-keystroke
// work, not once per session) -> `sorted` -> the grid patch, plus the chip
// TransitionGroup's FLIP, which reads `getBoundingClientRect` per chip and
// then forces a whole-document layout.
//
// Measured, not assumed: ~7.7ms of computed work at 5000 packages on a fast
// desktop, ~1.5ms at 1000, and index.ocx.sh publishes 125 today (its own
// /c/index.json). So this is roughly two orders of magnitude inside a frame
// at the real corpus size, and the ceiling is around 5000 on a mid-range
// laptop once the forced layout is counted.
//
// Upgrade path when that ceiling is approached: @vueuse/core's
// `watchDebounced` on `query`, feeding a separate debounced ref into
// `filterPackages` instead of `query` directly — chip and tab clicks stay
// immediate, only typing settles once per pause. Memoising the rail alone
// does not help; the forced layout is the larger half.
const filtered = computed(() =>
  filterPackages(catalog.value.packages, {
    query: query.value,
    platforms: activePlatforms.value,
    keywords: activeKeywords.value,
    deprecatedOnly: deprecatedOnly.value,
    yankedOnly: yankedOnly.value,
    index: activeIndex.value ?? undefined,
  }),
)

// The PLACE's total, not the whole aggregated catalog's — `ResultMeta`'s "N
// of M" reads as an unexplained narrowing on an aggregating catalog's first
// paint otherwise, since the index scope is deliberately excluded from
// `activeFilterLabels` (a place you're in, not a filter chip) and so never
// shows up in the filters line that would normally explain the gap.
const scopedTotal = computed(() =>
  filterPackages(catalog.value.packages, { index: activeIndex.value ?? undefined }).length,
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

// C-330 (owner-override, ADR Decision 3, supersedes owner spec #44 for
// interactive toolbar controls): every toolbar affordance (chips, clear
// buttons, sort, view toggle) is now a real Tab stop again — spec #44's
// blanket `tabindex="-1"` made platform/keyword filtering, sort, and view
// switching mouse-only, a WCAG 2.1.1 (A) failure the Lighthouse a11y gate
// cannot pass with in place. Reversibility: two-way, recorded in the ADR;
// the owner can reinstate it. Arrow keys remain as a faster grid-shaped
// movement ACROSS cards once focus is already inside the grid/table — they
// never replace Tab reaching the toolbar first.
const ARROW_DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

// Issue #5: Tab out of the search field goes to the results, not into the
// toolbar. Everything between the two — chips, clear, sort, view toggle —
// sits after the field in the DOM, so plain Tab used to walk all of it
// before reaching a single package.
//
// Accepted trade-off, recorded rather than glossed: the toolbar controls
// stay real Tab stops (C-330 above is unchanged, and no `tabindex` is added
// anywhere), but forward Tab now skips past them. They remain reachable by
// Shift+Tab back out of the grid. Reordering the DOM instead would have
// made focus order disagree with visual order, which is the worse defect.
function onSearchNext(event: KeyboardEvent) {
  const first = document.querySelector<HTMLElement>('.package-card, .table-row')
  // Nothing to jump to (empty grid, error state): leave Tab alone entirely
  // rather than trapping focus in the field.
  if (!first) return
  event.preventDefault()
  first.focus()
}

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

// Platform columns for the table view: every OS published anywhere in the
// catalog, canonical order first and alphabetical among unknowns. Whole
// catalog, never `filtered` — a column that appears and vanishes as filters
// change defeats the alignment it exists to give. (The keyword rail below
// makes the OPPOSITE call, deliberately: a column is a fixed slot the eye
// tracks down the table, a chip is a suggestion for the next cut.)
const osColumns = computed(() => {
  const seen = new Set<string>()
  for (const pkg of catalog.value.packages) {
    for (const platform of pkg.platforms) seen.add(platform.split('/')[0]!)
  }
  return [...seen].sort((a, b) => osRank(a) - osRank(b) || a.localeCompare(b))
})

// Whole-catalog keyword frequency. Feeds the "+N more" popover (which
// stays a complete vocabulary — you can always reach a keyword that the
// current result set no longer offers) and PackageCard's rank cut. The RAIL
// no longer reads it; see `railKeywords`.
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

// The "+N more" popover keeps the WHOLE-CATALOG list (it is deliberately the
// complete vocabulary — the one way back to a keyword the rail's own
// rescoring dropped) but its per-entry COUNT is scored against `filtered`,
// same as the rail: under AND semantics a keyword no surviving package
// carries is a guaranteed "no matches" click, so its badge has to read 0
// rather than advertise a whole-catalog count that lands on an empty grid.
const filteredKeywordCounts = computed(() => {
  const freq = new Map<string, number>()
  for (const pkg of filtered.value) {
    for (const kw of pkg.keywords) freq.set(kw, (freq.get(kw) ?? 0) + 1)
  }
  return freq
})
const popoverKeywords = computed(() =>
  keywordFrequency.value.map(({ keyword }) => ({ keyword, count: filteredKeywordCounts.value.get(keyword) ?? 0 })),
)

// Active keywords are PINNED, first and in click order, and never scored:
// a filter you can no longer see is a filter you cannot lift. Their count is
// `filtered.length` by construction — AND semantics mean every remaining
// package carries every active keyword.
const pinnedKeywords = computed(() =>
  activeKeywords.value.map(keyword => ({ keyword, count: filtered.value.length })),
)

// Rail = chips picked by SPLITTING POWER (greedy balanced-coverage, see
// utils/keywordRail.ts — not raw frequency, which surfaces ubiquitous and
// redundant tags), over the CURRENT RESULT SET rather than the whole
// catalog (owner decision). A rail scored against everything keeps offering
// keywords that no remaining package carries, so every one of those chips
// is a click straight to "no matches" — under AND semantics that is most of
// them. Scoring the survivors instead makes each chip a real further cut.
//
// The trade-off, accepted: the rail's contents move as you filter. That is
// what the chip TransitionGroup in FilterChips.vue animates — the set
// changing invisibly is what would read as broken.
const railKeywords = computed(() => {
  const slots = KEYWORD_CHIP_LIMIT - pinnedKeywords.value.length
  if (slots <= 0) return []
  // Over-request, then drop the actives: `selectRailKeywords` scores them
  // like any other keyword and would otherwise spend rail slots on chips
  // `pinnedKeywords` already renders.
  return selectRailKeywords(filtered.value, KEYWORD_CHIP_LIMIT)
    .filter(k => !activeKeywords.value.includes(k.keyword))
    .slice(0, slots)
})

const visibleKeywords = computed(() => [...pinnedKeywords.value, ...railKeywords.value])
const hiddenKeywordCount = computed(() => Math.max(0, keywordFrequency.value.length - visibleKeywords.value.length))

const activeFilterLabels = computed(() => [
  ...activePlatforms.value,
  ...activeKeywords.value,
  ...(deprecatedOnly.value ? ['deprecated'] : []),
  ...(yankedOnly.value ? ['yanked'] : []),
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
  yankedOnly.value = false
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
  <main id="main-content" class="catalog-page">
    <h1 class="visually-hidden">{{ brandTitle }}</h1>
    <template v-if="loading">
      <div class="toolbar-skeleton" />
      <SkeletonGrid />
    </template>

    <EmptyState v-else-if="error" variant="error" :error-message="error" @retry="loadCatalog" />

    <EmptyState v-else-if="catalog.packages.length === 0" variant="no-data" />

    <template v-else>
      <!-- Only an aggregating catalog has a scope to pick — see `hasScope`.
           A deployment with one index renders no row rather than a one-tab
           decoration. -->
      <IndexTabs
        v-if="hasScope"
        :indexes="indexes"
        :active="activeIndex"
        :total="catalog.packages.length"
        @select="activeIndex = $event"
      />
      <div class="catalog-toolbar">
        <SearchInput ref="searchInputRef" v-model="query" @next="onSearchNext" />
        <FilterChips
          :active-platforms="activePlatforms"
          :visible-keywords="visibleKeywords"
          :all-keywords="popoverKeywords"
          :active-keywords="activeKeywords"
          :hidden-keyword-count="hiddenKeywordCount"
          :deprecated-active="deprecatedOnly"
          :yanked-active="yankedOnly"
          @toggle-platform="togglePlatform"
          @toggle-keyword="toggleKeyword"
          @toggle-deprecated="deprecatedOnly = !deprecatedOnly"
          @toggle-yanked="yankedOnly = !yankedOnly"
        />
        <div class="meta-row">
          <ResultMeta
            class="meta-grow"
            :total="scopedTotal"
            :filtered="filtered.length"
            :active-filter-labels="activeFilterLabels"
            :has-query="query.length > 0"
            @clear-filters="clearFilters"
          />
          <span class="sort-control">
            <!-- C-607: pulled OUT of SelectTrigger as its own real <button> —
                 a `role="button"` span nested inside SelectTrigger (itself an
                 interactive control) is invalid ARIA (nested interactive),
                 which axe's nested-interactive rule flags. Icon = narrow→wide
                 bars for natural, wide→narrow for inverted. -->
            <button
              type="button"
              class="sort-dir-btn"
              :title="sortInverted ? 'natural order' : 'invert order'"
              :aria-pressed="sortInverted"
              @click="sortInverted = !sortInverted"
            >
              <svg v-if="sortInverted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /><path d="M11 12h4" /><path d="M11 16h7" /><path d="M11 20h10" /></svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h4" /><path d="M11 8h7" /><path d="M11 12h10" /></svg>
            </button>
            <SelectRoot v-model="sortBy">
              <SelectTrigger class="sort-trigger" aria-label="Sort by">
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
          </span>
          <span class="view-toggle" role="group" aria-label="Catalog view">
            <button type="button" title="Card view" :class="{ active: view === 'cards' }" @click="view = 'cards'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
            </button>
            <button type="button" title="Table view" :class="{ active: view === 'table' }" @click="view = 'table'">
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
        :active-filter-labels="activeFilterLabels"
        @clear-search="query = ''"
        @clear-filters="clearFilters"
      />
      <CatalogGrid v-else-if="view === 'cards'" @keydown="onGridKeydown">
        <li v-for="pkg in sorted" :key="pkg.name" class="catalog-grid-item">
          <PackageCard
            :pkg="pkg"
            :keyword-rank="keywordRank"
            :indexes="indexes"
          />
        </li>
      </CatalogGrid>
      <PackageTable v-else :packages="sorted" :indexes="indexes" :os-columns="osColumns" @keydown="onTableKeydown" />
    </template>
  </main>
</template>

<style scoped>
@layer ocx {
.catalog-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: var(--ocx-space-5) var(--ocx-space-6) var(--ocx-space-8);
}

.catalog-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
}

/* C-607: the landing page's one required <h1> — visually hidden, not
 * removed from the accessibility tree (unlike `display: none`). Same
 * clip-based technique as SearchModal's own `.visually-hidden`. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: calc(-1 * var(--ocx-border-width));
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* C-607: CatalogGrid is now a real <ul> (list semantics) and each card sits
 * in its own <li> — `display: contents` drops the <li> from the box tree so
 * the CARD (not the <li>) is still the actual CSS grid item, unchanged
 * layout from before the list-semantics fix. */
.catalog-grid-item {
  display: contents;
}

.toolbar-skeleton {
  height: 44px;
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width-emphasis) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: var(--ocx-space-3);
  /* Optical inset — flush-left plain text next to a column of rounded
   * boxes reads as misaligned. */
  padding-left: var(--ocx-space-2);
  /* Mobile: sort + view toggle drop to their own line instead of
   * squeezing the count. */
  flex-wrap: wrap;
}

@media (max-width: 639px) {
  .catalog-page {
    padding: var(--ocx-space-4) var(--ocx-space-4) var(--ocx-space-6);
  }
}

.meta-grow {
  flex: 1;
  min-width: 0;
}

/* One shared control height — the sort box and view toggle line up exactly. */
.sort-control,
.view-toggle {
  height: 28px;
  box-sizing: border-box;
}

/* C-607: the direction button and SelectTrigger used to be one nested
 * interactive pair (axe nested-interactive violation) inside a single
 * bordered box. They're now two real, independently-focusable siblings —
 * this wrapper is that same bordered box, so the "one control" look is
 * unchanged; :has() below re-creates the old whole-box hover/focus border
 * (same pattern PackageCard.vue uses for its install-row hover). */
.sort-control {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  /* Fixed width sized for the WIDEST label ("recent"/"newest") — the box
   * must never resize with the selection. */
  width: 118px;
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  overflow: hidden;
  transition: border-color var(--ocx-duration-base);
}

.sort-control:has(.sort-trigger:hover),
.sort-control:has(.sort-trigger:focus-visible) {
  border-color: var(--ocx-color-accent);
}

.sort-dir-btn {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--ocx-space-3);
  color: var(--ocx-color-fg-subtle);
  background: none;
  border: none;
  border-right: var(--ocx-border-width) solid var(--ocx-color-border);
  cursor: pointer;
  outline: none;
}

.sort-dir-btn:hover svg,
.sort-dir-btn:focus-visible svg {
  color: var(--ocx-color-accent);
}

.sort-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-3);
  flex: 1;
  min-width: 0;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  line-height: 1;
  color: var(--ocx-color-fg-muted);
  background: none;
  border: none;
  padding: 0 var(--ocx-space-3);
  cursor: pointer;
  transition: color var(--ocx-duration-base);
  outline: none;
}

.sort-label {
  flex: 1;
  text-align: left;
}

.sort-trigger:hover,
.sort-trigger:focus-visible {
  color: var(--ocx-color-fg);
}

.sort-trigger svg {
  color: var(--ocx-color-fg-subtle);
}

/* Joined two-button segment — same pattern as MetaRail's install toggle. */
.view-toggle {
  display: inline-flex;
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.view-toggle button {
  display: flex;
  align-items: center;
  height: 100%;
  color: var(--ocx-color-fg-subtle);
  background: none;
  border: none;
  padding: 0 var(--ocx-space-3);
  cursor: pointer;
}

.view-toggle button + button {
  border-left: var(--ocx-border-width) solid var(--ocx-color-border);
}

.view-toggle button:hover,
.view-toggle button:focus-visible {
  color: var(--ocx-color-fg);
  outline: none;
}

.view-toggle button.active {
  color: var(--ocx-color-accent);
  background: color-mix(in srgb, var(--ocx-color-accent) 8%, transparent);
}
}
</style>

<style>
@layer ocx {
/* Unscoped — SelectContent portals to <body> (same reasoning as
 * .copy-ctx-menu / .kw-popover). Popper-positioned with a 6px offset so
 * the dropdown floats clear of the trigger instead of overlapping it. */
.sort-dropdown {
  min-width: 160px;
  padding: 0.35rem;
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  z-index: var(--ocx-z-popover);
  animation: copy-ctx-fade-in var(--ocx-duration-enter) ease-out;
}

.sort-item {
  display: flex;
  align-items: center;
  padding: 0.45rem 0.6rem;
  border-radius: var(--ocx-radius-sm);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-muted);
  cursor: pointer;
  outline: none;
  transition: background var(--ocx-duration-fast), color var(--ocx-duration-fast);
}

.sort-item:hover,
.sort-item[data-highlighted] {
  background: var(--ocx-color-surface-subtle);
  color: var(--ocx-color-accent);
}

.sort-item[data-state='checked'] {
  color: var(--ocx-color-accent);
}
}
</style>
