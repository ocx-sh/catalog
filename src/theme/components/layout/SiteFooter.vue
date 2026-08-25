<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useData } from 'vitepress'
import { useCatalog } from '../../composables/useCatalog'
import { isExternalLink } from '../../utils/dom'

// Site-wide footer (owner finding, grimoire-index precedent): policy line +
// raw-data pointer + the catalog freshness stamp, which lived awkwardly in
// the catalog meta row before. Lazy consumer of useCatalog like the command
// palette — one tiny module-cached JSON fetch, shared with CatalogPage.
const { catalog, load } = useCatalog()

// C-602: the footer used to hardcode a `github.com/ocx-sh/index` link, then
// a hardcoded `/docs/privacy` anchor on top of it — both this deployment's
// OWN identity, not this renderer's to assume. The first fix read
// `theme.nav` (the SAME config surface `SiteHeader.vue` renders) to avoid
// assuming the deployment's identity; a dedicated `footer.links[]` key
// (`theme.footer`) serves that better than borrowing the header's nav — the
// footer's own link set isn't the header's, and a mirror that configures
// `nav[]` for its header shouldn't be forced to show those same links in
// its footer too. A mirror that configures no `footer` gets no extra
// footer links at all, rather than links (or a privacy page) it never set.
interface FooterNavItem { text: string, link: string }
const { theme } = useData()
const footerLinks = computed(() => (theme.value.footer?.links ?? []) as FooterNavItem[])

// Owner finding: this pointed at `/c/index.json`, which is the ROOT source's
// own wire enumeration — so it 404s on any deployment whose sources are all
// non-root (their trees mirror to `/index/<label>/` only), and it can 404
// even WITH a root source, since `c/index.json` is optional per source
// (`sources/path.ts` copies it only when present). `/data/catalog/catalog.json`
// is this renderer's own emitted view model: always written, always at that
// one path, and it covers EVERY configured index rather than one of them —
// which is what a site-wide footer link should point at. A per-index wire
// pointer belongs next to the index tabs, not here.
//
// Labelled `catalog json`, not `raw data`. `product-context.md`'s ownership
// table puts `/data/catalog/catalog.json` in the surface THIS package owns
// and is free to evolve between versions, while the frozen wire contract is
// the `/p/**` tree. "Raw data" in a catalog rendered over an index reads as
// the latter, so anyone scraping or bookmarking it would be relying on the
// half that moves. The `title` says which one it is rather than leaving the
// reader to find out at upgrade time.

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
        <a
          href="/data/catalog/catalog.json"
          title="This site's own rendered view model — not the index wire format"
        >catalog json</a>
        <template v-for="item in footerLinks" :key="item.link">
          ·
          <a
            :href="item.link"
            :target="isExternalLink(item.link) ? '_blank' : undefined"
            :rel="isExternalLink(item.link) ? 'noopener noreferrer' : undefined"
          >{{ item.text }}</a>
        </template>
      </span>
      <span v-if="updatedLabel" class="footer-note">updated {{ updatedLabel }}</span>
    </div>
  </footer>
</template>

<style scoped>
@layer ocx {
/* No margin-top: pages own their bottom padding, and the docs sidebar's
 * right border must run straight into this border-top (owner finding —
 * a gap between the two reads as the divider stopping short). */
.site-footer {
  border-top: var(--ocx-border-width) solid var(--ocx-color-border);
}

.footer-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--ocx-space-4) var(--ocx-space-6);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ocx-space-3);
  flex-wrap: wrap;
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  color: var(--ocx-color-fg-subtle);
}

.footer-inner a {
  color: var(--ocx-color-fg-muted);
}

.footer-inner a:hover {
  color: var(--ocx-color-accent);
}
}
</style>
