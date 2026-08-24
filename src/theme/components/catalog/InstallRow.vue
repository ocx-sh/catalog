<script setup lang="ts">
import { computed } from 'vue'
import { useCopyState } from '../../composables/useCopyState'
import { useToast } from '../../composables/useToast'
import { installCommand, useInstallFlavors } from '../../composables/useInstallFlavors'
import CopyIcon from '../shared/CopyIcon.vue'

const props = defineProps<{
  /** The wire-qualified name (`pkg.name`/`root.name` — already carries this
   * deployment's own brand prefix). C-601: this component used to accept a
   * bare `<ns>/<pkg>` and synthesize a hardcoded `ocx.sh/` prefix itself,
   * which rendered a wrong, uninstallable command on any deployment whose
   * index uses a different prefix (a corporate mirror). Never a bare name
   * here — pass the qualified name straight through instead. */
  qualifiedName: string
}>()

const { copied, copyText } = useCopyState(1500)

// The card's one-line shorthand is the FIRST of the theme's fixed install
// flavors — `DEFAULT_INSTALL_FLAVORS[0]`, "add to project". `useInstallFlavors`
// never yields an empty list, so there is no no-command state to render.
const flavors = useInstallFlavors()
const command = computed(() => installCommand(flavors.value[0].command, props.qualifiedName))

// The card wraps this component in `<a href>` (catalog grid navigates to
// the detail page on click) — the box is a copy-only shorthand precisely so
// a click here never opens the detail page. `stopPropagation` alone does
// NOT cancel an ancestor anchor's navigation: that's the click event's
// *default action*, gated on `preventDefault`, not on whether the event
// kept bubbling. Both belong here, on the element that owns the click,
// rather than bolted on as `@click.stop` at whichever call site happens to
// wrap this component in an anchor.
const { toast } = useToast()

function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  copyText(command.value)
  toast('Copied — install command')
}
</script>

<template>
  <!-- No own context menu — the whole card carries one (PackageCard wraps
       its root anchor in CopyContextMenu); a second nested menu here would
       double-open on right-click over the box. -->
  <button type="button" class="install-row" title="Click to copy install command · right-click for more" :class="{ copied }" @click="onClick">
    <span class="install-prefix">$</span>
    <span class="install-cmd">{{ command }}</span>
    <CopyIcon :copied="copied" class="install-icon" check-class="install-icon-check" />
  </button>
</template>

<style scoped>
@layer ocx {
.install-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: var(--ocx-color-surface-subtle);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  padding: 6px 9px;
  font-family: var(--ocx-font-mono);
  cursor: pointer;
  transition: border-color 0.15s;
  text-align: left;
}

.install-row:hover,
.install-row:focus-visible {
  border-color: var(--ocx-color-accent);
}

.install-prefix {
  color: var(--ocx-color-accent);
  font-weight: 600;
  font-size: var(--ocx-text-xs);
  flex-shrink: 0;
}

.install-cmd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg);
}

.install-icon {
  flex-shrink: 0;
  color: var(--ocx-color-fg-subtle);
}

.install-row.copied {
  border-color: var(--ocx-color-success);
}

.install-row.copied .install-cmd {
  color: var(--ocx-color-success);
}

.install-icon-check {
  color: var(--ocx-color-success);
}
}
</style>
