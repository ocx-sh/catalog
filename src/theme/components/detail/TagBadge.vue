<script setup lang="ts">
import { computed } from 'vue'
import { useCopyState } from '../../composables/useCopyState'
import { useToast } from '../../composables/useToast'
import CopyContextMenu, { buildTagCopyActions, type CopyAction } from '../shared/CopyContextMenu.vue'
import CopyIcon from '../shared/CopyIcon.vue'
import { useInstallFlavors } from '../../composables/useInstallFlavors'

// Relocated verbatim from `components/TagBadge.vue` (pre-redesign) into
// `components/detail/` — WP-D owns this rework. The five copy actions'
// command strings + 1300/1500ms timing are UNCHANGED from the original.
// Menu markup itself is now `components/shared/CopyContextMenu.vue` (right-
// click-menu-coverage fix — every tag badge, everywhere, shares one
// ContextMenu implementation instead of two drifting copies; see that
// component's docblock).

// This component's template root is `<CopyContextMenu>`, whose own root is
// reka-ui's `<ContextMenuRoot>` — a component that ships `inheritAttrs:
// false` and never forwards `$attrs` to its rendered slot content
// (confirmed against
// node_modules/reka-ui/dist/ContextMenu/ContextMenuRoot.js — its render
// function only spreads named props onto `MenuRoot`, nothing else). Vue's
// automatic attrs-fallthrough would otherwise land any caller-supplied,
// non-prop/non-emit listener (every `<TagBadge ... @mouseenter="...">` in
// VersionTree.vue — the hover-driven platform-matrix preview) on
// `CopyContextMenu`'s root element, where reka-ui silently drops it: the
// hover never reaches the real DOM element at all (diagnosis: "detail page
// does not show the correct matrix of platforms" — confirmed via a
// synthetic `dispatchEvent('mouseenter', ...)` on the badge producing no
// effect). `inheritAttrs: false` + explicit `v-bind="$attrs"` on the actual
// interactive `<code>` element below re-targets the fallthrough past both
// wrapper components to where it belongs — the standard Vue 3 fix for a
// non-forwarding wrapper root.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  tag: string
  qualifiedName: string
  variant?: 'default' | 'rolling' | 'minor' | 'child'
  /** Presence of `tags[tag].yanked` on the wire — struck + dashed amber,
   * never interactive-looking (still clickable/copyable; a yanked tag is
   * still a real, installable artifact, just discouraged). */
  yanked?: boolean
  /** `tags[tag].yanked.reason`, when known. Surfaced via the badge's own
   * `title` tooltip so a yank reason is reachable for every yanked badge —
   * not just patch-level ones nested in a minor-group popover with its own
   * dedicated reasons list (VersionTree.vue's `.yanked-reasons`). Ignored
   * when `yanked` is false. */
  yankedReason?: string
  /** Display override — shown instead of `tag` while every copy action and
   * the context menu keep targeting `tag`. Lets a synthesized group header
   * (e.g. major "1" with no real `1` tag on the wire) wear the uniform
   * badge + menu, resolved to a concrete copyable tag underneath it. */
  label?: string
}>(), {
  variant: 'default',
  yanked: false,
  yankedReason: undefined,
  label: undefined,
})

const emit = defineEmits<{ copied: [] }>()

// useCopyState.ts's docstring names TagBadge as one of its intended
// consumers — the 1500ms copied-flag reset is its job now; the extra
// 1300ms `emit('copied')` timer (fires 200ms before the checkmark fades,
// so the popover it closes doesn't visibly outlast the badge's own
// feedback) stays TagBadge's own layer on top.
const { copied, copyText: copyViaState } = useCopyState(1500)

// `buildTagCopyActions` is CopyContextMenu's single source of truth for the
// copy actions plus one item per install flavor — changing the command set
// is a `DEFAULT_INSTALL_FLAVORS` edit, not a refactor here.
const flavors = useInstallFlavors()
const actions = computed<CopyAction[]>(() => buildTagCopyActions(props.qualifiedName, props.tag, flavors.value))

async function copyText(text: string) {
  if (copied.value) return
  await copyViaState(text)
  setTimeout(() => emit('copied'), 1300) // start fade-out 200ms before checkmark ends
}

function identifier() {
  return `${props.qualifiedName}:${props.tag}`
}

function badgeTitle(): string {
  if (!props.yanked) return 'Click to copy identifier · right-click for more'
  return props.yankedReason ? `Yanked — ${props.yankedReason} — click to copy identifier · right-click for more` : 'Yanked — click to copy identifier · right-click for more'
}

const { toast } = useToast()

async function handleClick() {
  if (copied.value) return
  await copyText(identifier())
  toast(`Copied — :${props.tag} identifier`)
}
</script>

<template>
  <CopyContextMenu :actions="actions" :copy-text="copyText">
    <!-- role/tabindex/keydown: a <code> is not natively focusable — Tab +
         Enter/Space must work like the click (keyboard-reachability pass). -->
    <code
      class="tag-badge"
      :class="[variant, { copied, yanked }]"
      :title="badgeTitle()"
      role="button"
      tabindex="0"
      v-bind="$attrs"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <span class="tag-text">{{ label ?? tag }}</span>
      <CopyIcon :copied="true" :size="12" check-class="tag-check" />
    </code>
  </CopyContextMenu>
</template>

<style scoped>
@layer ocx {
.tag-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  padding: 0.2rem 0.6rem;
  background: var(--ocx-color-surface-subtle);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-sm);
  color: var(--ocx-color-fg-muted);
  cursor: pointer;
  transition: border-color var(--ocx-duration-slow), color var(--ocx-duration-slow), background var(--ocx-duration-slow);
  user-select: none;
}

.tag-badge:focus-visible {
  outline: none;
  border-color: var(--ocx-color-accent);
}

.tag-badge.rolling {
  font-weight: var(--ocx-font-weight-semibold);
}

.tag-badge.child {
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
}

.tag-badge:hover {
  border-color: var(--ocx-color-accent);
  color: var(--ocx-color-accent);
}

.tag-text {
  transition: opacity var(--ocx-duration-base) ease-in;
}

.tag-check {
  position: absolute;
  inset: 0;
  margin: auto;
  opacity: 0;
  transition: opacity var(--ocx-duration-base) ease-in;
}

.tag-badge.copied {
  border-color: var(--ocx-color-success);
  color: var(--ocx-color-success);
}

.tag-badge.copied .tag-text {
  opacity: 0;
  transition: opacity var(--ocx-duration-fast) ease-out;
}

.tag-badge.copied .tag-check {
  opacity: 1;
  transition: opacity var(--ocx-duration-fast) ease-out;
}

/* Yanked — struck, dashed amber, muted (design mock 1c/1d). */
.tag-badge.yanked:not(.copied) {
  color: var(--ocx-color-fg-subtle);
  border-style: dashed;
  border-color: var(--ocx-color-warning);
  text-decoration: line-through;
}
}
</style>
