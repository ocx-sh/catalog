<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRoute } from 'vitepress'
import Logo from './Logo.vue'
import ThemeToggle from './ThemeToggle.vue'
// WP-E additive edit: header-level ⌘K trigger, so the global palette is
// discoverable from every page (not just the catalog's own inline
// SearchInput, which is WP-C scope).
import { useCommandPalette } from '../../composables/useCommandPalette'
import ExternalIcon from '../shared/ExternalIcon.vue'
import { isExternalLink } from '../../utils/dom'

// WP-10: the fixed skeleton (brand, search, theme toggle) always renders;
// its CONTENT is consumer-config-driven — the wordmark and logo from C-002
// `brand`, the docs link from `docsPresent` (auto), the rest from `nav[]`.
// No dedicated
// `githubUrl` config field — a repo link is just an external `nav[]` entry
// (config_gen.ts bakes `theme.nav`/`theme.docsPresent` verbatim from the
// consumer's `catalog.config.json`).
interface HeaderNavItem {
  text: string
  link: string
}

const { theme } = useData()
const route = useRoute()
const { open: openPalette } = useCommandPalette()

const docsPresent = computed(() => Boolean(theme.value.docsPresent))
const navItems = computed(() => (theme.value.nav ?? []) as HeaderNavItem[])

// Header wordmark: C-002's `brand.wordmark`, falling back to `brand.title`.
// The two are deliberately separate config keys — a deployment's
// `<title>`/`og:site_name` reads as prose ("OCX Index") while its header
// wordmark is usually the host it is served from ("index.ocx.sh"). The
// fallback lives HERE rather than in `config_gen.ts` so a hand-written
// `themeConfig` behaves the same as a generated one.
const wordmark = computed(() => (theme.value.brand?.wordmark ?? theme.value.brand?.title ?? '') as string)

// WP6: `.brand-name` (the wordmark span) is `display: none` under 640px
// (see the media query below) — Lighthouse's default a11y run uses mobile
// emulation, so at that width the link's only remaining content was the
// logo `<img>` (deliberately `alt=""`, decorative — see Logo.vue's own
// docblock), leaving it with NO accessible name (axe `link-name`). An
// `aria-label` on the anchor itself is viewport-independent — it doesn't
// depend on which inline content CSS happens to be hiding — and still
// satisfies WCAG 2.5.3 Label-in-Name since the visible wordmark text (when
// shown) is a verbatim substring of it.
const brandLabel = computed(() => (wordmark.value ? `${wordmark.value} — home` : 'Home'))

function isActive(prefix: string): boolean {
  if (prefix === '/docs/') return route.path.startsWith('/docs/')
  return !route.path.startsWith('/docs/')
}
</script>

<template>
  <header class="site-header" data-slot="site-header">
    <a href="/" class="brand" :aria-label="brandLabel">
      <Logo class="brand-logo" />
      <span class="brand-name">{{ wordmark }}</span>
    </a>
    <!-- Search sits centered and reads like a real input (dimmed
         placeholder + kbd hint) — a bare icon+⌘K in the corner was too
         easy to miss (owner finding). Still a button: it only opens the
         ⌘K palette. -->
    <button type="button" class="search-trigger" aria-label="Search (Ctrl+K)" @click="openPalette">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span class="search-trigger-text">search packages, docs…</span>
      <span class="search-trigger-kbd">⌘K</span>
    </button>
    <span class="header-right">
      <nav class="site-nav">
        <a href="/" class="nav-link" :class="{ active: isActive('/') }">catalog</a>
        <a v-if="docsPresent" href="/docs/" class="nav-link" :class="{ active: isActive('/docs/') }">docs</a>
        <a
          v-for="item in navItems"
          :key="item.link"
          :href="item.link"
          class="nav-link"
          :class="{ 'nav-link-external': isExternalLink(item.link) }"
          :target="isExternalLink(item.link) ? '_blank' : undefined"
          :rel="isExternalLink(item.link) ? 'noopener noreferrer' : undefined"
        >
          {{ item.text }}
          <ExternalIcon v-if="isExternalLink(item.link)" :size="11" />
        </a>
      </nav>
      <span class="nav-divider" />
      <ThemeToggle />
    </span>
  </header>
</template>

<style scoped>
@layer ocx {
.site-header {
  height: var(--ocx-header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--ocx-space-6);
  padding: 0 var(--ocx-space-6);
  border-bottom: var(--ocx-border-width) solid var(--ocx-color-border);
  background: var(--ocx-site-header-background, var(--ocx-color-surface));
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-3);
  color: var(--ocx-color-fg);
}

.brand-logo {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.brand-name {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-base);
  font-weight: var(--ocx-font-weight-semibold);
  color: var(--ocx-color-fg);
}

/* brand (flex 1) | centered search | right zone (flex 1) — equal wings
 * keep the search optically centered. */
.brand {
  flex: 1;
}

.header-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--ocx-space-6);
}

.site-nav {
  display: inline-flex;
  gap: var(--ocx-space-6);
  align-items: center;
}

.nav-link {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  font-weight: var(--ocx-font-weight-medium);
  color: var(--ocx-color-fg-muted);
  padding: var(--ocx-space-5) var(--ocx-space-1) var(--ocx-space-5);
  border-bottom: var(--ocx-border-width-strong) solid transparent;
  white-space: nowrap;
}

/* Proper external-link glyph instead of the "↗" text char (which also
 * line-broke away from "github" on narrow widths). */
.nav-link-external {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-2);
}

.nav-link-external svg {
  color: var(--ocx-color-fg-subtle);
  flex-shrink: 0;
}

.nav-link-external:hover svg {
  color: var(--ocx-color-fg);
}

.nav-link:hover {
  color: var(--ocx-color-fg);
}

/* WP6: text color moves to --ocx-color-accent-fg (2.99:1 on --ocx-color-surface with the
 * plain --ocx-color-accent -> 5.42:1) — the underline stays --ocx-color-accent, a
 * non-text/decorative use excluded from the WCAG text-contrast check. */
.nav-link.active {
  color: var(--ocx-color-accent-fg);
  border-bottom-color: var(--ocx-color-accent);
}

.nav-divider {
  width: 1px;
  height: 20px;
  background: var(--ocx-color-border);
  flex-shrink: 0;
}

.search-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--ocx-space-3);
  width: clamp(220px, 30vw, 360px);
  height: 32px;
  color: var(--ocx-color-fg-subtle);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  padding: 0 var(--ocx-space-4);
  background: var(--ocx-color-surface-subtle);
  cursor: pointer;
  transition: border-color var(--ocx-duration-base), color var(--ocx-duration-base);
}

.search-trigger:hover {
  color: var(--ocx-color-fg);
  border-color: var(--ocx-color-accent);
}

.search-trigger-text {
  flex: 1;
  text-align: left;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-trigger-kbd {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: var(--ocx-font-weight-medium);
  border: var(--ocx-border-width) solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-sm);
  padding: var(--ocx-space-1) var(--ocx-space-2);
  background: var(--ocx-color-surface);
}

@media (max-width: 640px) {
  .site-header {
    gap: var(--ocx-space-4);
    padding: 0 var(--ocx-space-5);
  }

  .brand-name {
    display: none;
  }

  /* Narrow screens: collapse back to a compact icon button, and park it
   * left beside the brand icon instead of floating centered — the brand
   * wing stops flexing so only the right wing absorbs the space. */
  .brand {
    flex: none;
  }

  .search-trigger {
    width: auto;
  }

  .search-trigger-text,
  .search-trigger-kbd {
    display: none;
  }
}
}
</style>
