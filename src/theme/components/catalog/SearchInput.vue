<script setup lang="ts">
import { ref } from 'vue'

// Design mock 1a: 44px search field, "/" badge. The badge is decorative
// only — the actual global ⌘K command palette is WP-E's
// `useCommandPalette`, a separate module this component never imports (see
// plan_site_redesign.md's frozen "/" decision). This component only
// exposes `focus()` for CatalogPage's page-scoped "/" handler to call.

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// Two-stage Escape (VS Code/Slack pattern): with text, first Esc clears the
// query and keeps focus for a fresh one; on an empty field, Esc blurs.
function onEsc(e: KeyboardEvent) {
  if (props.modelValue) emit('update:modelValue', '')
  else (e.target as HTMLInputElement).blur()
}

const inputEl = ref<HTMLInputElement | null>(null)

// Re-entering with existing text selects it all, so typing starts a fresh
// query. Covers both click and the "/" handler (programmatic focus() fires
// the focus event too). The mouseup guard stops the browser from collapsing
// the fresh selection into a caret on click — first mouseup after focus
// only, so in-field caret/drag selection keeps working afterwards.
let selectOnMouseup = false

function onFocus(e: FocusEvent) {
  (e.target as HTMLInputElement).select()
  selectOnMouseup = true
}

function onMouseup(e: MouseEvent) {
  if (selectOnMouseup) e.preventDefault()
  selectOnMouseup = false
}

defineExpose({
  focus: () => inputEl.value?.focus(),
})
</script>

<template>
  <div class="search-input">
    <svg
      class="search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      ref="inputEl"
      type="text"
      class="search-field"
      placeholder="search packages — name, keyword, description…"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="onFocus"
      @mouseup="onMouseup"
      @keydown.esc="onEsc"
    >
    <button
      v-if="modelValue"
      type="button"
      class="search-kbd search-clear"
      aria-label="Clear search"
      tabindex="-1"
      @click="$emit('update:modelValue', ''); inputEl?.focus()"
    >×</button>
    <span v-else class="search-kbd">/</span>
  </div>
</template>

<style scoped>
.search-input {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 44px;
  padding: 0 14px;
  background: var(--c-surface);
  border: 1.5px solid var(--c-line);
  border-radius: var(--radius-lg);
  transition: border-color 0.15s;
}

.search-input:focus-within {
  border-color: var(--c-accent);
}

.search-icon {
  flex-shrink: 0;
  color: var(--c-text-3);
}

.search-field {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-base);
  color: var(--c-text-1);
}

.search-field::placeholder {
  color: var(--c-text-3);
}

.search-kbd {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--c-text-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  background: var(--c-surface-2);
}

/* Same badge slot as "/" — swaps to a clear affordance once there's a query. */
.search-clear {
  cursor: pointer;
  line-height: inherit;
  transition: color 0.15s, border-color 0.15s;
}

.search-clear:hover,
.search-clear:focus-visible {
  color: var(--c-text-1);
  border-color: var(--c-accent);
  outline: none;
}
</style>
