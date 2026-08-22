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

// Identity comes from the page's own route path, NOT `useData().params`
// (Specify-spike correction — see `pages.ts`'s doc "Passing package
// identity to DetailPage.vue" section): a synthesized package page is a
// plain static file, not a `defineRoutes`/`[param]`-named route, so
// `params` is never populated for it. `relativePath` is exactly the string
// `pages.ts` wrote the file to (e.g. `kitware/cmake.md`), depth-N safe —
// `ns` is always the first segment, `pkg` is every remaining segment
// rejoined (never re-split), matching every existing fetch/CAS URL builder
// below (`${ns}/${pkg}` reproduces the full logical name for any depth).
const { page } = useData()
const segments = computed(() => page.value.relativePath.replace(/\.md$/, '').split('/'))
const ns = computed(() => segments.value[0] ?? '')
const pkg = computed(() => segments.value.slice(1).join('/'))
const bareName = computed(() => `${ns.value}/${pkg.value}`)

const { root, loading, error, notFound } = usePackageRoot(ns, pkg)

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
  if (digest) loadImageIndex(ns.value, pkg.value, digest)
}

function onTagHover(digest: string) {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    loadImageIndex(ns.value, pkg.value, digest)
  }, HOVER_DEBOUNCE_MS)
}

onMounted(() => {
  watch(defaultRow, (row) => {
    if (!row?.primaryTag || !root.value) return
    const digest = root.value.tags[row.primaryTag]?.content
    if (digest) loadImageIndex(ns.value, pkg.value, digest)
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

      <IdentityBlock :root="root" :bare-name="bareName" :latest-version-label="defaultRow?.preciseAliasTag ?? null" />

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

        <ReadmePane class="readme-section" :bare-name="bareName" :digest="root.desc?.readme ?? null" />
      </div>
    </template>
  </main>
</template>

<style scoped>
.detail-page {
  flex: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-5) var(--space-6) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-status {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--c-text-3);
}

.detail-notfound {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 48px 0;
  align-items: center;
  text-align: center;
}

/* WP6: --c-accent-text, not --c-accent — 2.79:1 on --c-bg with the plain
 * accent -> 5.05:1. */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--c-accent-text);
  width: fit-content;
}

.back-link:hover {
  color: var(--c-accent-hover);
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
  gap: 14px var(--space-7);
  align-items: start;
}

.versions-section {
  grid-area: versions;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  gap: 12px;
  flex-wrap: wrap;
}

.versions-title {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--c-text-3);
  letter-spacing: 0.06em;
}

.versions-hint {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--c-text-3);
}

.versions-card {
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  padding: 4px 16px;
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
    gap: 14px;
  }

  .detail-rail > :deep(.rail-block:last-child) {
    grid-column: 1 / -1;
  }
}

/* <640px: install-first — the rail (install card first) leads, then
   versions, then readme. */
@media (max-width: 639px) {
  .detail-page {
    padding: var(--space-4) var(--space-4) var(--space-6);
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
</style>
