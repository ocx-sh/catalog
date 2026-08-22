import type { Theme } from 'vitepress'

// Self-hosted IBM Plex — design mock 1h: sans carries titles/prose (needs
// the full 400-700 range), mono carries every identifier/version/label/
// command and is NEVER bold display text, so its heaviest shipped weight
// stops at 600 (never import ibm-plex-mono/700.css).
//
// ponytail: each `@fontsource/*` weight CSS below ships BOTH `.woff2` and
// `.woff` `url()`s per subset in its `@font-face` `src:` list — every
// browser this ESM VitePress 2 build targets picks woff2 (first in the
// list), so the `.woff` siblings are dead weight in the emitted `dist/`
// (never fetched over the wire, just wasted deploy bytes). Not pruned here:
// @fontsource 5.x ships no woff2-only entry point (verified against the
// installed package — every `NNN.css` bundles both formats, no per-format
// variant), so removing the fallback would mean hand-authoring a hand-rolled
// fork of this vendored, generated CSS (quality-core.md "Don't Own
// Non-Domain Code" — six unicode-range subsets × seven weights of
// `@font-face` rules to keep byte-accurate against upstream), which is a
// worse trade than the dead deploy bytes it would save. Upgrade path: a
// `vite.config`-level asset filter (`build.rollupOptions` / a small plugin
// stripping `format('woff')` alternatives at build time) if the shipped
// `dist/` size becomes an actual budget problem — that lives in
// `src/build/**`, out of this theme-only change's scope.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'

import './styles/base.css'

import Layout from './Layout.vue'

// Blank custom theme (no `extends: DefaultTheme`) — core still supplies the
// pre-hydration `appearance` dark-class script, writable `isDark`,
// `page.headers`, free-form `themeConfig`, `<Content/>` and dynamic-route
// `params`; everything visual is this theme's own (Layout.vue + styles/).
export default {
  Layout,
  enhanceApp() {},
} satisfies Theme
