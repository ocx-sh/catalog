<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useClipboard, useLocalStorage } from '@vueuse/core'
import { useToast } from '../../composables/useToast'
import { safeHref } from '../../utils/safeHref'
import PlatformMatrix from './PlatformMatrix.vue'
import CopyIcon from '../shared/CopyIcon.vue'
import { SelectRoot, SelectTrigger, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText } from 'reka-ui'
import CopyContextMenu, { buildTagCopyActions, type CopyAction } from '../shared/CopyContextMenu.vue'
import ExternalIcon from '../shared/ExternalIcon.vue'
import { installCommand, useInstallFlavors, type InstallIcon } from '../../composables/useInstallFlavors'
import { parseTag, type VersionTable } from '../../utils/version'
import type { PackageRoot } from '../../composables/usePackageRoot'
import type { ImageIndex } from '../../composables/useImageIndex'
import type { CatalogPackageDetail } from '../../../viewmodel/types.js'

const props = defineProps<{
  root: PackageRoot
  /** `root.name` — already qualified-prefixed (whatever brand token this
   * deployment's own schema uses, see `subsystem-sources.md`'s labels.ts
   * note), safe for CLI command strings directly (unlike CAS URLs). */
  qualifiedName: string
  /** Default row's primary tag (`utils/version.ts`'s `buildVersionTable`
   * output) — `null` when the package has no live tag at all. */
  primaryTag: string | null
  latestVersionLabel: string | null
  activeImageIndex: ImageIndex | null
  /** License/source/revision read off `activeImageIndex`'s own OCI
   * annotations (C-600, `useImageIndex.ts`'s `detail`) — optional since
   * `mountMetaRail()`-style tests predate this prop and a package may have
   * no live tag/image index loaded at all yet. */
  detail?: CatalogPackageDetail
  tagCount: number
  /** Full version table — drives the install card's variant + version
   * selectors (each variant row carries its own alias chain). */
  table: VersionTable
}>()

const emit = defineEmits<{
  /** Fired when the install card's selection lands on a concrete tag —
   * DetailPage swaps the Platforms card's image index to match. */
  'select-tag': [tag: string]
}>()

// Install card selectors (owner spec): variant combo (only when the
// package ships variants) + version combo over the ACTIVE variant's alias
// chain — rolling → major → minor → patch, real tags only. Changing the
// variant swaps the version options (state dependency), re-applying the
// persisted granularity preference against the new chain.

// Reka Select needs string values; the default variant is `null` in the
// table, so it maps to a sentinel.
const DEFAULT_VARIANT = '__default__'
const variantValue = ref(DEFAULT_VARIANT)
const rows = computed(() => props.table.rows)
const activeRow = computed(
  () => rows.value.find(r => (r.variant ?? DEFAULT_VARIANT) === variantValue.value) ?? rows.value[0] ?? null,
)

// Granularity per alias-chain member, derived from the tag itself: depth 0
// is `latest` (default variant) or the bare variant name (rolling); then
// major ("3"), minor ("3.31"), patch ("3.31.7"), and a build/prerelease-
// qualified tag is the fully pinned one. The DEEPEST member of a chain
// always displays as "pinned" regardless of its depth (owner spec: only
// when a build tag exists too does the plain patch tag show as "patch" —
// no duplicate "pinned" labels).
type PinLevel = 'latest' | 'rolling' | 'major' | 'minor' | 'patch' | 'pinned'
const LEVEL_RANK: Record<PinLevel, number> = { latest: 0, rolling: 0, major: 1, minor: 2, patch: 3, pinned: 4 }

function depthLevel(tag: string): PinLevel {
  const parsed = parseTag(tag)
  if (parsed.kind === 'latest') return 'latest'
  if (parsed.kind === 'other') return 'rolling'
  const v = parsed.version
  if (v.minor === null) return 'major'
  if (v.patch === null) return 'minor'
  if (v.prerelease === null && v.build === null) return 'patch'
  return 'pinned'
}

interface VersionOption {
  tag: string
  /** Real depth rank — preference matching works on this. */
  rank: number
  /** Displayed label — the deepest option always reads "pinned". */
  label: PinLevel
}

const versionOptions = computed<VersionOption[]>(() => {
  const opts = (activeRow.value?.aliasChain ?? []).map((m) => {
    const level = depthLevel(m.tag)
    return { tag: m.tag, rank: LEVEL_RANK[level], label: level }
  })
  if (opts.length) {
    const deepest = opts.reduce((a, b) => (b.rank >= a.rank ? b : a))
    deepest.label = 'pinned'
  }
  return opts
})

