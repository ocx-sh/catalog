<script setup lang="ts">
import { computed } from 'vue'
import { useCopyState } from '../../composables/useCopyState'
import { useToast } from '../../composables/useToast'
import { useImageFallback } from '../../composables/useImageFallback'
import { casUrl, LOGO_EXT_CANDIDATES } from '../../utils/cas'
import { monogramHue, monogramInitials, MONOGRAM_HUES } from '../../utils/monogram'
import CopyIcon from '../shared/CopyIcon.vue'
import CopyContextMenu, { buildTagCopyActions } from '../shared/CopyContextMenu.vue'
import { useInstallFlavors } from '../../composables/useInstallFlavors'
import type { PackageRoot } from '../../composables/usePackageRoot'

const props = defineProps<{
  root: PackageRoot
  /** Bare `<ns>/<pkg>` route params — CAS URLs are built from this, NEVER
   * `root.name` (see `usePackageRoot`'s CAS-gotcha docblock). */
  bareName: string
  /** Most precise live version tag aliased to `latest`, or `null` when
   * there is no live `latest` (deprecated packages, or a package whose
   * `latest` tag has no versioned alias) — DetailPage computes this once
   * from the version table and shares it with MetaRail too. */
  latestVersionLabel: string | null
}>()

const title = computed(() => props.root.desc?.title ?? props.bareName.split('/').pop() ?? props.bareName)
const description = computed(() => props.root.desc?.description ?? '')
const keywords = computed(() => props.root.desc?.keywords ?? [])
// C-601: `root.name` — already carries this deployment's own brand prefix
// (whatever it is), never re-synthesized from `bareName` with a hardcoded
// `ocx.sh/` (that broke on a corporate mirror's own prefix). Same pattern
// MetaRail/VersionTree already use for their own `qualifiedName` prop.
const qualifiedDisplayName = computed(() => props.root.name)

const { copied, copyText } = useCopyState(1500)
const { toast } = useToast()

// Same shared action list as every other copy menu (no tag — identifier is
// the bare qualified name); same copied flag drives the badge checkmark for
// left click and menu actions alike.
const flavors = useInstallFlavors()
const menuActions = computed(() => buildTagCopyActions(qualifiedDisplayName.value, null, flavors.value))

// Logo fallback chain: svg -> png -> monogram tile (see utils/cas.ts's
// ponytail note on why extension guess-and-retry is needed at all) —
// `useImageFallback` owns the shared retry-chain mechanics.
const logoCandidates = computed(() => LOGO_EXT_CANDIDATES.map(ext => casUrl(props.bareName, props.root.desc?.logo, ext)))
const { src: logoSrc, onError: onLogoError } = useImageFallback(logoCandidates)

const hue = computed(() => monogramHue(props.bareName))
const initials = computed(() => monogramInitials(props.bareName.split('/').pop() ?? props.bareName))
// Both themes' hues passed as custom properties; CSS picks the active one
// via the `.dark` class (same toggle mechanism as palette.css) — no JS
// media query, SSR-safe.
const monogramStyle = computed(() => ({
  '--mg-bg-light': MONOGRAM_HUES.light.bg[hue.value],
  '--mg-fg-light': MONOGRAM_HUES.light.text[hue.value],
  '--mg-bg-dark': MONOGRAM_HUES.dark.bg[hue.value],
  '--mg-fg-dark': MONOGRAM_HUES.dark.text[hue.value],
}))
</script>

<template>
  <div class="identity-block">
    <img
      v-if="logoSrc"
      :src="logoSrc"
      :alt="`${title} logo`"
      class="identity-tile identity-logo"
      @error="onLogoError"
    >
    <div v-else class="identity-tile identity-monogram" :style="monogramStyle">
      {{ initials }}
    </div>

    <div class="identity-text">
      <div class="identity-title-row">
        <h1 class="identity-title">{{ title }}</h1>
        <CopyContextMenu :actions="menuActions" :copy-text="copyText">
          <button type="button" class="identity-name-badge" @click="copyText(qualifiedDisplayName); toast('Copied — package name')">
            <span>{{ qualifiedDisplayName }}</span>
            <CopyIcon :copied="copied" :size="12" check-class="identity-check" />
          </button>
        </CopyContextMenu>
        <span v-if="latestVersionLabel" class="identity-latest">latest {{ latestVersionLabel }}</span>
        <span v-if="root.status === 'deprecated'" class="identity-deprecated">DEPRECATED</span>
        <span v-else-if="root.status === 'yanked'" class="identity-deprecated identity-yanked">YANKED</span>
      </div>

      <p v-if="description" class="identity-desc">{{ description }}</p>

      <div v-if="keywords.length" class="identity-keywords">
        <a
          v-for="kw in keywords"
          :key="kw"
          class="identity-keyword"
          :href="`/?q=${encodeURIComponent(kw)}`"
          :title="`search packages: ${kw}`"
        >{{ kw }}</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.identity-block {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.identity-tile {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  object-fit: contain;
}

/* Real logos render bare — no box, background, border, or radius (owner
   finding). The monogram keeps its tile look: it IS a colored box. */
.identity-monogram {
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  background: var(--mg-bg-light);
  color: var(--mg-fg-light);
}

:global(.dark) .identity-monogram {
  background: var(--mg-bg-dark);
  color: var(--mg-fg-dark);
}

.identity-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.identity-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.identity-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--c-text-1);
  line-height: 1.2;
  margin: 0;
}

.identity-name-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--c-text-2);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  padding: 3px 9px;
  cursor: pointer;
}

.identity-name-badge:hover,
.identity-name-badge:focus-visible {
  border-color: var(--c-accent);
  color: var(--c-text-1);
}

.identity-check {
  color: var(--c-ok);
}

.identity-latest {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--c-ok);
}

/* WP6: text color --c-accent-text, not --c-accent-hover — 2.21:1 on the
 * ambient --c-bg (this badge's DEFAULT state was reusing the hover token
 * for its bright look, not an actual :hover). The border stays
 * --c-accent-hover — a non-text/decorative use the WCAG text-contrast
 * check doesn't cover. */
.identity-deprecated {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--c-accent-text);
  border: 1px solid var(--c-accent-hover);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  letter-spacing: 0.05em;
}

/* Whole-package yanked (C-603) — same shape as .identity-deprecated, warn
 * tokens instead of the accent-hover coral (more severe than a plain
 * deprecation notice). */
.identity-yanked {
  color: var(--c-warn);
  border-color: var(--c-warn);
}

.identity-desc {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  line-height: 1.55;
  color: var(--c-text-2);
  margin: 0;
}

.identity-keywords {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.identity-keyword {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--c-kw);
  background: var(--c-kw-bg);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  /* Transparent border reserved so the hover border doesn't shift layout. */
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.identity-keyword:hover {
  border-color: var(--c-kw);
}

@media (max-width: 640px) {
  .identity-block {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .identity-title-row {
    justify-content: center;
  }

  .identity-keywords {
    justify-content: center;
  }
}
</style>
