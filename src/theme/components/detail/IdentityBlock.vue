<script setup lang="ts">
import { computed } from 'vue'
import { useCopyState } from '../../composables/useCopyState'
import { useToast } from '../../composables/useToast'
import { useImageFallback } from '../../composables/useImageFallback'
import { casUrl, LOGO_EXT_CANDIDATES } from '../../utils/cas'
import { monogramHue, monogramInitials } from '../../utils/monogram'
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
  /** Mount prefix of the source this package came from — see
   * `utils/cas.ts`'s `wirePrefix`. Omitted for the `root: true` source. */
  wireBase?: string
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
const logoCandidates = computed(() =>
  LOGO_EXT_CANDIDATES.map(ext => casUrl(props.bareName, props.root.desc?.logo, ext, props.wireBase ?? '')),
)
const { src: logoSrc, onError: onLogoError } = useImageFallback(logoCandidates)

const hue = computed(() => monogramHue(props.bareName))
const initials = computed(() => monogramInitials(props.bareName.split('/').pop() ?? props.bareName))
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
    <div v-else class="identity-tile identity-monogram" :class="`mg-${hue}`">
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
@layer ocx {
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
  border-radius: var(--ocx-radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-lg);
  font-weight: 600;
}

/* Hue rotation is a class, not an inline style: an inline style is beatable
 * only by `!important`, so a mirror could never restyle a monogram. The
 * `.dark` swap now happens in palette.css like every other token. */
.identity-monogram.mg-0 { background: var(--ocx-color-monogram-0-tint); color: var(--ocx-color-monogram-0); }
.identity-monogram.mg-1 { background: var(--ocx-color-monogram-1-tint); color: var(--ocx-color-monogram-1); }
.identity-monogram.mg-2 { background: var(--ocx-color-monogram-2-tint); color: var(--ocx-color-monogram-2); }
.identity-monogram.mg-3 { background: var(--ocx-color-monogram-3-tint); color: var(--ocx-color-monogram-3); }

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
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-xl);
  font-weight: 700;
  color: var(--ocx-color-fg);
  line-height: 1.2;
  margin: 0;
}

.identity-name-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: 500;
  color: var(--ocx-color-fg-muted);
  background: var(--ocx-color-surface-subtle);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-sm);
  padding: 3px 9px;
  cursor: pointer;
}

.identity-name-badge:hover,
.identity-name-badge:focus-visible {
  border-color: var(--ocx-color-accent);
  color: var(--ocx-color-fg);
}

.identity-check {
  color: var(--ocx-color-success);
}

.identity-latest {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: 500;
  color: var(--ocx-color-success);
}

/* WP6: text color --ocx-color-accent-fg, not --ocx-color-accent-hover — 2.21:1 on the
 * ambient --ocx-color-bg (this badge's DEFAULT state was reusing the hover token
 * for its bright look, not an actual :hover). The border stays
 * --ocx-color-accent-hover — a non-text/decorative use the WCAG text-contrast
 * check doesn't cover. */
.identity-deprecated {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: 600;
  color: var(--ocx-color-accent-fg);
  border: 1px solid var(--ocx-color-accent-hover);
  border-radius: var(--ocx-radius-sm);
  padding: 2px 8px;
  letter-spacing: 0.05em;
}

/* Whole-package yanked (C-603) — same shape as .identity-deprecated, warn
 * tokens instead of the accent-hover coral (more severe than a plain
 * deprecation notice). */
.identity-yanked {
  color: var(--ocx-color-warning);
  border-color: var(--ocx-color-warning);
}

.identity-desc {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-md);
  line-height: 1.55;
  color: var(--ocx-color-fg-muted);
  margin: 0;
}

.identity-keywords {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.identity-keyword {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: 500;
  color: var(--ocx-color-keyword);
  background: var(--ocx-color-keyword-tint);
  padding: 2px 8px;
  border-radius: var(--ocx-radius-sm);
  /* Transparent border reserved so the hover border doesn't shift layout. */
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.identity-keyword:hover {
  border-color: var(--ocx-color-keyword);
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
}
</style>
