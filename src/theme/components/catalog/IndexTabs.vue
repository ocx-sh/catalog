<script setup lang="ts">
// Index scope. Presentational only — CatalogPage owns the selection and the
// URL mirroring, this renders whatever list it is given (same split as
// FilterChips.vue).
//
// A tab row rather than another chip: the chip rail is already four
// dimensions deep, and scope is not one of them. Platforms and keywords are
// attributes a package HAS; an index is where it comes FROM. Reading it as a
// place you are in — stated above the toolbar, before search — is also the
// only treatment that makes the aggregation visible to someone who never
// opens the search field.
import { computed } from 'vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import type { CatalogIndexInfo } from '../../composables/useCatalog'

const props = defineProps<{
  indexes: CatalogIndexInfo[]
  /** The selected index's name, or `null` for "all". */
  active: string | null
  /** Packages in the whole catalog — the "all" tab's count. */
  total: number
}>()

const emit = defineEmits<{ select: [name: string | null] }>()

// Past this many the row stops being a row. The tail collapses into the same
// searchable popover FilterChips uses for its keyword overflow rather than
// scrolling sideways or wrapping into a second line of chrome.
const MAX_INLINE = 6

const inline = computed(() => props.indexes.slice(0, MAX_INLINE))
const overflow = computed(() => props.indexes.slice(MAX_INLINE))
</script>

<template>
  <nav class="index-tabs" data-slot="index-tabs" aria-label="Index">
    <!-- "all" is always first and never moves: it is the widest scope, not a
         reset button, and a row whose first entry shifted with configuration
         would be unlearnable. -->
    <button
      type="button"
      class="index-tab"
      :class="{ active: active === null }"
      :aria-current="active === null ? 'true' : undefined"
      @click="emit('select', null)"
    >
      <span class="index-name">all</span>
      <span class="index-count">{{ total }}</span>
    </button>

    <button
      v-for="entry in inline"
      :key="entry.name"
      type="button"
      class="index-tab"
      :class="{ active: active === entry.name }"
      :aria-current="active === entry.name ? 'true' : undefined"
      @click="emit('select', entry.name)"
    >
      <span class="index-name">{{ entry.name }}</span>
      <span class="index-count">{{ entry.count }}</span>
      <!-- The default index is where an arriving visitor already is, so the
           marker explains the preselection rather than offering an action. -->
      <span v-if="entry.default" class="index-default">default</span>
    </button>

    <PopoverRoot v-if="overflow.length">
      <PopoverTrigger class="index-more">+{{ overflow.length }}</PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="index-popover" align="start" :side-offset="2">
          <button
            v-for="entry in overflow"
            :key="entry.name"
            type="button"
            class="index-popover-item"
            :class="{ active: active === entry.name }"
            :aria-current="active === entry.name ? 'true' : undefined"
            @click="emit('select', entry.name)"
          >
            <span class="index-name">{{ entry.name }}</span>
            <span class="index-count">{{ entry.count }}</span>
          </button>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </nav>
</template>

<style scoped>
@layer ocx {
/* A bordered surface in the toolbar column, not a full-bleed chrome strip:
   this row sits INSIDE `.catalog-page`'s padded, max-width box, alongside
   the search field, sort control and view toggle — every one of which is a
   bordered rounded surface. Same emphasis border and radius as the search
   field directly beneath it, since the two are stacked at the same width and
   two adjacent boxes with different border weights read as a mistake. */
.index-tabs {
  display: flex;
  align-items: center;
  gap: var(--ocx-space-2);
  height: 44px;
  padding: 0 var(--ocx-space-2);
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width-emphasis) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  /* Many indexes scroll rather than wrapping into a second row that would
     change the toolbar's height as the tab list grows. */
  overflow-x: auto;
  /* No visible scrollbar — same reasoning as FilterChips.vue's
     `.chip-keywords` (it would sit under the tabs and change this row's
     HEIGHT, the same layout jump this row already avoids by scrolling). */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.index-tabs::-webkit-scrollbar {
  display: none;
}

.index-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-3);
  /* Inset inside the 44px bar. A literal height, like .search-input's own
     44px and the meta row's 28px controls — a control height is layout, not
     a themed value. */
  height: 36px;
  flex-shrink: 0;
  padding: 0 var(--ocx-space-4);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-fg-muted);
  background: none;
  border: none;
  border-radius: var(--ocx-radius-md);
  cursor: pointer;
  transition: color var(--ocx-duration-base), background-color var(--ocx-duration-base);
}

.index-tab:hover {
  color: var(--ocx-color-fg);
  background: var(--ocx-color-surface-subtle);
}

/* Inset, like .table-row's own focus rectangle — an outset ring on a tab
   inside a rounded box gets clipped by the bar's own overflow. */
.index-tab:focus-visible {
  outline: var(--ocx-border-width-strong) solid var(--ocx-color-accent);
  outline-offset: calc(-1 * var(--ocx-border-width-strong));
  color: var(--ocx-color-fg);
}

/* The same tinted-segment treatment the view toggle uses for its selected
   button — an underline would be the one thing in this column drawing a rule
   instead of filling a shape, and inside a rounded box it reads as a
   leftover. `--ocx-color-accent-fg` rather than `--ocx-color-accent` because
   this is small TEXT on a light surface (WP6's a11y split); the toggle can
   use the full-brand hue because its content is an icon. */
.index-tab.active {
  color: var(--ocx-color-accent-fg);
  background: color-mix(in srgb, var(--ocx-color-accent) 8%, transparent);
}

.index-count {
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
}

.index-default {
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
}

.index-more {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-fg-subtle);
  background: none;
  border: none;
  padding: var(--ocx-space-2) var(--ocx-space-3);
  cursor: pointer;
}

.index-more:hover,
.index-more:focus-visible {
  outline: none;
  color: var(--ocx-color-fg);
}
}
</style>

<style>
@layer ocx {
/* Unscoped — PopoverContent portals to <body>, outside this component's
 * scoped-CSS subtree (same reasoning as FilterChips' own .kw-popover). */
.index-popover {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: var(--ocx-space-2);
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  z-index: var(--ocx-z-popover);
  animation: copy-ctx-fade-in var(--ocx-duration-enter) ease-out;
}

.index-popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ocx-space-3);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-muted);
  background: none;
  border: none;
  border-radius: var(--ocx-radius-sm);
  padding: var(--ocx-space-2) var(--ocx-space-3);
  cursor: pointer;
  text-align: left;
}

.index-popover-item:hover {
  background: var(--ocx-color-surface-subtle);
  color: var(--ocx-color-fg);
}

.index-popover-item.active {
  color: var(--ocx-color-accent-hover);
  background: var(--ocx-color-accent-tint);
}
}
</style>