const selectedTag = ref<string | null>(null)

// Persisted preference stores the LEVEL, not a tag — tags are package-
// specific. Applied post-mount (SSR and first client render agree), on
// client-side package navs (component instance is reused), and on variant
// switches. A chain lacking the preferred level falls back to its own
// depth-0 entry ('rolling' counts as 'latest' and vice versa — both mean
// "track the newest").
const pinPreference = useLocalStorage<PinLevel>('ocx-install-pin', 'latest')

function applyPinPreference() {
  const opts = versionOptions.value
  if (!opts.length) {
    selectedTag.value = activeRow.value?.primaryTag ?? null
    return
  }
  // Most-fitting match by depth rank: nearest to the preferred level, ties
  // resolved toward the deeper option (a "pinned" preference on a chain
  // ending at patch still lands on that deepest tag; a "patch" preference
  // with no patch tag prefers the pinned build over the looser minor).
  const target = LEVEL_RANK[pinPreference.value]
  const best = [...opts].sort(
    (a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target) || b.rank - a.rank,
  )[0]!
  selectedTag.value = best.tag
}

onMounted(applyPinPreference)
watch(() => props.qualifiedName, () => {
  variantValue.value = DEFAULT_VARIANT
  applyPinPreference()
})
watch(variantValue, applyPinPreference)

// User-initiated version pick — the ONLY place the preference is written
// (the programmatic fallback in applyPinPreference must never overwrite a
// stored preference with its degraded choice).
function onVersionPick(tag: unknown) {
  if (typeof tag !== 'string' || !tag) return
  selectedTag.value = tag
  // Store the DISPLAYED label (deepest = 'pinned'), so "always the most
  // precise" round-trips as intent, not as a package-specific depth.
  const picked = versionOptions.value.find(o => o.tag === tag)
  if (picked) pinPreference.value = picked.label
}

watch(selectedTag, (tag) => {
  if (tag) emit('select-tag', tag)
})

const showSelectors = computed(() => versionOptions.value.length > 1 || rows.value.length > 1)

// Context-menu target = the same tag the card currently denotes.
const effectiveTag = computed(() => selectedTag.value ?? props.primaryTag)

// The theme's fixed install flavors.
const flavors = useInstallFlavors()

const menuActions = computed<CopyAction[]>(() =>
  effectiveTag.value ? buildTagCopyActions(props.qualifiedName, effectiveTag.value, flavors.value) : [],
)

// What the install commands operate on: bare qualified name when tracking
// `latest` (matches `ocx add <name>` semantics), `name:tag` otherwise.
const installTarget = computed(() => {
  const tag = effectiveTag.value
  if (!tag) return null
  return tag === 'latest' ? props.qualifiedName : `${props.qualifiedName}:${tag}`
})

interface InstallRowDef {
  /** Per-row copied-feedback key — the flavor's position, since two flavors
   * may legitimately share a label. */
  key: string
  icon: InstallIcon
  title: string
  command: string
}

// One row per install flavor (icon column | command bar) — owner spec:
// grid, not a toggle. Icon meanings match CopyContextMenu's action icons.
const installRows = computed<InstallRowDef[]>(() => {
  const target = installTarget.value
  if (!target) return []
  return flavors.value.map((flavor, i) => ({
    key: String(i),
    icon: flavor.icon,
    title: flavor.label,
    command: installCommand(flavor.command, target),
  }))
})

// Per-row copied feedback — a single shared flag would flash every bar at
// once, so track which row copied last.
const { copy: clipboardCopy } = useClipboard()
const { toast } = useToast()
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyRow(key: string, text: string) {
  await clipboardCopy(text)
  copiedKey.value = key
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedKey.value = null
  }, 1500)
}

const owners = computed(() => props.root.owners)

// Owner profile links are a FIXED `https://github.com/<owner>` prefix
// around wire-sourced `owner.github` text, not a raw wire URL — low risk
// (the scheme/host are never attacker-controlled), but routed through
// `safeHref` anyway for consistency with every other wire-adjacent href on
// this page (C-605) rather than being the one exception.
function ownerHref(owner: { github: string }): string | null {
  return safeHref(`https://github.com/${owner.github}`)
}

