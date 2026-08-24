<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import Logo from '../layout/Logo.vue'
import { isExternalLink } from '../../utils/dom'

// C-602: this component used to hardcode a `github.com/ocx-sh/ocx` issue
// CTA and a `/docs/how-to/announce-a-package` mirror-contribution link —
// both ocx-sh/index-specific (the latter assumes a docs page that ships
// with THAT deployment's own docs content, which this renderer never
// bundles). Neither is "what a corporate mirror configured" (S-01), so both
// are replaced by the SAME `nav[]` config surface `SiteHeader.vue`/
// `SiteFooter.vue` already render — omitted entirely when unset, never a
// baked-in ocx-sh URL.
interface EmptyStateNavItem { text: string, link: string }
const { theme } = useData()
const navItems = computed(() => (theme.value.nav ?? []) as EmptyStateNavItem[])

defineProps<{
  variant: 'no-data' | 'no-match' | 'error'
  /** Only meaningful for `no-match` — the query that produced zero results. */
  query?: string
  /** Only meaningful for `no-match` — total catalog size for the hint copy. */
  total?: number
  /** Only meaningful for `error` (C-604) — `useCatalog()`'s own `error`
   * message, distinguishing a genuine broken-deploy fetch failure from a
   * real empty index (never "no packages published yet" for a 5xx/network/
   * malformed response — S-02). */
  errorMessage?: string | null
}>()

defineEmits<{ 'clear-search': [], retry: [] }>()
</script>

<template>
  <div class="empty-state">
    <template v-if="variant === 'no-data'">
      <Logo class="empty-logo" />
      <span class="empty-title">No packages published yet</span>
      <p class="empty-copy">
        The index is live but the first seeds haven't landed.
      </p>
      <div v-if="navItems.length" class="empty-ctas">
        <a
          v-for="item in navItems"
          :key="item.link"
          :href="item.link"
          :target="isExternalLink(item.link) ? '_blank' : undefined"
          :rel="isExternalLink(item.link) ? 'noopener noreferrer' : undefined"
          class="cta-secondary"
        >{{ item.text }}</a>
      </div>
    </template>
    <template v-else-if="variant === 'no-match'">
      <span class="empty-title">No matches for &ldquo;{{ query }}&rdquo;</span>
      <p class="empty-copy">Check the spelling or drop a filter — {{ total }} packages total.</p>
      <div class="empty-ctas">
        <button type="button" class="cta-outline" @click="$emit('clear-search')">clear search</button>
        <a
          v-for="item in navItems"
          :key="item.link"
          :href="item.link"
          :target="isExternalLink(item.link) ? '_blank' : undefined"
          :rel="isExternalLink(item.link) ? 'noopener noreferrer' : undefined"
          class="cta-ghost"
        >{{ item.text }}</a>
      </div>
    </template>
    <!-- C-604: a genuine fetch failure (5xx/network/malformed
         catalog.json), distinct from a real empty index — S-02. -->
    <template v-else>
      <span class="empty-title">Failed to load the catalog</span>
      <p class="empty-copy">{{ errorMessage ?? 'Something went wrong fetching package data.' }} Try reloading.</p>
      <div class="empty-ctas">
        <button type="button" class="cta-outline" @click="$emit('retry')">try again</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
@layer ocx {
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ocx-space-3);
  padding: 44px 28px;
  text-align: center;
}

.empty-logo {
  width: 44px;
  height: 44px;
  opacity: 0.9;
}

.empty-title {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-lg);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg);
}

.empty-copy {
  margin: 0;
  max-width: 360px;
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-sm);
  line-height: 1.6;
  color: var(--ocx-color-fg-muted);
}

.empty-ctas {
  display: flex;
  gap: var(--ocx-space-2);
  margin-top: 6px;
}

.cta-secondary,
.cta-outline,
.cta-ghost {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: var(--ocx-font-weight-medium);
  border-radius: var(--ocx-radius-md);
  padding: 7px 14px;
  cursor: pointer;
}

.cta-secondary {
  color: var(--ocx-color-fg-muted);
  background: none;
  border: var(--ocx-border-width) solid var(--ocx-color-border);
}

.cta-secondary:hover {
  color: var(--ocx-color-fg);
}

.cta-outline {
  color: var(--ocx-color-accent);
  background: none;
  border: var(--ocx-border-width) solid var(--ocx-color-accent-tint-border);
}

.cta-outline:hover {
  color: var(--ocx-color-accent-hover);
}

.cta-ghost {
  color: var(--ocx-color-fg-muted);
  background: none;
  border: var(--ocx-border-width) solid var(--ocx-color-border);
}

.cta-ghost:hover {
  color: var(--ocx-color-fg);
}
}
</style>
