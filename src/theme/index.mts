import type { Theme } from 'vitepress'

// Self-hosted IBM Plex — design mock 1h: sans carries titles/prose (needs
// the full 400-700 range), mono carries every identifier/version/label/
// command and is NEVER bold display text, so its heaviest shipped weight
// stops at 600 (never import ibm-plex-mono/700.css).
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