// `upstream.repository_url` is third-party metadata (wire-sourced, not
// authored here) — allowlist the scheme before it ever reaches an `:href`
// (CWE-79 guard, see `utils/safeHref.ts`). `null` degrades to plain text.
const safeUpstreamUrl = computed(() => safeHref(props.root.upstream?.repository_url))

// `source` = the repo whose CI built the artifacts. Two independent
// readings of the SAME underlying annotation, preferred in order:
// `root.source` (bot-derived at index-build time from the latest live tag,
// already on the wire root) falls back to `detail.sourceRepository` (C-600
// — THIS renderer's own read of `activeImageIndex`'s OCI annotations,
// `useImageIndex.ts`'s `readImageIndexAnnotations`) — closes the gap where
// an index never populated (or omits) its own `source` field but the
// underlying OCI annotation is still directly readable from the CAS bytes
// this renderer already fetched. A different thing from `upstream` above
// (the vendor a mirror attributes) — hence its own row, its own label, its
// own tooltip. Registry-sourced URL text either way, so the same CWE-79
// guard applies; unlike `upstream` there is no org name to degrade to, so
// an unsafe value drops the whole row rather than printing the raw string.
const safeSourceUrl = computed(() => safeHref(props.root.source ?? props.detail?.sourceRepository ?? null))
</script>

