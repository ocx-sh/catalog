<script setup lang="ts">
import { computed } from 'vue'
import { assertSafePackagePath } from '../../../viewmodel/catalog.js'

// DetailPage owns the `v-if="root.status === 'deprecated'"` gate.
const props = defineProps<{
  message: string | null
  /** Bare `<ns>/<pkg>` (never `ocx.sh/`-prefixed — schema:
   * `root.schema.json`'s `superseded_by`). */
  supersededBy: string | null
}>()

// C-605: `supersededBy` is wire data interpolated into `/${supersededBy}`
// below, where it becomes a same-tab `:href` — so a value that resolves OFF
// the current origin or UP the path must never reach that sink; it degrades
// to plain text instead. The loose `/^[^/]+(?:\/[^/]+)+$/` this replaced let
// a BACKSLASH through: `\evil.com/x` rendered `/\evil.com/x`, and browsers
// apply the WHATWG special-scheme "authority ignores slashes" rule (`/\` ==
// `//`) to navigate to https://evil.com/x — a CWE-601 open redirect
// (`new URL("/\\evil.com/x", base)` === `https://evil.com/x`). Whitespace and
// `.`/`..` traversal segments slipped through the same way.
//
// Rather than hand-roll a second, driftable allowlist, validate against
// `viewmodel/catalog.ts`'s `assertSafePackagePath` — the ONE grammar that
// decides whether a bare `<ns>/<pkg>` reference is a real, path-safe package
// id (the same check `casRelpath` gates every CAS URL/path join with, so
// there is no second definition to drift from the wire contract). `ns` is the
// first segment and `pkg` the depth-N remainder, matching `DetailPage.vue`'s
// own route-identity split. It throws on any bad segment — a backslash,
// whitespace, an empty/leading segment, a `.`/`..` traversal, or anything
// outside the lowercase `[a-z0-9._-]` package charset — so a throw means
// "render text", the same "null on failure, caller renders text" shape
// `safeHref.ts` uses for wire-sourced URLs.
function safeSupersededByPath(value: string): string | null {
  const slash = value.indexOf('/')
  if (slash < 1) return null
  try {
    assertSafePackagePath(value.slice(0, slash), value.slice(slash + 1))
    return value
  } catch {
    return null
  }
}
const safeSupersededBy = computed(() =>
  props.supersededBy === null ? null : safeSupersededByPath(props.supersededBy),
)
</script>

<template>
  <div class="deprecation-banner">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="deprecation-icon">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="deprecation-text">
      <strong>Deprecated</strong>
      <template v-if="supersededBy">
        — superseded by
        <a v-if="safeSupersededBy" :href="`/${safeSupersededBy}`">{{ supersededBy }}</a><template v-else>{{ supersededBy }}</template>.
      </template>
      <template v-if="message"> {{ message }}</template>
      <template v-else> Existing versions remain installable; no new releases will be mirrored.</template>
    </span>
  </div>
</template>

<style scoped>
@layer ocx {
.deprecation-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--ocx-space-4);
  background: color-mix(in srgb, var(--ocx-color-accent) 10%, transparent);
  border: var(--ocx-border-width) solid color-mix(in srgb, var(--ocx-color-accent) 45%, transparent);
  border-radius: var(--ocx-radius-lg);
  padding: var(--ocx-space-4) var(--ocx-space-5);
}

.deprecation-icon {
  color: var(--ocx-color-accent-hover);
  flex-shrink: 0;
  margin-top: var(--ocx-space-1);
}

.deprecation-text {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-sm);
  line-height: 1.55;
  color: var(--ocx-color-fg);
}

/* WP6: --ocx-color-accent-fg, not --ocx-color-accent — this banner's own 10%-accent-tint
 * background was the WORST case that sized --ocx-color-accent-fg (2.51:1 here).
 * Underline: this "superseded by" link sits inline in a prose sentence
 * (`.deprecation-text`) next to --ocx-color-fg body text — axe's
 * link-in-text-block wants EITHER >=3:1 link-vs-surrounding-text contrast
 * OR a non-color cue; --ocx-color-accent-fg vs --ocx-color-fg is only 2.99:1, so this
 * needs the underline (matches ReadmePane's/docs-prose's own prose links). */
.deprecation-text a {
  color: var(--ocx-color-accent-fg);
  text-decoration: underline;
}

.deprecation-text a:hover {
  color: var(--ocx-color-accent-hover);
}
}
</style>
