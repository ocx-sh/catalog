<script lang="ts">
// Plain (non-`setup`) script block: `buildTagCopyActions` is a runtime
// function export, which `<script setup>` cannot contain (Vue SFC
// compile-time restriction — only type-only exports are allowed there).
// Module-scope exports from this block are available inside the
// `<script setup>` block below same as any other SFC import.

import { installCommand, type InstallFlavor, type InstallIcon } from '../../composables/useInstallFlavors'

export interface CopyAction {
  label: string
  command: string
  icon: 'identifier' | 'tag' | 'link' | InstallIcon
}

/**
 * SINGLE source of truth for EVERY copy context menu — detail-page tag
 * badges (`TagBadge.vue`, `VersionTree.vue` alias-chain segments), the
 * detail install grid (`MetaRail.vue`), the catalog card (`PackageCard.vue`)
 * and the catalog table (`PackageTable.vue`). Do NOT hand-roll an action
 * list in a consumer: that is exactly how the catalog menu silently missed a
 * later-added action.
 *
 * The menu is the three copy actions plus ONE item per install flavor
 * (`useInstallFlavors`), so `DEFAULT_INSTALL_FLAVORS` reaches the
 * right-click menu and the install grid from the same list. It used to carry
 * its own hardcoded five-command block, which is why an `ocx package inspect`
 * item existed here and nowhere else; folding both onto one list is what
 * makes that shared flavor list cover every CLI string the theme renders.
 *
 * `tag` may be `null` — a catalog card may know no tag, in which case the
 * identifier is the bare qualified name and the tag-only action is omitted.
 * `flavors` is required, not defaulted: a call site that forgets it should
 * not silently fall back to the built-in CLI name.
 */
export function buildTagCopyActions(
  qualifiedName: string,
  tag: string | null | undefined,
  flavors: readonly InstallFlavor[],
): CopyAction[] {
  const identifier = tag ? `${qualifiedName}:${tag}` : qualifiedName
  const list: CopyAction[] = [
    { label: 'Copy identifier', command: identifier, icon: 'identifier' },
  ]
  if (tag) list.push({ label: 'Copy tag', command: tag, icon: 'tag' })
  // Detail-page URL — `qualifiedName` is `<brand>/<ns>/<pkg>` (WHATEVER
  // this deployment's own brand token is, e.g. wire `root.name` — see
  // `subsystem-sources.md`'s labels.ts note), the path after that FIRST
  // segment IS the route. C-601: a hardcoded `.replace(/^ocx\.sh\//, '')`
  // here left the brand prefix in place (producing a double-prefixed,
  // wrong link) on any deployment whose index uses a different brand
  // token — stripping exactly the first `/`-segment is brand-agnostic and
  // matches the SAME invariant `sources/types.ts`'s S-008 check already
  // enforces on every `root.name` this function ever receives (every
  // caller passes a wire-qualified name, never a hand-built string). SSR
  // guard: this runs in consumers' computeds during the SSG build, where
  // there is no origin to resolve against.
  if (typeof window !== 'undefined') {
    const path = qualifiedName.split('/').slice(1).join('/')
    list.push({ label: 'Copy link', command: `${window.location.origin}/${path}`, icon: 'link' })
  }
  for (const flavor of flavors) {
    list.push({ label: flavor.label, command: installCommand(flavor.command, identifier), icon: flavor.icon })
  }
  return list
}
</script>

<script setup lang="ts">
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
} from 'reka-ui'
import CopyIcon from './CopyIcon.vue'
import { useToast } from '../../composables/useToast'

// Right-click copy menu — originally factored out of
// `components/detail/TagBadge.vue`'s inline context menu so a second
// consumer (`InstallRow.vue`, the catalog card's install box) didn't have
// to paste the whole 130-line ContextMenu* block. `TagBadge.vue` is now
// migrated onto this component too (detail-page right-click-menu-coverage
// fix): every per-tag badge, everywhere, shares this one menu
// implementation instead of two near-identical copies drifting apart.
//
// `ContextMenuPortal` is required here: without it, `ContextMenuContent`
// renders inline in the DOM instead of teleporting to `<body>`, which for a
// trigger nested in `.package-card`'s `<a>` (InstallRow's case) leaves the
// whole menu — and every item in it — a DOM descendant of that anchor.
// VitePress's router intercepts clicks by walking up from `event.target` to
// the nearest `<a>`, so without the portal, selecting ANY item (even one
// that itself calls `preventDefault`) still gets caught by that walk and
// soft-navigates to the card's detail route. Confirmed by reproduction: an
// un-portalled menu item click fired `history.pushState` to the detail
// route even though the item's own click handler had already run. TagBadge
// is never nested in an anchor, so it didn't strictly need the portal, but
// sharing one implementation is simpler than forking it back out — and a
// portal is harmless (in fact helpful for popover-nested badges, whose
// `.minor-popover` ancestor is already teleported to `<body>` itself).
//
// Trigger content is a slot so any clickable element can host the menu.
// `copyText` is deliberately a prop, not an owned `useCopyState` instance:
// the consumer keeps its OWN copy state, so a single "copied" flag drives
// that element's visual feedback (border/checkmark) for both a direct left
// click and every menu action alike — exactly how TagBadge wires itself
// today, just with the state living one level up instead of inside this
// component.
defineProps<{
  actions: CopyAction[]
  copyText: (text: string) => void | Promise<void>
}>()

// Every menu selection confirms via the global toast — semantic label, not
// payload ("Copy identifier" → "Copied — identifier"). Direct left-click
// copies toast at their own call sites; this covers all context menus.
const { toast } = useToast()

function onSelect(action: CopyAction, copyText: (text: string) => void | Promise<void>) {
  copyText(action.command)
  toast(`Copied — ${action.label.replace(/^Copy /, '')}`)
}
</script>

<template>
  <ContextMenuRoot :modal="false">
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent class="copy-ctx-menu">
        <ContextMenuItem
          v-for="action in actions"
          :key="action.label"
          class="copy-ctx-item"
          @select="onSelect(action, copyText)"
        >
          <CopyIcon v-if="action.icon === 'identifier'" :copied="false" :size="14" />
          <svg v-else-if="action.icon === 'tag'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          <svg v-else-if="action.icon === 'link'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <!-- Project = folder (used consistently with the install grid's
               row icons in MetaRail.vue); the former download-tray glyph
               now denotes 'install' below. -->
          <svg v-else-if="action.icon === 'project'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <svg v-else-if="action.icon === 'install'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <svg v-else-if="action.icon === 'global'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{{ action.label }}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

<style>
@layer ocx {
/* Unscoped, own class names (`copy-ctx-*`, not TagBadge's `ctx-*`) — reka-ui
 * portals ContextMenuContent to <body>, outside any component's
 * scoped-CSS subtree, so `scoped` would never match it regardless. Visually
 * identical to TagBadge's block; duplicated rather than shared because this
 * component can't import from or edit `detail/TagBadge.vue` this wave. */
.copy-ctx-menu {
  min-width: 200px;
  padding: 0.35rem;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  z-index: 100;
  animation: copy-ctx-fade-in 0.12s ease-out;
}

.copy-ctx-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-2);
  cursor: pointer;
  outline: none;
  transition: background 0.1s, color 0.1s;
}

.copy-ctx-item:hover,
.copy-ctx-item[data-highlighted] {
  background: var(--c-surface-2);
  color: var(--c-accent);
}

@keyframes copy-ctx-fade-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
}
</style>
