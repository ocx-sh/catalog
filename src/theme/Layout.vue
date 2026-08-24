<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { useData } from 'vitepress'
import { useToast } from './composables/useToast'
import SiteHeader from './components/layout/SiteHeader.vue'
import SiteFooter from './components/layout/SiteFooter.vue'
import CopyToast from './components/layout/CopyToast.vue'
import CatalogPage from './components/catalog/CatalogPage.vue'
import NotFound from './NotFound.vue'

// C-606 route-level code split: "/" (the catalog grid) is the entry route
// every visitor hits first, so CatalogPage/NotFound stay static/eager — but
// DetailPage, DocLayout, and the ⌘K SearchModal are each only reachable from
// a DIFFERENT route or an explicit user action, so lazy-loading them keeps
// their whole subtree (pre-C-606: 62% of theme source, unreachable from the
// grid) out of the grid's own entry chunk. `test/theme/components/
// layout_route_split_wiring.test.ts` proves both halves of this split: the
// grid still renders synchronously, and the async branches actually resolve
// to real content (not dead code).
const DetailPage = defineAsyncComponent(() => import('./components/detail/DetailPage.vue'))
const DocLayout = defineAsyncComponent(() => import('./components/docs/DocLayout.vue'))
// WP-E additive edit: the ⌘K command palette is global (every page, not
// just docs), so it mounts once here rather than inside DocLayout.vue.
const SearchModal = defineAsyncComponent(() => import('./components/search/SearchModal.vue'))

// Plain v-if dispatch, no global component registration (blank theme —
// see index.mts). SiteHeader always renders, including on the 404 page.
const { page, frontmatter } = useData()

// Docs fences' copy button is VitePress-injected with its own global copy
// handler — this delegated listener only adds the semantic toast on top.
const { toast } = useToast()

function onDocsCopyClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest?.('.docs-prose button.copy')) {
    toast('Copied — code block')
  }
}

onMounted(() => document.addEventListener('click', onDocsCopyClick))
onUnmounted(() => document.removeEventListener('click', onDocsCopyClick))
</script>

<template>
  <div class="theme-shell">
    <!-- C-607: WCAG 2.4.1 skip link — the theme replaced VitePress's own
         default Layout and lost its built-in one. `#main-content` is the id
         every page's own <main> (or NotFound's root) carries. -->
    <a href="#main-content" class="skip-link">Skip to content</a>
    <SiteHeader />
    <NotFound v-if="page.isNotFound" />
    <CatalogPage v-else-if="frontmatter.layout === 'catalog'" />
    <DetailPage v-else-if="frontmatter.layout === 'detail'" />
    <DocLayout v-else />
    <SiteFooter />
    <SearchModal />
    <CopyToast />
  </div>
</template>

<style scoped>
@layer ocx {
.theme-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.skip-link {
  position: absolute;
  top: -48px;
  left: 8px;
  z-index: 300;
  padding: 8px 14px;
  background: var(--ocx-color-surface);
  color: var(--ocx-color-fg);
  border: 1px solid var(--ocx-color-border);
  border-radius: var(--ocx-radius-md);
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-sm);
  transition: top 0.15s;
}

.skip-link:focus-visible {
  top: 8px;
}
}
</style>