<template>
  <div class="meta-rail">
    <div class="rail-block">
      <div class="rail-header">
        <span class="rail-heading">INSTALL</span>
      </div>
      <div class="rail-card">
        <div v-if="installRows.length" class="install-toggle-wrap">
          <!-- Icon + combo per dimension; labels stay short, each dropdown
               row shows the real tag dimmed beside its granularity label. -->
          <div v-if="showSelectors" class="install-selects">
            <template v-if="rows.length > 1">
              <span class="install-select-icon" title="Variant">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
              </span>
              <SelectRoot :model-value="variantValue" @update:model-value="v => { if (typeof v === 'string') variantValue = v }">
                <SelectTrigger class="pin-trigger" aria-label="Variant">
                  <span class="pin-trigger-label">{{ activeRow?.label ?? 'default' }}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent class="pin-dropdown" position="popper" :side-offset="6" align="start">
                    <SelectViewport>
                      <SelectItem v-for="row in rows" :key="row.label" :value="row.variant ?? DEFAULT_VARIANT" class="pin-item">
                        <SelectItemText>{{ row.label }}</SelectItemText>
                      </SelectItem>
                    </SelectViewport>
                  </SelectContent>
                </SelectPortal>
              </SelectRoot>
            </template>
            <span class="install-select-icon" title="Version">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
            </span>
            <SelectRoot :model-value="selectedTag ?? ''" @update:model-value="onVersionPick">
              <SelectTrigger class="pin-trigger" aria-label="Version">
                <span class="pin-trigger-label">{{ versionOptions.find(o => o.tag === selectedTag)?.label ?? selectedTag ?? '—' }}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent class="pin-dropdown" position="popper" :side-offset="6" align="start">
                  <SelectViewport>
                    <SelectItem v-for="opt in versionOptions" :key="opt.tag" :value="opt.tag" class="pin-item">
                      <SelectItemText>{{ opt.label }}</SelectItemText>
                      <span v-if="opt.tag !== 'latest'" class="pin-item-tag">:{{ opt.tag }}</span>
                    </SelectItem>
                  </SelectViewport>
                </SelectContent>
              </SelectPortal>
            </SelectRoot>
          </div>
          <div class="install-grid" :class="{ 'with-divider': showSelectors }">
            <template v-for="row in installRows" :key="row.key">
              <span class="install-icon" :title="row.title">
                <svg v-if="row.icon === 'project'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                <svg v-else-if="row.icon === 'global'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                <svg v-else-if="row.icon === 'exec'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </span>
              <CopyContextMenu :actions="menuActions" :copy-text="text => copyRow(row.key, text)">
                <button
                  type="button"
                  class="install-command"
                  :class="{ copied: copiedKey === row.key, deemphasized: root.status === 'deprecated' }"
                  :title="`${row.title} — click to copy · right-click for more`"
                  @click="copyRow(row.key, row.command); toast(`Copied — ${row.title}`)"
                >
                  <span class="install-prefix">$</span>
                  <span class="install-cmd">{{ row.command }}</span>
                  <CopyIcon :copied="copiedKey === row.key" />
                </button>
              </CopyContextMenu>
            </template>
          </div>
        </div>
        <p v-else class="rail-empty">No installable version.</p>
      </div>
    </div>

    <div class="rail-block">
      <div class="rail-header">
        <span class="rail-heading">PLATFORMS</span>
      </div>
      <div class="rail-card">
        <PlatformMatrix :platforms="activeImageIndex?.manifests ?? []" />
      </div>
    </div>

    <div class="rail-block">
      <div class="rail-header">
        <span class="rail-heading">METADATA</span>
      </div>
      <div class="rail-card">
        <div class="metadata-rows">
          <div class="metadata-row">
            <span class="metadata-key">registry</span>
            <!-- Physical address (the logical one lives on the name badge) —
                 click-to-copy like every other identifier on this page.
                 Copies WITHOUT the wire `oci://` scheme: ocx (and docker/
                 oras/crane) take bare registry/repo refs; the display keeps
                 the scheme because that is the verbatim wire field. -->
            <button
              type="button"
              class="metadata-value truncate metadata-copy"
              title="Click to copy physical registry address (without oci://)"
              @click="clipboardCopy(root.repository.replace(/^oci:\/\//, '')); toast('Copied — registry address')"
            >{{ root.repository }}</button>
          </div>
          <div v-if="safeSourceUrl" class="metadata-row">
            <span class="metadata-key" title="Repository whose CI built these artifacts">source</span>
            <a class="metadata-value truncate link metadata-external" :href="safeSourceUrl" target="_blank" rel="noopener noreferrer">{{ safeSourceUrl }}<ExternalIcon /></a>
          </div>
          <!-- C-600: `detail.license` — the OCI `org.opencontainers.image.
               licenses` annotation read off the currently-loaded image
               index (`useImageIndex.ts`'s `readImageIndexAnnotations`).
               Plain text (an SPDX expression string, not a URL). -->
          <div v-if="detail?.license" class="metadata-row">
            <span class="metadata-key">license</span>
            <span class="metadata-value plain">{{ detail.license }}</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-key">owners</span>
            <span class="metadata-value">
              <a v-for="(owner, i) in owners" :key="owner.github" :href="ownerHref(owner)" target="_blank" rel="noopener noreferrer">
                @{{ owner.github }}<template v-if="i < owners.length - 1">, </template>
              </a>
            </span>
          </div>
          <div v-if="root.upstream" class="metadata-row">
            <span class="metadata-key">upstream</span>
            <a v-if="safeUpstreamUrl" class="metadata-value metadata-external" :href="safeUpstreamUrl" target="_blank" rel="noopener noreferrer">{{ root.upstream.org }}<ExternalIcon /></a>
            <span v-else class="metadata-value">{{ root.upstream.org }}</span>
          </div>
          <div v-if="latestVersionLabel" class="metadata-row">
            <span class="metadata-key">latest</span>
            <span class="metadata-value plain">{{ latestVersionLabel }}</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-key">tags</span>
            <span class="metadata-value plain">{{ tagCount }}</span>
          </div>
          <div v-if="root.desc?.keywords?.length" class="metadata-row">
            <span class="metadata-key">keywords</span>
            <span class="metadata-value plain keyword-chips">
              <a
                v-for="kw in root.desc.keywords"
                :key="kw"
                class="keyword-chip"
                :href="`/?q=${encodeURIComponent(kw)}`"
                :title="`search packages: ${kw}`"
              >{{ kw }}</a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@layer ocx {
.meta-rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Header OUTSIDE the box — mirrors the left column's versions-header /
   versions-card split (DetailPage.vue) so the two columns' first boxes
   line up: same header font-size + same 10px header-to-box gap on both
   sides (user finding: rail cards should match the left column's style,
   and the two first boxes should align vertically). */
.rail-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-header {
  display: flex;
  align-items: baseline;
}

.rail-card {
  background: var(--ocx-color-surface);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-heading {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: 600;
  color: var(--ocx-color-fg-subtle);
  letter-spacing: 0.06em;
}

.rail-empty {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-subtle);
  margin: 0;
}

.install-toggle-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* icon | combo rows — same two-column rhythm as .install-grid below. */
.install-selects {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  align-items: center;
}

.install-select-icon {
  display: flex;
  align-items: center;
  color: var(--ocx-color-fg-subtle);
}

.pin-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: 500;
  line-height: 1;
  color: var(--ocx-color-fg);
  background: var(--ocx-color-surface-subtle);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  padding: 0 9px;
  cursor: pointer;
  transition: border-color 0.15s;
  outline: none;
}

.pin-trigger:hover,
.pin-trigger:focus-visible {
  border-color: var(--ocx-color-accent);
}

.pin-trigger svg {
  color: var(--ocx-color-fg-subtle);
  flex-shrink: 0;
}

.pin-trigger-label {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Owner spec: horizontal rule between the selectors and the command grid. */
.install-grid.with-divider {
  border-top: 1px solid var(--ocx-color-border);
  padding-top: 12px;
}

.install-grid {
  display: grid;
  /* Icon column | command bar. CopyContextMenu's trigger is renderless
     (`as-child`), so the slotted .install-command is the grid item itself.
     Column gap matches .rail-card's 16px horizontal padding so the icon
     sits visually centered between the card's left border and the bar. */
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  align-items: stretch;
}

.install-icon {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: var(--ocx-color-fg-subtle);
}

.install-grid .install-command {
  width: auto;
  min-width: 0;
}

.install-command {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: var(--ocx-color-surface-subtle);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  padding: 7px 10px;
  font-family: var(--ocx-font-mono);
  cursor: pointer;
  transition: border-color 0.15s;
  text-align: left;
}

.install-command:hover,
.install-command:focus-visible {
  border-color: var(--ocx-color-accent);
}

.install-command.deemphasized {
  opacity: 0.75;
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

.install-command svg {
  flex-shrink: 0;
  color: var(--ocx-color-fg-subtle);
}

.install-command.copied {
  border-color: var(--ocx-color-success);
}

.install-command.copied .install-cmd {
  color: var(--ocx-color-success);
}

.install-command.copied svg {
  color: var(--ocx-color-success);
}

.metadata-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
}

.metadata-row {
  display: flex;
  gap: 8px;
}

.metadata-key {
  color: var(--ocx-color-fg-subtle);
  width: 74px;
  flex-shrink: 0;
}

/* WP6: --ocx-color-accent-fg, not --ocx-color-accent — 2.99:1 on --ocx-color-surface (the
 * `owners`/`upstream` links; `.truncate.link` below repeats the swap for
 * the `source` link, which a more specific `.truncate` rule would
 * otherwise re-color). */
.metadata-value {
  color: var(--ocx-color-accent-fg);
  min-width: 0;
}

.metadata-value.plain {
  color: var(--ocx-color-fg);
}

.metadata-value.truncate {
  color: var(--ocx-color-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Truncated *and* clickable (the source row) — keep the link color the
   `registry` row's plain treatment would otherwise override. */
.metadata-value.truncate.link {
  color: var(--ocx-color-accent-fg);
}

.metadata-copy {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.metadata-copy:hover,
.metadata-copy:focus-visible {
  color: var(--ocx-color-accent);
  outline: none;
}

.metadata-external {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.metadata-external svg {
  flex-shrink: 0;
}

/* Full keyword list lives here — cards show only a top-3 cut (PackageCard).
   Same chip tokens as .card-keyword. */
.keyword-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
}

.keyword-chip {
  font-size: var(--ocx-text-2xs);
  font-weight: 500;
  color: var(--ocx-color-keyword);
  background: var(--ocx-color-keyword-tint);
  padding: 2px 7px;
  border-radius: var(--ocx-radius-sm);
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.keyword-chip:hover {
  border-color: var(--ocx-color-keyword);
}
}
</style>

<style>
@layer ocx {
/* Unscoped — SelectContent portals to <body> (same reasoning as
 * .copy-ctx-menu). Own class names rather than reusing CatalogPage's
 * .sort-dropdown: that unscoped block only ships with the catalog chunk. */
.pin-dropdown {
  min-width: 180px;
  padding: 0.35rem;
  background: var(--ocx-color-surface);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-lg);
  z-index: 100;
  animation: copy-ctx-fade-in 0.12s ease-out;
}

.pin-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.45rem 0.6rem;
  border-radius: var(--ocx-radius-sm);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-muted);
  cursor: pointer;
  outline: none;
  transition: background 0.1s, color 0.1s;
}

.pin-item:hover,
.pin-item[data-highlighted] {
  background: var(--ocx-color-surface-subtle);
  color: var(--ocx-color-accent);
}

.pin-item[data-state='checked'] {
  color: var(--ocx-color-accent);
}

.pin-item-tag {
  margin-left: auto;
  font-size: var(--ocx-text-2xs);
  color: var(--ocx-color-fg-subtle);
}
}
</style>
