---
paths:
  - src/theme/**
---

# Theme Subsystem

The VitePress theme (`@ocx-sh/catalog/theme`) — package-internal, never
imported by a consumer directly. `build`/`dev` generate a two-line shim that
re-exports it (`src/build/config_gen.ts`'s `renderThemeShim`).

## Install commands: one source of truth

`src/theme/composables/useInstallFlavors.ts`'s `DEFAULT_INSTALL_FLAVORS` is
the only place a `ocx …` CLI command string may be written. Every
install-command surface (`InstallRow.vue`, `MetaRail.vue`,
`CopyContextMenu.vue`'s `buildTagCopyActions`) builds its text through
`installCommand()`/`useInstallFlavors()` — never a hardcoded string.
`test/theme/components/brand_install_wiring.test.ts` pins this: it greps
component source (comments stripped) for the literal command shapes and
fails if one reappears outside `useInstallFlavors.ts`.

Substitute `{name}` with `split('{name}').join(...)`, never
`replace`/`replaceAll` — a replacement string is `$`-significant
(`$&`, `$1`), and `qualifiedName` is wire data.

## CAS gotcha: route params, never `root.name`

`root.name` carries the brand prefix (`ocx.sh/<ns>/<pkg>`). Every CAS/wire
fetch (`casUrl()`, `usePackageRoot`, `useImageIndex`) must build its URL from
the bare `ns`/`pkg` route params, never from `root.name` — building a CAS URL
from `root.name` 404s. `DetailPage.vue` derives `ns`/`pkg` from
`useData().page.relativePath` (see "Route identity" below), not from a
fetched root field.

## Route identity: `relativePath`, not `useData().params`

A synthesized package page is a plain static file (`src/build/pages.ts`), not
a `defineRoutes`/`[param]`-named dynamic route, so `useData().params` is
never populated for it. `DetailPage.vue` derives `ns`/`pkg` by splitting
`useData().page.relativePath` on `/` — `ns` is the first segment, `pkg` is
every remaining segment rejoined (never re-split), matching depth-N package
paths.

## Theme-aware, not palette-assuming

Every color/spacing/type value is a CSS custom property from
`src/theme/styles/tokens/*.css` (`--c-*`, `--font-*`, `--text-*`,
`--radius-*`, `--space-*`) — components hardcoding a hex value or a pixel
font size outside those tokens are a defect, not a pattern to extend. WP6
(theme a11y pass, 2026-08-22) tokenized the last three: a `font-size: 10px`
each in `FilterChips.vue`, `DocsSidebar.vue`, and `OnThisPage.vue`, now
`var(--text-2xs)`. Dark mode is the `.dark` class VitePress's
own pre-hydration script toggles on `<html>`; `ThemeToggle.vue` writes
`useData().isDark` directly (never a shadow ref) so VitePress core's own
`localStorage` persistence and re-apply-on-load keep working unchanged.

A component that must render structurally identical DOM in both `isDark`
states (so SSR and client hydration agree on shape) uses `v-show`, never
`v-if`/`v-else` — see `ThemeToggle.vue`'s own `ponytail:` comment for the
hydration-mismatch crash this avoids.

## Sanitization boundary (hard rule)

README/desc content from a wire root is untrusted. `src/theme/utils/sanitize.ts`'s
`sanitizeReadmeHtml` is the only chokepoint between markdown-it's render
output and any `v-html` sink (`ReadmePane.vue` is its one caller) — it runs
even though the markdown pipeline already sets `html: false` (raw HTML
escaped, never parsed), as a second independent layer against a config
regression or a future plugin. It is client-only (throws under SSR/no
`window`) rather than silently passing raw HTML through unsanitized.

`src/theme/utils/safeHref.ts`'s `safeHref` allowlists `http:`/`https:` before
any wire-sourced URL (e.g. `upstream.repository_url`) is rendered as an
`:href` — third-party-authored data reaching a DOM sink. A component
rendering an external URL from wire data uses `safeHref` first and falls
back to plain text on `null`, never renders the raw string directly.

Logos are always `<img src="…">`, never inlined raw SVG DOM — an
`<img>`-embedded SVG is script-inert, which is why this theme has no
`{svg: true}` sanitize path at all.

## Composable conventions

- **Module-level cache + in-flight dedup**: `useCatalog.ts`, `useImageIndex.ts`
  share one cache/promise map across every call site, not per-instance state.
- **Monotonic request token**: `usePackageRoot.ts`, `useImageIndex.ts` guard
  every async state write with a token incremented per request — a slow,
  superseded response can never overwrite state a newer request already set
  (matters across VitePress's client-router component reuse on navigation).
- **No auto-fetch on mount** for `useCatalog`/`useImageIndex` — callers
  trigger `load()` explicitly; `usePackageRoot` is the one exception
  (`onMounted` + `watch(..., { immediate: true })`), since a detail page
  always needs its root immediately.
- Wire-shaped TS interfaces (`usePackageRoot.ts`'s `PackageRoot`, `TagEntry`,
  …) mirror JSON field names verbatim (snake_case) — no camelCase
  translation layer between the wire type and the composable.

## Component conventions

- `defineProps<{...}>()` generic form only — no runtime `props: {...}`
  object declarations.
- `<style scoped>` is the default. An unscoped `<style>` block is only for
  content that portals outside the component's DOM subtree (a reka-ui
  `*Portal`/`*Content`, e.g. `CopyContextMenu.vue`'s `.copy-ctx-menu`) —
  `scoped`'s `data-v-*` attribute selector can't reach content teleported to
  `<body>`. Every such block carries a comment naming why it's unscoped.
- `typeof window !== 'undefined'` guards any browser-only read (`window.location`,
  a sanitizer instantiation) — VitePress prerenders detail pages under Node
  during SSG, where `window` is undefined.
- `CopyContextMenu.vue` (`buildTagCopyActions`) is the single source of truth
  for every right-click copy menu (tag badges, install grid, catalog card,
  catalog table) — a consumer hand-rolling its own action list is how the
  catalog menu previously missed an action `TagBadge.vue` already had.

## Not linted (deliberate gap)

`eslint.config.js` excludes `src/theme/**/*.vue` — no `eslint-plugin-vue`
wired up. `.ts` files under `src/theme/` (composables, utils) are linted
normally.

## Coverage gap (deliberate, not a target)

`.vue` SFC internals and `src/theme/index.mts` (the theme registration entry)
are excluded from `vitest.config.ts`'s coverage — SFC `<script setup>` logic
isn't unit-testable via plain branch coverage the way composables/utils are.
Golden fixtures plus the wiring tests above (`brand_install_wiring.test.ts`,
`readme_pane_wiring.test.ts`) are this subsystem's real functional gate for
component behavior, not the coverage percentage.
