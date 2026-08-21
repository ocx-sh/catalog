<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useData } from 'vitepress'
import { useToast } from './composables/useToast'
import SiteHeader from './components/layout/SiteHeader.vue'
import SiteFooter from './components/layout/SiteFooter.vue'
import CopyToast from './components/layout/CopyToast.vue'
import CatalogPage from './components/catalog/CatalogPage.vue'
import DetailPage from './components/detail/DetailPage.vue'
import DocLayout from './components/docs/DocLayout.vue'
import NotFound from './NotFound.vue'
// WP-E additive edit: the ⌘K command palette is global (every page, not
// just docs), so it mounts once here rather than inside DocLayout.vue.
import SearchModal from './components/search/SearchModal.vue'

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
.theme-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
