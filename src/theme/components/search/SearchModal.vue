<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useData, useRouter } from 'vitepress'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import MiniSearch, { type SearchResult } from 'minisearch'
import { useCatalog } from '../../composables/useCatalog'
import { filterPackages } from '../../utils/filterPackages'
import { useCommandPalette, useGlobalPaletteShortcut } from '../../composables/useCommandPalette'

// Mounted once in Layout.vue — this is THE singleton palette consumer, so
// it (and only it) wires the global ⌘K/Ctrl-K/"/" listener.
useGlobalPaletteShortcut()

const { isOpen, close } = useCommandPalette()
const router = useRouter()
const { localeIndex } = useData()

const query = ref('')
const inputEl = ref<HTMLInputElement>()
const selectedIndex = ref(0)

// Lazy — `SearchModal` mounts once globally (every page, not just the
// catalog route), so eagerly fetching the catalog on mount would hit the
// network on every page load even when the palette never opens. `load()`
// only runs once the user actually opens it (below); `fetchCatalog`'s own
// module-level cache makes repeat opens free.
const { catalog, load: loadCatalog } = useCatalog()

interface DocHit { title: string, titles: string[] }

// `@localSearchIndex` is a VitePress virtual module — it only resolves via
// the local-search Vite plugin (on, per config.mts `search.provider:
// 'local'`), so it must never be imported at module scope (that would run
// during the VitePress SSR build too, where the plugin's dev/build split
// behaves differently). Dynamic `import()` inside this open-triggered
// loader is the safe shape.
const docsIndex = shallowRef<MiniSearch<DocHit> | null>(null)
const docsIndexLoading = ref(false)

async function ensureDocsIndex() {
  if (docsIndex.value || docsIndexLoading.value) return
  docsIndexLoading.value = true
  try {
    const mod = await import('@localSearchIndex') as unknown as {
      default: Record<string, () => Promise<{ default: string }>>
    }
    const loadLocale = mod.default[localeIndex.value]
    if (!loadLocale) return
    const raw = await loadLocale()
    docsIndex.value = MiniSearch.loadJSON<DocHit>(raw.default, {
      fields: ['title', 'titles', 'text'],
      storeFields: ['title', 'titles'],
    })
  } finally {
    docsIndexLoading.value = false
  }
}

watch(isOpen, (open) => {
  if (open) {
    ensureDocsIndex()
    loadCatalog()
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => inputEl.value?.focus())
  }
})

watch(query, () => { selectedIndex.value = 0 })

const packageResults = computed(() => {
  if (!query.value.trim()) return []
  return filterPackages(catalog.value.packages, { query: query.value }).slice(0, 8)
})

const docResults = computed(() => {
  if (!query.value.trim() || !docsIndex.value) return []
  return docsIndex.value.search(query.value).slice(0, 8) as (SearchResult & DocHit)[]
})

interface FlatResult {
  href: string
  label: string
  sublabel: string
}

/** Bare `<ns>/<pkg>` — the route path. Never `pkg.name`, which carries the
 * `ocx.sh/` prefix (same trap documented in `PackageCard`/`usePackageRoot`). */
function pkgHref(pkg: { namespace: string, package: string }) {
  return `/${pkg.namespace}/${pkg.package}`
}

const flatResults = computed<FlatResult[]>(() => [
  ...packageResults.value.map(pkg => ({ href: pkgHref(pkg), label: pkg.title, sublabel: pkg.name })),
  ...docResults.value.map(hit => ({ href: hit.id, label: hit.title, sublabel: hit.titles.join(' › ') || hit.id })),
])

function go(href: string) {
  close()
  router.go(href)
}

