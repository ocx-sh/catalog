---
paths:
  - src/site/client/**
  - src/site/components/**
  - src/site/lib/viewPrefs.ts
  - src/site/lib/viewScript.ts
  - src/site/lib/installPin.ts
---

# Site Client Subsystem

The browser half of `src/site/**`: the islands (`client/`), the templates that
host them (`components/`) and the guarded storage modules. Route identity, URL
sinks, sanitisation, CSP and the docs mount are in
[subsystem-site.md](./subsystem-site.md).

## Lazy islands and their DOM contracts (C-011, C-033)

Nothing loads before the first interaction: no `catalog.json` request and no
island chunk. Three entry shapes:

- **Grid** (`client/grid.ts`, via `grid_entry.ts`) takes a `LazyMount`
  (`client/mount.ts`, the shape of `@ocx-sh/theme/lazy`'s `mount(root, {load,
  trigger, replay})`); the binding is the `<script>` in `CatalogGrid.astro` and
  the filter code sits behind a dynamic `import()` in `load`. A static import of
  it from an entry breaks C-017's pre-input JS budget (11 KiB gz).
- **Palette** (`client/palette.ts`) binds the theme's `mountCommandPalette`
  (`@ocx-sh/theme/command-palette`), which owns the markup, Mod+K, "/", the
  listbox and every a11y attribute. The catalog supplies `source`, a dynamic
  `import()` of `palette_source.ts`, and `slash` (never on a page with `[data-grid]`).
- **Detail** (`client/detail.ts`, the `<script>` of `pages/package.astro`) starts
  with the page and fetches nothing: every prerendered tag's facts are already in
  the HTML. There is no versions island of its own: `client/versions.ts` is
  imported by `detail.ts` on first need (a tag the page left out, a `details[data-lazy]`
  breakdown or track list opened). There is no "Show all" button: every cut group is
  a `details` that fetches on open. The page prerenders a bounded tree
  (`lib/versionTable.ts`'s `prerender`: aliases, the newest lines and patches, the
  first `SSR_TRACKS` pre-release tracks, `SSR_OTHER` non-version tags) and the rest is
  drawn from the package's `_root.json`, cloning `<template>`s `VersionList.astro`
  renders. Pre-release and build-stamped tags group into **tracks** (`trackKey`), a
  minor line is a `MinorLine`, and an ephemeral tag carries a bar and is never a
  header's copy target or "latest". The install pin level retargets the card, not the tree.
  The Platforms card's **support-matrix dialog** is the one exception to "every prerendered
  fact is in the HTML": the page ships its shell and a skeleton (C-017), and `client/support_matrix.ts`
  (a dynamic `import()` from `detail.ts` on the first click of the dialog's trigger) fetches the
  package's `data/catalog/support/<route key>.json` (`viewmodel/support_matrix.ts`, `lib/supportWire.ts`),
  draws every tag newest first and owns the platform chips; the theme `DataTable` cannot take rows at
  runtime, so the table is local. A failure shows an inline error with Retry; `aria-busy` is on the table
  until rows or an error are in.

State-bearing URLs (`?q ?index ?sort ?view ...`, written with `replaceState`) and a
remembered non-default view or sort boot the grid at load. The skeleton replaces
the server cards only when they would be wrong (D-173: such a cold URL, or a query
typed before the catalog arrives); a bare first interaction keeps the cards, which
are links to click while `catalog.json` loads. Every failure path (a failed
`catalog.json`, or a `grid_session` chunk that does not load) clears the head
script's wait marks, unhides the server cards and shows the error panel — a page
must never stay hidden behind the skeleton.

Each island's header docblock IS its markup contract (`data-*` hooks, template
elements, theme events). The `.astro` template and the island change in the same
commit. Islands drive theme widgets through their documented DOM events only: the
theme's setters `ocx:toggle-group:set` / `ocx:select:set` (`{ value }`, dispatched on
the control's `[data-zag-root]`, no change event comes back) and its `*:change`
events, never theme internals. `base` arrives as `data-base`, never a global; every
island test has a `/catalog/` case. `grid_real_lazy.test.ts` and `palette_theme.test.ts`
run the grid and the palette against the real theme modules and fail on drift in
either shape.

## Palette

`Palette.astro` renders the theme's closed `CommandPalette` in a `.ocx-palette`
wrapper carrying `data-base` and, with a docs mount, `data-docs`. The first open
loads `palette_source.ts`: a "Packages" group (`filterPackages` over `catalog.json`, ranked
by `lib/packageSearch.ts` like the grid, 8 rows, `packageHref`) and, with docs, a "Docs" group (`searchDocs`, MiniSearch over
`data/catalog/docs-index.json`: title, first 20 headings, first 600 characters, section
path as breadcrumbs). The index is written at build only when `docs` is set
(`viewmodel/docs_index.ts`). A catalog failure shows the theme's error line; a docs
failure only drops the Docs group.

## Web storage: two guarded owners

State lives in the URL; storage only remembers a preference, under the 0.5.x
keys so a stored choice survives the upgrade. `client/**` touches none. Two
modules own it; the head script's text in `lib/viewScript.ts` also reads the view
key, and the test allow-lists those three files:

- `lib/viewPrefs.ts`: `ocx-catalog-view` (`cards|table`) and `ocx-catalog-sort`
  (`name|updated|created`), D-170. The grid reads them at boot and writes on
  every change. The URL wins this visit and is then stored, so a reload or Back
  cannot let an older value win. `VIEW_SCRIPT` (hashed, inlined in
  `CatalogGrid.astro`, pinned equal by `viewScript.test.ts`) sets
  `data-catalog-view="table"` before paint from `?view` or the stored value, so
  a returning reader never sees server cards flash.
- `lib/installPin.ts`: `ocx-install-pin`, D-171. A LEVEL
  (`latest|rolling|major|minor|patch|pinned`), never a tag, reapplied to the
  install card's version select on every package and on a variant change
  (`client/detail.ts` takes the storage as an option, `browserStorage()` by default).

Rules: read through an allow-list (`VIEW_MODES`, `SORT_KEYS`, `isPinLevel`), so
an unknown value reads as absent; every access sits in `try/catch` (blocked
storage, quota) and a failure means "not remembered", never an error. A third
use is a new entry here and in the test's allow-list.

## Catalog toolbar and grid: invariants that each cost a defect

- **Every selection narrows.** `filterPackages` ANDs values WITHIN a facet as
  well as across facets (two platform chips mean "ships both"). It was OR once,
  and a second click widened the result, which read as a broken rail
  (`test/site/lib/filterPackages.test.ts`, "AND within the facet").
- **Free text is ranked, not matched** (`lib/packageSearch.ts`, a port of grim's
  `search_match.rs`; grim is the source of truth, retune the weights there first).
  Weights name 3, keywords 2, description 1, namespace 1; every term must hit some
  field (AND); identifiers match fuzzy only when tight, prose by whole word or word
  prefix. **Relative cutoff:** results scoring under 50% of the best are dropped,
  computed after the facet filters, and ties keep the chosen sort. Never switch the
  cutoff to an absolute score: scores scale with query length. The docs index
  (`searchDocs`) stays MiniSearch.
- **The keyword rail comes from the filtered set, the popover from the whole
  catalog.** Scored against survivors every chip is a real further cut; active
  keywords are pinned first in click order and never scored (greedy scoring
  would drop the chip needed to undo the filter). Rail logic is
  `lib/keywordRail.ts`.
- **Table platform columns come from the whole "all" population**, never from the
  visible rows, so icons stay aligned as filters change.
- **A card's keyword strip is one clipped line**, so two cards side by side never
  differ in height.
- **Tab out of the search field goes to the first card/row** by an explicit key
  handler; no `tabindex` is added and DOM order is not rearranged.
- **Paint bound on `.package-card` only** (`content-visibility: auto` with an
  `auto` intrinsic size). Never on a table row: it is a `subgrid` item and layout
  containment turns a subgrid into `none`. Never on the `display: contents`
  `<li>`: it generates no box.
- **No glyph entrance animation in the grid.** The theme's `ocx-platform-in` replays on every card a view switch shows and puts each glyph on its own compositor layer (~75 ms of the switch at 4x throttle); `CatalogGrid.astro` sets `animation: none` on `[data-grid] .ocx-platform[data-os]` (`[data-os]` to outrank the theme's scoped rule; `test/acceptance/landing.test.ts`).
- **Build bound:** `lib/windowing.ts` renders a growing slice (48, doubling to a
  384 cap), never shrinking while scrolling; it is a RENDER slice and every
  count and filter reads the full set. None of this is measurable in a DOM
  emulator: `task quality:web` measures it in Chrome and its budgets are the gate.
