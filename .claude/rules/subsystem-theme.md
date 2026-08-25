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
from `root.name` 404s. `DetailPage.vue` derives `ns`/`pkg` from frontmatter
(see "Route identity" below), not from a fetched root field.

## Route identity: frontmatter, never the route, never `useData().params`

A synthesized package page is a plain static file (`src/build/pages.ts`), not
a `defineRoutes`/`[param]`-named dynamic route, so `useData().params` is
never populated for it. `pages.ts` writes `ns`/`pkg` into each page's
frontmatter instead, and `DetailPage.vue` reads them from there. `pkg` is
never re-split, so depth-N package paths survive.

Do NOT recover identity from the route. `DetailPage.vue` used to split
`page.relativePath`, which held only while every route was the bare
`<ns>/<pkg>`; a non-root index's page is served at `/<index>/<ns>/<pkg>`, so
that split reads an index label as a namespace and every CAS URL built from
it 404s — which the theme's image-fallback chains degrade silently, reading
as "this package publishes nothing" rather than as a broken fetch. Same class
of bug as the CAS gotcha above, and the same rule: route is presentation,
`ns`/`pkg` is identity.

## The index is the name's first segment, not a badge

A catalog aggregating several indexes prints each package's FULL qualified
name (`pkg.name`, e.g. `corp.example/platform/deploy-kit`) on cards and table
rows — its first `/`-segment IS the index (`sources/labels.ts` derives a
source's label from exactly it and rejects a config whose label disagrees).
So a package's origin needs no badge, dot or coloured edge; adding one is a
second marker for a fact the line already carries.

`bareName` (`<ns>/<pkg>`) stays what every CAS/wire URL and the monogram hash
are built from — see the CAS gotcha above. Only DISPLAY uses the qualified
name, and it elides in the middle (`utils/elideMiddle.ts`) so both the index
and the package leaf survive; plain `text-overflow` eats the leaf.

**The route rule has exactly one implementation, `src/viewmodel/route.ts`.**
`utils/packageRoute.ts` re-exports it; `build/sources_pipeline.ts` imports it
too, so the path a page is WRITTEN at and the path it is LINKED at cannot
drift. Every link goes through it — cards, table rows and the ⌘K palette. The
default index keeps bare `/<ns>/<pkg>` routes; every other index qualifies its
pages with its own name, and a call site that rebuilds the bare path by hand
404s on all of them.

This branch paid for the two-copy version twice. The palette rebuilt the bare
path inline, and no test caught it because `@localSearchIndex` (a
VitePress-plugin virtual module) made `SearchModal.vue` untransformable under
vitest — `vitest.config.ts` now aliases it to a stub so the palette is
mountable. `DetailPage.vue` recovered `ns`/`pkg` by splitting the route, which
reads an index label as a namespace. A duplicated rule looks correct in each
copy; that is why neither was caught by reading them.

**`catalog.indexes` ships for every catalog, one source included** — the theme
resolves routes through it, so suppressing it below two sources gave a lone
non-root deployment qualified pages and no way to link them (every card 404'd).
Presence of the envelope is therefore NOT the question "is there a scope to
pick"; a one-entry envelope means one place to be. `CatalogPage.vue`'s
`hasScope` is that question, asked once and read by both the tab row and the
`?index=` mirror. `packageRoutePath` still accepts `undefined` — a catalog.json
this renderer did not write has no such key.

Scope selection lives in `IndexTabs.vue` above the toolbar, never as a fifth
filter chip: platforms and keywords are attributes a package HAS, an index is
where it comes FROM. It renders only under `hasScope`, and the selection is
mirrored into `?index=` with `replaceState` (the same mechanism `?q=` uses) so
Back from a detail page restores it — the mirror watches `indexes` as well as
the selection, or a cold load settles the scope after the URL was already
rewritten and the shared link loses it permanently.

## Catalog toolbar and grid: five invariants that each cost a defect

Four landed together from issue #5, the keyword-rail one right after, and
each is easy to undo by accident. `catalog_layout_wiring.test.ts`
(`test/theme/components/`) pins Tab-out-of-search, the table's fixed
platform slots, chip-rail nowrap, and card-keyword clipping — the AND-within-
a-facet invariant below is pinned separately by
`test/theme/utils/filterPackages.test.ts` ("AND within the facet"), since it
lives in `filterPackages` itself rather than in component wiring.
`keyword_rail_narrowing_wiring.test.ts` pins the rail.

- **Every filter selection narrows.** `filterPackages` combines values
  *within* a facet with AND, not just across facets — two platform chips mean
  "ships both", two keyword chips mean "carries both". They used to be OR
  within a facet, so a second click widened the result set, which reads as the
  rail being broken rather than as a feature.
- **The chip rail never wraps.** No chip shrinks (each is floored by its own
  longest word) and `KEYWORD_CHIP_LIMIT` is a plain constant, not
  viewport-aware — so a flat `flex-wrap: wrap` row dropped `deprecated`/
  `yanked` onto a second line as the window narrowed. `FilterChips.vue` is
  three groups; only `.chip-keywords` flexes and scrolls (the same treatment
  `IndexTabs.vue` gives an over-long tab row). Flattening the grouping back
  silently restores the wrap.
- **The keyword rail comes from `filtered`, and the popover never does.**
  Opposite call to the table columns below, on purpose. Scored against the
  whole catalog the rail keeps offering keywords no surviving package
  carries, and under AND semantics each of those is a click straight to "no
  matches"; scored against the survivors every chip is a real further cut.
  Active keywords are PINNED first, in click order, and excluded from the
  scoring — greedy gives a keyword every survivor carries a score of ~0, so
  the chip you need in order to UNDO the filter is exactly the one it drops.
  The "+N more" popover stays whole-catalog: it is the one way back to a
  keyword the current result set no longer offers. The rail's contents
  therefore move on every click, which is why the keyword group is a
  `TransitionGroup` — the set changing invisibly is what reads as broken.
- **Table platform columns come from the whole catalog, never `filtered`.**
  `PackageTable` draws one slot per OS whether or not the row ships it, so
  icons line up down the table; `CatalogPage` derives the column list from
  `catalog.packages`. Deriving it from the visible rows would make columns
  appear and vanish as filters change, which is the same misalignment wearing
  a different hat.
- **A card's keyword strip is one clipped line.** The title is already pinned
  to one line and the description clamped to two with a floor; keywords were
  the last thing that could grow, so wrapping made two cards side by side
  different heights purely because one package's keywords were longer. No
  fade over the clip — a gradient mask cannot tell whether it is actually
  overflowing, so it would dim a keyword that fits.

Tab out of the search field goes to the first card/row, not into the toolbar
(`CatalogPage.vue`'s `onSearchNext`). C-330 is unchanged and no `tabindex`
appears anywhere: the toolbar controls are still real Tab stops, reachable by
Shift+Tab back out of the grid. Reordering the DOM instead would have made
focus order disagree with visual order — the worse defect.

## Theme-aware, not palette-assuming

Every color/spacing/type value is a CSS custom property from
`src/theme/styles/tokens/*.css` (`--ocx-color-*`, `--ocx-font-*`,
`--ocx-text-*`, `--ocx-radius-*`, `--ocx-space-*`) — components hardcoding a
hex value or a pixel font size outside those tokens are a defect, not a
pattern to extend. WP6
(theme a11y pass, 2026-08-22) tokenized the last three: a `font-size: 10px`
each in `FilterChips.vue`, `DocsSidebar.vue`, and `OnThisPage.vue`, now
`var(--ocx-text-2xs)`. Dark mode is the `.dark` class VitePress's
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
- **Every `<style>` block's content is wrapped in `@layer ocx { … }`** — the
  consumer-override contract, see
  [`quality-css-overrides.md`](./quality-css-overrides.md). A new block is
  wrapped too, or its rules silently outrank a consumer's stylesheet. The
  wrapper is not indented into the rules, so a block's diff stays readable.
  Never `!important` inside the layer except an accessibility lock (layer order
  reverses for `!important`, which would lock consumers out permanently).
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