// ponytail: reka-ui's DialogContent restores focus to the pre-open
// activeElement on close by default. After a keyboard-invoked Esc, the
// browser treats that programmatic restore as keyboard-originated and
// paints a :focus-visible ring on it (repro: click the GitHub nav link,
// return, Ctrl+K, Esc → coral ring on the link). Suppressing the restore
// trades away focus-restore-on-abort for keyboard users. Ceiling: if a
// keyboard user complains about losing their place after aborting the
// palette, restore focus here but call `.blur()` immediately after instead
// of skipping the restore outright, to drop the ring while keeping the
// restore.
function onCloseAutoFocus(e: Event) {
  e.preventDefault()
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function onContentKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flatResults.value.length) selectedIndex.value = (selectedIndex.value + 1) % flatResults.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flatResults.value.length) {
      selectedIndex.value = (selectedIndex.value - 1 + flatResults.value.length) % flatResults.value.length
    }
  } else if (e.key === 'Enter') {
    const picked = flatResults.value[selectedIndex.value]
    if (picked) {
      e.preventDefault()
      go(picked.href)
    }
  }
}
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay class="palette-overlay" />
      <DialogContent
        class="palette-content"
        aria-label="Search"
        @keydown="onContentKeydown"
        @close-auto-focus="onCloseAutoFocus"
      >
        <DialogTitle class="visually-hidden">Search</DialogTitle>
        <DialogDescription class="visually-hidden">
          Search packages by name or keyword, and documentation pages by title.
        </DialogDescription>
        <div class="palette-search-bar">
          <span class="palette-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            class="palette-input"
            placeholder="Search packages and docs…"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          >
          <DialogClose class="palette-close" aria-label="Close search">Esc</DialogClose>
        </div>

        <div class="palette-results">
          <template v-if="packageResults.length">
            <p class="palette-group-label">Packages</p>
            <a
              v-for="(pkg, i) in packageResults"
              :key="pkg.name"
              :href="pkgHref(pkg)"
              class="palette-result"
              :class="{ active: selectedIndex === i }"
              @click.prevent="go(pkgHref(pkg))"
              @mouseenter="selectedIndex = i"
            >
              <span class="palette-result-title">{{ pkg.title }}</span>
              <span class="palette-result-sub">{{ pkg.name }}</span>
            </a>
          </template>

          <template v-if="docResults.length">
            <p class="palette-group-label">Docs</p>
            <a
              v-for="(hit, i) in docResults"
              :key="hit.id"
              :href="hit.id"
              class="palette-result"
              :class="{ active: selectedIndex === packageResults.length + i }"
              @click.prevent="go(hit.id)"
              @mouseenter="selectedIndex = packageResults.length + i"
            >
              <span class="palette-result-title">{{ hit.title }}</span>
              <span class="palette-result-sub">{{ hit.titles.join(' › ') || hit.id }}</span>
            </a>
          </template>

          <p v-if="query.trim() && !flatResults.length" class="palette-empty">
            No results for "{{ query }}"
          </p>
          <p v-else-if="!query.trim()" class="palette-empty">
            Search packages by name or keyword, or documentation by title.
          </p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.palette-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay);
  z-index: 100;
}

.palette-overlay[data-state='open'] {
  animation: palette-fade-in 120ms ease;
}

.palette-content {
  position: fixed;
  top: 12vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(90vw, 560px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  z-index: 101;
}

.palette-content[data-state='open'] {
  animation: palette-fade-in 120ms ease;
}

.palette-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 52px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--c-line);
}

.palette-search-icon {
  display: inline-flex;
  color: var(--c-text-3);
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-md);
  color: var(--c-text-1);
}

.palette-input::placeholder {
  color: var(--c-text-3);
}

.palette-close {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--c-text-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 3px 7px;
  background: none;
}

.palette-close:hover {
  color: var(--c-text-1);
}

.palette-results {
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-group-label {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-3);
  margin: 10px 8px 4px;
}

.palette-group-label:first-child {
  margin-top: 4px;
}

.palette-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
}

.palette-result.active {
  background: color-mix(in srgb, var(--c-accent) 8%, transparent);
}

.palette-result-title {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--c-text-1);
}

.palette-result.active .palette-result-title {
  color: var(--c-accent);
}

.palette-result-sub {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
}

.palette-empty {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--c-text-3);
  padding: 24px 10px;
  text-align: center;
}

@keyframes palette-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
