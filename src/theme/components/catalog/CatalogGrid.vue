<template>
  <ul class="catalog-grid">
    <slot />
  </ul>
</template>

<style scoped>
@layer ocx {
/* C-607: real list semantics (`<ul>`) — callers wrap each item in an `<li>`
 * (`display: contents`, see CatalogPage.vue/SkeletonGrid.vue) so the grid
 * item itself is unchanged; this only strips the UA list box/marker. */
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--ocx-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Pinned 2-col band — the mock only shows the ≥1200 desktop grid (1a/1b)
 * and the <640 single column (1g); this mid band is a WP-C addition to
 * keep cards from stretching too wide on tablet-ish viewports. */
@media (max-width: 1199px) and (min-width: 640px) {
  .catalog-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 639px) {
  .catalog-grid {
    grid-template-columns: 1fr;
  }
}
}
</style>
