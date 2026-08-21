<script setup lang="ts">
import { computed } from 'vue'
import { safeHref } from '../../utils/safeHref'
import ExternalIcon from '../shared/ExternalIcon.vue'

// MANDATORY whenever `upstream.disclaimer` is present — a governance
// invariant (adr_namespace_policy.md ND-9), never conditionally hidden.
// DetailPage owns the `v-if="root.upstream?.disclaimer"` gate; this
// component assumes it's always called with a real string.
const props = defineProps<{
  disclaimer: string
  repositoryUrl?: string
}>()

// `repositoryUrl` is third-party wire metadata — allowlist the scheme
// before it reaches an `:href` (CWE-79 guard, see `utils/safeHref.ts`).
// `null` degrades to plain text rather than dropping the line entirely.
const safeRepositoryUrl = computed(() => safeHref(props.repositoryUrl))
</script>

<template>
  <div class="disclaimer-banner">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="disclaimer-icon">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <span class="disclaimer-text">
      {{ disclaimer }}
      <template v-if="repositoryUrl">
        Upstream: <a v-if="safeRepositoryUrl" :href="safeRepositoryUrl" target="_blank" rel="noopener noreferrer" class="disclaimer-link">{{ repositoryUrl.replace(/^https?:\/\//, '') }}<ExternalIcon /></a><span v-else>{{ repositoryUrl.replace(/^https?:\/\//, '') }}</span>
      </template>
    </span>
  </div>
</template>

<style scoped>
/* Compact note, not a boxed alert (owner finding) — warn-colored left bar
 * keeps it noticeable without dominating the page. ND-9 still holds: always
 * rendered, just quieter. */
.disclaimer-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-left: 2px solid var(--c-warn);
  padding: 2px 0 2px 12px;
}

.disclaimer-icon {
  color: var(--c-warn);
  flex-shrink: 0;
  margin-top: 2px;
  width: 13px;
  height: 13px;
}

.disclaimer-text {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--c-text-2);
}

.disclaimer-text a {
  color: var(--c-accent);
}

/* Same external-link glyph as the header's github link (owner spec) —
 * inline-flex keeps it glued to the URL text, no wrap between them. */
.disclaimer-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.disclaimer-link svg {
  flex-shrink: 0;
}

.disclaimer-text a:hover {
  color: var(--c-accent-hover);
}
</style>
