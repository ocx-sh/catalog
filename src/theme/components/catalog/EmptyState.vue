<script setup lang="ts">
import { computed } from 'vue'
import Logo from '../layout/Logo.vue'

// CTA targets per plan_site_redesign.md owner decision 6.
const REQUEST_PACKAGE_URL = 'https://github.com/ocx-sh/ocx/issues/new?template=package_request.yml'
const CONTRIBUTE_MIRROR_URL = '/docs/how-to/announce-a-package'

const props = defineProps<{
  variant: 'no-data' | 'no-match'
  /** Only meaningful for `no-match` — the query that produced zero results. */
  query?: string
  /** Only meaningful for `no-match` — total catalog size for the hint copy. */
  total?: number
}>()

defineEmits<{ 'clear-search': [] }>()

const requestQueryUrl = computed(() => {
  const q = props.query?.trim()
  if (!q) return REQUEST_PACKAGE_URL
  return `${REQUEST_PACKAGE_URL}&title=${encodeURIComponent(`Request: ${q}`)}`
})
</script>

<template>
  <div class="empty-state">
    <template v-if="variant === 'no-data'">
      <Logo class="empty-logo" />
      <span class="empty-title">No packages published yet</span>
      <p class="empty-copy">
        The index is live but the first seeds haven't landed. Watch the repo, or bring a mirror of your own.
      </p>
      <div class="empty-ctas">
        <a :href="REQUEST_PACKAGE_URL" target="_blank" rel="noopener noreferrer" class="cta-primary">request a package</a>
        <a :href="CONTRIBUTE_MIRROR_URL" class="cta-secondary">contribute a mirror</a>
      </div>
    </template>
    <template v-else>
      <span class="empty-title">No matches for &ldquo;{{ query }}&rdquo;</span>
      <p class="empty-copy">Check the spelling or drop a filter — {{ total }} packages total.</p>
      <div class="empty-ctas">
        <button type="button" class="cta-outline" @click="$emit('clear-search')">clear search</button>
        <a :href="requestQueryUrl" target="_blank" rel="noopener noreferrer" class="cta-ghost">request &ldquo;{{ query }}&rdquo; →</a>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: 44px 28px;
  text-align: center;
}

.empty-logo {
  width: 44px;
  height: 44px;
  opacity: 0.9;
}

.empty-title {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--c-text-1);
}

.empty-copy {
  margin: 0;
  max-width: 360px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--c-text-2);
}

.empty-ctas {
  display: flex;
  gap: var(--space-2);
  margin-top: 6px;
}

.cta-primary,
.cta-secondary,
.cta-outline,
.cta-ghost {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  border-radius: var(--radius-md);
  padding: 7px 14px;
  cursor: pointer;
}

.cta-primary {
  color: #fff;
  background: var(--c-accent);
  border: 1px solid var(--c-accent);
}

.cta-primary:hover {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
  color: #fff;
}

.cta-secondary {
  color: var(--c-text-2);
  background: none;
  border: 1px solid var(--c-line);
}

.cta-secondary:hover {
  color: var(--c-text-1);
}

.cta-outline {
  color: var(--c-accent);
  background: none;
  border: 1px solid var(--c-accent-tint-border);
}

.cta-outline:hover {
  color: var(--c-accent-hover);
}

.cta-ghost {
  color: var(--c-text-2);
  background: none;
  border: 1px solid var(--c-line);
}

.cta-ghost:hover {
  color: var(--c-text-1);
}
</style>
