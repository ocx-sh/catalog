<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useData } from 'vitepress'
import { usePackageRoot } from '../../composables/usePackageRoot'
import { useImageIndex } from '../../composables/useImageIndex'
import { buildVersionTable } from '../../utils/version'
import IdentityBlock from './IdentityBlock.vue'
import DisclaimerBanner from './DisclaimerBanner.vue'
import DeprecationBanner from './DeprecationBanner.vue'
import YankedBanner from './YankedBanner.vue'
import VersionTree from './VersionTree.vue'
import ReadmePane from './ReadmePane.vue'
import MetaRail from './MetaRail.vue'

// Hover-to-preview debounce (plan_site_redesign.md "Site fetch layer":
// "hover debounce ~150-200ms at caller" — VersionTree/useImageIndex stay
// pure, this is the one caller that owns the timer).
const HOVER_DEBOUNCE_MS = 180

// Identity comes from this page's own FRONTMATTER, not from its route and
// not from `useData().params` (which is never populated for a synthesized
// static page — see `pages.ts`'s "Passing package identity" section).
// It was read off `page.relativePath` until multi-index routing: a non-root
// source's page is served at `/<label>/<ns>/<pkg>`, so the first path
// segment is an index label, and splitting the route would hand every CAS
// URL a namespace that does not exist — which the theme's image-fallback
// chains degrade silently, reading as "this package publishes nothing"
// rather than as a broken fetch. `pages.ts` writes `ns`/`pkg` verbatim;
// `pkg` is never re-split, so any depth-N package path survives.
const { frontmatter } = useData()
// Per-source wire mount prefix, written into this page's frontmatter by
// `build/pages.ts`'s `packagePageContent` — `''` for the `root: true`
// source, `index/<label>` for every other configured source. It is the only
// channel a client-side fetch has to the placement `sources/mirror.ts`
// actually used; without it every wire request on a non-root source's page
// goes to the site root and 404s.
const wireBase = computed(() => (typeof frontmatter.value.wireBase === 'string' ? frontmatter.value.wireBase : ''))
const ns = computed(() => (typeof frontmatter.value.ns === 'string' ? frontmatter.value.ns : ''))
const pkg = computed(() => (typeof frontmatter.value.pkg === 'string' ? frontmatter.value.pkg : ''))
const bareName = computed(() => `${ns.value}/${pkg.value}`)

const { root, loading, error, notFound } = usePackageRoot(ns, pkg, wireBase)

const table = computed(() => (root.value ? buildVersionTable(root.value.tags, root.value.status) : null))
const defaultRow = computed(() => table.value?.rows.find(r => r.isDefault) ?? null)
const tagCount = computed(() => (root.value ? Object.keys(root.value.tags).length : 0))

// OCI image index driving MetaRail's Platforms card: eager-loaded for the
// default row's primary tag on package load, then swapped on version-tag
// hover (debounced) and reverted on mouseleave (VersionTree itself emits
// the revert as just another `hover-tag`).
const { imageIndex: activeImageIndex, detail: activeDetail, load: loadImageIndex } = useImageIndex()
let hoverTimer: ReturnType<typeof setTimeout> | null = null

// Install-card selection (variant/version combos) — immediate, no hover
// debounce: a deliberate pick should swap the Platforms card right away.
function onInstallSelect(tag: string) {
  const digest = root.value?.tags[tag]?.content
  if (digest) loadImageIndex(ns.value, pkg.value, digest, wireBase.value)
}

function onTagHover(digest: string) {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    loadImageIndex(ns.value, pkg.value, digest, wireBase.value)
  }, HOVER_DEBOUNCE_MS)
}

onMounted(() => {
  watch(defaultRow, (row) => {
    if (!row?.primaryTag || !root.value) return
    const digest = root.value.tags[row.primaryTag]?.content
    if (digest) loadImageIndex(ns.value, pkg.value, digest, wireBase.value)
  }, { immediate: true })
})
</script>

