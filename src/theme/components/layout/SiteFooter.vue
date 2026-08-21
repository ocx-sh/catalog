<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCatalog } from '../../composables/useCatalog'

// Site-wide footer (owner finding, grimoire-index precedent): policy line +
// raw-data pointer + the catalog freshness stamp, which lived awkwardly in
// the catalog meta row before. Lazy consumer of useCatalog like the command
// palette — one tiny module-cached JSON fetch, shared with CatalogPage.
const { catalog, load } = useCatalog()

// Relative-time math reads `Date.now()` — computed post-mount only so SSR
// output and the first client render agree (same pattern as ResultMeta had).
const updatedLabel = ref<string | null>(null)

onMounted(async () => {
  await load()
  const generated = catalog.value.generated
  if (!generated) return
  const then = new Date(generated).getTime()
  if (Number.isNaN(then)) return
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000))
  if (minutes < 1) {
    updatedLabel.value = 'just now'
  } else if (minutes < 60) {
    updatedLabel.value = `${minutes}m ago`
  } else if (minutes < 60 * 24) {
    updatedLabel.value = `${Math.floor(minutes / 60)}h ago`
  } else {
    updatedLabel.value = `${Math.floor(minutes / (60 * 24))}d ago`
  }
})
</script>

<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <span class="footer-links">
        <a href="/c/index.json">raw data</a>
        · <a href="https://github.com/ocx-sh/index" target="_blank" rel="noopener noreferrer">github</a>
        · <a href="/docs/privacy">privacy</a>
      </span>
      <span v-if="updatedLabel" class="footer-note">updated {{ updatedLabel }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* No margin-top: pages own their bottom padding, and the docs sidebar's
 * right border must run straight into this border-top (owner finding —
 * a gap between the two reads as the divider stopping short). */
.site-footer {
  border-top: 1px solid var(--c-line);
}

.footer-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-6);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-3);
}

.footer-inner a {
  color: var(--c-text-2);
}

.footer-inner a:hover {
  color: var(--c-accent);
}
</style>
