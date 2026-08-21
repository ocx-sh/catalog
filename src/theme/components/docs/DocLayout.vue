<script setup lang="ts">
import { Content, useData } from 'vitepress'
import DocsSidebar from './DocsSidebar.vue'
import DocsMobileNav from './DocsMobileNav.vue'
import OnThisPage from './OnThisPage.vue'

// Design mock 1f: 250px sidebar | 720px-max prose | 180px outline.
// Outline collapses below 1200px; sidebar + outline both fold into
// DocsMobileNav.vue's drawer below 640px (see that component's own
// breakpoint — it self-hides via CSS, this layout doesn't gate it).
const { page } = useData()
</script>

<template>
  <div class="doc-layout">
    <aside class="doc-sidebar">
      <DocsSidebar />
    </aside>
    <main class="doc-prose-col">
      <div class="docs-prose">
        <Content />
      </div>
    </main>
    <aside class="doc-outline">
      <OnThisPage :headers="page.headers" />
    </aside>
    <DocsMobileNav :headers="page.headers" />
  </div>
</template>

<style scoped>
.doc-layout {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.doc-sidebar {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid var(--c-line);
  position: sticky;
  top: 54px;
  align-self: stretch;
  overflow-y: auto;
}

.doc-prose-col {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  padding: 32px 40px 64px;
}

.docs-prose {
  width: 100%;
  max-width: 720px;
}

.doc-outline {
  width: 180px;
  flex-shrink: 0;
  padding: 36px 24px 0;
  position: sticky;
  top: 54px;
  align-self: flex-start;
}

@media (max-width: 1199px) {
  .doc-outline {
    display: none;
  }
}

@media (max-width: 639px) {
  .doc-sidebar {
    display: none;
  }

  .doc-prose-col {
    padding: 24px 20px 80px;
  }
}
</style>
