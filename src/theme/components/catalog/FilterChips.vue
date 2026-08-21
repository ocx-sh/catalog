<script setup lang="ts">
// Presentational only — CatalogPage owns all filter STATE (active
// selections) and the keyword top-N computation; this component just
// renders whatever chip lists it's given and emits toggle events. The one
// piece of local state is the "+N more" popover's own search text.

import { computed, ref } from 'vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import { OS_GLYPHS, OS_ORDER } from '../../utils/osGlyphs'

interface KeywordChip {
  keyword: string
  count: number
}

const props = defineProps<{
  activePlatforms: string[]
  visibleKeywords: KeywordChip[]
  /** Full frequency-sorted keyword list — the popover searches this. */
  allKeywords: KeywordChip[]
  activeKeywords: string[]
  hiddenKeywordCount: number
  deprecatedActive: boolean
}>()

const emit = defineEmits<{
  'toggle-platform': [os: string]
  'toggle-keyword': [keyword: string]
  'toggle-deprecated': []
}>()

// Searchable popover replaces the old expand-all chip dump (owner finding:
// hundreds of chips at once is unusable). Plain substring filter — a
// short known-vocabulary list needs no fuzzy engine.
const kwQuery = ref('')
const popoverKeywords = computed(() => {
  const q = kwQuery.value.trim().toLowerCase()
  if (!q) return props.allKeywords
  return props.allKeywords.filter(k => k.keyword.toLowerCase().includes(q))
})
</script>

<template>
  <div class="filter-chips">
    <button
      v-for="os in OS_ORDER"
      :key="os"
      type="button"
      class="chip"
      tabindex="-1"
      :class="{ active: activePlatforms.includes(os) }"
      :aria-pressed="activePlatforms.includes(os)"
      @click="emit('toggle-platform', os)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path v-for="(p, i) in OS_GLYPHS[os].paths" :key="i" :d="p" />
        <rect v-for="(r, i) in OS_GLYPHS[os].rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" />
      </svg>
      {{ os }}
      <span v-if="activePlatforms.includes(os)" class="chip-close">✕</span>
    </button>

    <span v-if="OS_ORDER.length" class="chip-divider" />

    <button
      v-for="kw in visibleKeywords"
      :key="kw.keyword"
      type="button"
      class="chip"
      tabindex="-1"
      :class="{ active: activeKeywords.includes(kw.keyword) }"
      :aria-pressed="activeKeywords.includes(kw.keyword)"
      @click="emit('toggle-keyword', kw.keyword)"
    >
      {{ kw.keyword }}
      <span v-if="activeKeywords.includes(kw.keyword)" class="chip-close">✕</span>
    </button>

    <PopoverRoot v-if="hiddenKeywordCount > 0">
      <PopoverTrigger class="chip-more" tabindex="-1">
        +{{ hiddenKeywordCount }} more
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="kw-popover" align="start" :side-offset="6">
          <input
            v-model="kwQuery"
            type="text"
            class="kw-popover-input"
            placeholder="filter keywords…"
          >
          <div class="kw-popover-list">
            <button
              v-for="kw in popoverKeywords"
              :key="kw.keyword"
              type="button"
              class="kw-popover-item"
              :class="{ active: activeKeywords.includes(kw.keyword) }"
              :aria-pressed="activeKeywords.includes(kw.keyword)"
              @click="emit('toggle-keyword', kw.keyword)"
            >
              <span class="kw-popover-name">{{ kw.keyword }}</span>
              <span class="kw-popover-count">{{ kw.count }}</span>
            </button>
            <p v-if="popoverKeywords.length === 0" class="kw-popover-empty">no keyword matches</p>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <button
      type="button"
      class="chip chip-deprecated"
      tabindex="-1"
      :class="{ active: deprecatedActive }"
      :aria-pressed="deprecatedActive"
      @click="emit('toggle-deprecated')"
    >
      deprecated
      <span v-if="deprecatedActive" class="chip-close">✕</span>
    </button>
  </div>
</template>

<style scoped>
.filter-chips {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--c-text-2);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-full);
  padding: 4px 11px;
  background: var(--c-surface);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s,
    background-color 0.15s;
}

.chip:hover {
  color: var(--c-text-1);
}

.chip:focus-visible,
.chip-more:focus-visible {
  outline: none;
  border-color: var(--c-accent);
  color: var(--c-text-1);
}

.chip.active {
  color: var(--c-accent-hover);
  border-color: var(--c-accent-tint-border);
  background: var(--c-accent-tint-bg);
}

.chip-close {
  font-size: 10px;
}

.chip-more {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--c-text-3);
  background: none;
  border: none;
  padding: 4px 6px;
  cursor: pointer;
}

.chip-more:hover {
  color: var(--c-text-1);
}

.chip-deprecated {
  margin-left: auto;
}

.chip-divider {
  width: 1px;
  height: 18px;
  background: var(--c-line);
  margin: 0 4px;
  flex-shrink: 0;
}
</style>

<style>
/* Unscoped — PopoverContent portals to <body>, outside this component's
 * scoped-CSS subtree (same reasoning as .copy-ctx-menu). */
.kw-popover {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
  padding: 10px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  z-index: 100;
  animation: copy-ctx-fade-in 0.12s ease-out;
}

.kw-popover-input {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-1);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-md);
  padding: 6px 9px;
  outline: none;
}

.kw-popover-input:focus {
  border-color: var(--c-accent);
}

.kw-popover-list {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow-y: auto;
}

.kw-popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-2);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  cursor: pointer;
  text-align: left;
}

.kw-popover-item:hover {
  background: var(--c-surface-2);
  color: var(--c-text-1);
}

.kw-popover-item.active {
  color: var(--c-accent-hover);
  background: var(--c-accent-tint-bg);
}

.kw-popover-count {
  font-size: var(--text-2xs);
  color: var(--c-text-3);
}

.kw-popover-empty {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
  margin: 0;
  padding: 5px 8px;
}
</style>