<template>
  <main id="main-content" class="detail-page">
    <p v-if="loading" class="detail-status">Loading…</p>

    <div v-else-if="notFound" class="detail-notfound">
      <a href="/" class="back-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
        all packages
      </a>
      <p class="detail-status">Package not found: {{ bareName }}</p>
    </div>

    <p v-else-if="error" class="detail-status">Failed to load: {{ error }}</p>

    <template v-else-if="root && table">
      <a href="/" class="back-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
        all packages
      </a>

      <DeprecationBanner
        v-if="root.status === 'deprecated'"
        :message="root.deprecated_message"
        :superseded-by="root.superseded_by ?? null"
      />
      <YankedBanner v-else-if="root.status === 'yanked'" />

      <IdentityBlock
        :root="root"
        :bare-name="bareName"
        :wire-base="wireBase"
        :latest-version-label="defaultRow?.preciseAliasTag ?? null"
      />

      <!-- ND-9: mandatory whenever upstream.disclaimer exists — reduced to a
           compact note below the identity block (owner finding: the boxed
           top-of-page banner was too dominant), never hidden. -->
      <DisclaimerBanner
        v-if="root.upstream?.disclaimer"
        :disclaimer="root.upstream.disclaimer"
        :repository-url="root.upstream.repository_url"
      />

      <div class="detail-columns">
        <div class="versions-section">
          <div class="versions-header">
            <span class="versions-title">VERSIONS · {{ tagCount }}</span>
            <span class="versions-hint">click = copy identifier · right-click = more</span>
          </div>
          <div v-if="tagCount" class="versions-card">
            <VersionTree :table="table" :status="root.status" :qualified-name="root.name" @hover-tag="onTagHover" />
          </div>
          <p v-else class="detail-status">No versions available.</p>
        </div>

        <MetaRail
          class="detail-rail"
          :root="root"
          :qualified-name="root.name"
          :primary-tag="defaultRow?.primaryTag ?? null"
          :latest-version-label="defaultRow?.preciseAliasTag ?? null"
          :active-image-index="activeImageIndex"
          :detail="activeDetail"
          :tag-count="tagCount"
          :table="table"
          @select-tag="onInstallSelect"
        />

        <ReadmePane class="readme-section" :bare-name="bareName" :wire-base="wireBase" :digest="root.desc?.readme ?? null" />
      </div>
    </template>
  </main>
</template>

<style scoped>
@layer ocx {
.detail-page {
  flex: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: var(--ocx-space-5) var(--ocx-space-6) var(--ocx-space-8);
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
}

.detail-status {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  color: var(--ocx-color-fg-subtle);
}

.detail-notfound {
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
  padding: var(--ocx-space-9) 0;
  align-items: center;
  text-align: center;
}

/* WP6: --ocx-color-accent-fg, not --ocx-color-accent — 2.79:1 on --ocx-color-bg with the plain
 * accent -> 5.05:1. */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-3);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-accent-fg);
  width: fit-content;
}

.back-link:hover {
  color: var(--ocx-color-accent-hover);
}

/* Responsive columns — plan_site_redesign.md WP-D responsive contract:
   rail right 300px >=1200 -> 2-col band above README 640-1199 -> single
   column <640, install-first. */
.detail-columns {
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-areas: 'versions rail' 'readme rail';
  /* 14px row gap = .meta-rail's block-to-block gap, so vertical distance
     between boxes is uniform across both columns (versions→readme left,
     card→card right). Row 1 must hug the versions box (min-content) with
     the 1fr row absorbing the rail's height — the rail spans both rows,
     and with auto rows the grid distributes its height INTO row 1, shoving
     the readme ~100px below a short (collapsed) versions box. */
  grid-template-rows: min-content 1fr;
  gap: var(--ocx-space-5) var(--ocx-space-7);
  align-items: start;
}

.versions-section {
  grid-area: versions;
  display: flex;
  flex-direction: column;
  gap: var(--ocx-space-4);
}

.readme-section {
  grid-area: readme;
}

.detail-rail {
  grid-area: rail;
}

.versions-header {
  display: flex;
  align-items: baseline;
  gap: var(--ocx-space-4);
  flex-wrap: wrap;
}

.versions-title {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg-subtle);
  letter-spacing: 0.06em;
}

.versions-hint {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
}

.versions-card {
  background: var(--ocx-color-surface);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  padding: var(--ocx-space-2) var(--ocx-space-5);
}

@media (max-width: 1199px) {
  .detail-columns {
    grid-template-columns: 1fr;
    grid-template-areas: 'versions' 'rail' 'readme';
    grid-template-rows: auto;
  }

  .detail-rail {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--ocx-space-5);
  }

  .detail-rail > :deep(.rail-block:last-child) {
    grid-column: 1 / -1;
  }
}

/* <640px: install-first — the rail (install card first) leads, then
   versions, then readme. */
@media (max-width: 639px) {
  .detail-page {
    padding: var(--ocx-space-4) var(--ocx-space-4) var(--ocx-space-6);
  }

  .detail-columns {
    grid-template-areas: 'rail' 'versions' 'readme';
    grid-template-rows: auto;
  }

  .detail-rail {
    display: flex;
    flex-direction: column;
  }
}
}
</style>
