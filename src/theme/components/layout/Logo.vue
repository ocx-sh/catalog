<!--
  The site logo: the consumer's own `brand.logo` when configured, otherwise
  the theme's built-in OCX mark. `width`/`height` attributes dropped so
  callers size the mark purely via CSS (`class="brand-logo"` etc. — Vue's
  automatic attribute inheritance merges a caller's `class` onto the single
  rendered root, which a `v-if`/`v-else` pair still is).

  `theme.brand.logo` is a site-root href (`/<file>`) that `config_gen.ts`
  derives from C-002's config-relative `brand.logo` path, copying the file
  into the site's public root — never the raw config value, which no browser
  could fetch. `alt=""`: the mark is decorative, the adjacent wordmark in
  `SiteHeader.vue` already names the site.

  C-606: the built-in mark used to be inlined raw SVG DOM here — 56% of
  every SSR'd page's HTML bytes, repeated on every single page. It now
  lives at `../../assets/ocx-logo.svg` (byte-identical path data) and is
  imported via Vite's `?url` suffix, which emits it ONCE as a real,
  browser-cacheable file (never base64-inlined — see `shims.d.ts`'s own
  docblock) instead of duplicating the markup into every page's markup.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import ocxLogoUrl from '../../assets/ocx-logo.svg?url'

const { theme } = useData()
const logo = computed(() => (theme.value.brand?.logo ?? null) as string | null)
</script>

<template>
  <img v-if="logo" :src="logo" alt="">
  <img v-else :src="ocxLogoUrl" alt="">
</template>
