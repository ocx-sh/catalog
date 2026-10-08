# Research: discovery for the @ocx-sh/theme port

Condensed output of the hex-plan Discover phase (2026-10-07) for porting
`@ocx-sh/catalog` from VitePress + Vue onto `@ocx-sh/theme` (Astro + Zag).
Companion: [`research_astro_programmatic_renderer.md`](./research_astro_programmatic_renderer.md).
Handover: `.agents/handover/ocx-theme-port.md` (untracked).

## 1. Swap boundary in this repo

- 38 non-theme source files, ~6.7k LOC. ~1.45k LOC (21%) is VitePress-coupled,
  all in `src/build/` (`engine.ts`, `config_gen.ts`, `pages.ts`, `scratch.ts`,
  `dev.ts`, `dev_worker.ts`, `dev_worker_protocol.ts`) plus `src/cli/out_dir.ts`.
- Framework-agnostic and kept: `src/config/*` (921), `src/sources/*` (2,188),
  `src/viewmodel/*` (1,058), `src/ci/*` (469), `build/sources_pipeline.ts`
  (377, `resolveCatalog` + `emitCatalogTree`), `build/errors.ts`, `cli/*` exit
  mapping (`exit.ts`: OK 0, FAIL 1, USAGE 64, DATA 65, UNAVAILABLE 69).
- Narrowest seam: `ResolvedCatalog` (`sources_pipeline.ts:90-103`): `sources`,
  `routes: PackageRoute[]` (segments, namespace, package, wireBase, ownerUrl),
  `descLookup`, `catalogJson`. `emitCatalogTree(catalog, dir)` writes the
  mirror, `_headers`, and the merged `data/catalog/catalog.json` LAST.
- Soft couplings to cut first: `sources_pipeline.ts:15` imports `PackageRoute`
  from `pages.ts`; `:16` imports `cacheBaseDir` from `scratch.ts`.
- A new renderer implements one thing: `renderSite({config, configDir, catalog,
  outDir})` → landing, 404, one page per route, docs mount, publicDir/logo/
  favicon/robots/sitemap, head meta from `descLookup`, consumer `css` last,
  then `emitCatalogTree` last.
- Dev today: forked child (`dev_worker.ts`) because of Vite-in-Vite under
  vitest; no file watching at all; dev omits `footer`/`docsNav`/`publicDir`
  (`dev_worker.ts:119-142`) — dev ≠ build today.
- Tests: mock-orchestration suites (`engine`, `config_gen`, `pages`, `scratch`,
  `css_order`) die with the coupled modules; `*_real_build.test.ts` assert
  rendered-HTML contracts and are the best cross-renderer acceptance spec;
  agnostic suites (`sources`, `viewmodel`, `golden`, `ci`, `config`, `cli`) stay.

## 2. Current theme (parity target)

- 72 files, ~10.6k lines: 38 SFCs (~7.8k, half scoped CSS), 9 composables
  (~730), 16 pure-TS utils (~1.2k, no Vue imports — reusable as-is:
  `version.ts`, `sanitize.ts`, `filterPackages.ts`, `keywordRail.ts`,
  `readmeMarkdown.ts`, `cas.ts`, `osGlyphs.ts`, `safeHref.ts`, `ownerUrl.ts`,
  `monogram.ts`, `elideMiddle.ts`, `platform*.ts`, `dom.ts`, `modifierKey.ts`).
- Pure logic trapped in Vue files, extract: `buildTagCopyActions`
  (`CopyContextMenu.vue`), `DEFAULT_INSTALL_FLAVORS`/`installCommand`,
  wire types + `ownerLogin` (`usePackageRoot.ts`), fetch cores
  (`useCatalog`/`usePackageRoot`/`useImageIndex`), `CatalogPage` scope/URL
  logic, `MetaRail` pin-level logic.
- Client fetches: `/data/catalog/catalog.json` (hard-coded root path);
  `<wireBase>/p/<ns>/<pkg>/_root.json` → `.json` fallback; image index
  `…/o/sha256/<hex>.json`; README `…/o/sha256/<hex>.md`; logos as `<img>`;
  VitePress `@localSearchIndex` for docs search.
- Catalog grid and detail pages are SPA-hydrated from wire JSON, not
  pre-rendered. Windowed list for corporate size (48, doubling, cap +384).
- Security controls to keep: `safeHref`; `ownerProfileUrl` encode + split/join;
  `assertSafePackagePath` on `supersededBy`; CAS digest regex + bare ns/pkg URL
  building (never `root.name`, never the route); markdown-it `html:false` +
  comment drop; DOMPurify config + style allowlist, client-only; logos only as
  `<img>`; `noopener noreferrer`; `_headers` sandbox on `/p/*` and
  `/index/<label>/p/*`.
- Known defect: `MetaRail.vue:383` renders `<a :href="null">` for an owner whose
  URL fails `safeHref` instead of plain text.
- Full 39-item parity checklist: catalog (cards/table, sort, MiniSearch,
  platform/status/keyword facets, keyword rail + overflow, index scope tabs,
  `?q=`/`?index=` URL state, keyboard), detail (states, banners, identity,
  version tree with hover preview, install card with pin preference, platform
  matrix, metadata rail, README pane + provenance popover), ⌘K palette (packages
  + docs), header/footer/404, docs mount (sidebar is a hard-coded index-repo
  `DOCS_NAV`), dark mode, head/SEO, fonts, config surface.
- Public customization API removed by the port (owner decision 2026-10-07,
  "break it"): `exports["./theme"]`, `@layer ocx` consumer-override contract,
  `data-slot`s + 7 `--ocx-*` component hooks, `docs/how-to/customize-components.md`,
  `docs/reference/theme-tokens.md` (generated, drift-gated).

## 3. @ocx-sh/theme (library facts)

- Source: `/home/mherwig/dev/ocx-website` (`packages/theme`, v0.1.0). Peers
  `astro ^7`, `@astrojs/starlight >=0.42 <0.43`; `engines.node >=22`
  (catalog today: `>=20.19`). Zag pinned and bundled; consumers never import
  `@zag-js/*`.
- Exports: `tokens.css`, `base.css`, `fonts.css`, `starlight.css`, `nav.json`,
  `./nav` helpers, `logo.svg`, `./starlight` plugin, `./components/*.astro`,
  `./icons`, `./toast`, `./toaster`, `./cycle-button`; bin `ocx-site`.
- Starlight plugin hard-fails unless `base` is a nav.json claim,
  `trailingSlash: 'always'`, and `site` unset (forced `https://ocx.sh`).
- Chrome today is Starlight-only. **Accepted library request (ocx-website-83,
  2026-10-07):** `@ocx-sh/theme/layouts/Shell.astro` (props `title`,
  `description?`, `canonical?`, `activeSection?`, `search?`, and neutral-mode
  `brand?`/`nav?`/`footer?`; slots `head`, `default`, `header-search`) on
  shared `SiteHeader.astro`/`SiteFooter.astro` + the every-page mount script.
  Props absent → nav.json ocx.sh chrome; given → neutral header (brand, links,
  search slot, theme toggle; no ecosystem menu, no install button). `site` and
  `base` come from the consumer's Astro config; no claim validation. Pending
  commit on website `feat/phase3-pilots`.
- Components fit for the catalog (all Astro, generator-agnostic): `ui/List`
  (rows are options — no links), `ui/DataTable` (string/number cells only),
  `Pagination`, `ui/SearchField`, `ui/CommandBar`, `ui/Combobox`, `ui/Select`,
  `ui/Tag`/`ui/TagGroup` (filter chips), `Tabs`, `PlatformIcons` (zero JS),
  `CopyButton`, `ui/Breadcrumbs`, `ui/Skeleton`, `Tooltip`, `Menu`/
  `ActionMenu` (context copy menu), `Dialog`, `Drawer`, `Popover`, `toast()`.
  No card-grid component; cards compose by hand.
- Loading model: Zag machines start on first interaction (`pointerenter`,
  `focusin`, `touchstart`, first key replayed); `data-zag-state` idle → live.
- Quality: tokens only (no raw colour/px/ms, no `!important`), one focus ring,
  inline SVG icons ≤2 KB, reserved boxes for every image, identical with
  images blocked, Lighthouse 100×4 mobile, axe, Playwright no-flicker and
  lazy-hydration gates, `ocx-site check --dist`.
- Budgets, content class: HTML ≤14.2 KB gzip, JS before input ≤11 KiB, JS
  after all widgets ≤64 KiB, DOM ≤800, heap ≤4 MiB. **Ruling
  (ocx-website-83):** target `content`; SSR first page N=24 cards in reserved
  boxes; a `catalog.json` fetch triggered by first interaction counts as
  "nothing loads before interaction"; detail-page wire/README fetched
  client-side behind skeletons is fine with CLS 0 and identical-with-images-
  blocked. Report DOM / gzip HTML / pre-input JS for grid N=24 and one detail
  page; raising needs an owner-signed Spec Delta.

## 4. Topology and consumer

- `/catalog/` claim: `repo: ocx-sh/index`, `search: false` for v1 (ruling).
  Index runs the `ocx-catalog` binary from npm and deploys via the website
  deploy action to Bunny. `/apps/catalog/` (this repo's docs) claims
  `ocx-sh/catalog`, `search: true` (must ship a Pagefind bundle).
- Bunny ignores `_headers`. **Accepted:** fixed edge rule `catalog-sandbox` in
  website `infra/bunny/` (CSP sandbox + nosniff on `/catalog/p/*` and
  `/catalog/index/*/p/*`). Keep emitting `_headers` for other hosts.
- **Subpath support is new work here**: today `docs/ops/known-limitations.md`
  #1 says no subpath support; every hard-coded root path (`/data/catalog/
  catalog.json`, `/p/…`, route links, `_headers` patterns, preload hrefs,
  `/?q=` keyword links, `/docs/`) must become base-aware.
- `ocx-sh/index` today: `@ocx-sh/catalog ^0.5`, pins `vitepress`/`vue` itself;
  `ocx-catalog build --config .catalog.config.render.json --out
  site/.vitepress/dist`; Cloudflare Pages at the root of `index.ocx.sh`;
  `golden-baseline.manifest` pins VitePress dist hashes (must regenerate);
  `task site:preview` calls `vitepress preview` directly; its 16 docs pages
  under `site/src/docs/**` use VitePress-isms (`{#id}` anchors, `<span v-pre>`,
  `::: details`). Contract paths: `/data/catalog/catalog.json`, `/config.json`,
  `/c/index.json`, `/p/**`, `_headers`, `404.html`, `favicon.svg`,
  `robots.txt`, `/docs/**`.
- Rendered CI templates (`templates/ci/*`) are renderer-agnostic but
  `gitlab-ci.yml:25-27` assumes `--out` default `dist`.

## 5. This repo's docs and CI

- 23 MkDocs pages (Home, How-To ×8, Reference ×6 incl. generated
  `theme-tokens.md`, Explanation ×4, Ops ×4), ~12-14k words. MkDocs-only
  markup: 10 admonitions, 9 `=== "x"` tabs, a grid-cards landing with
  `:material-*:` icons; heavy relative `.md` links incl. numbered anchors.
- `pages.yml` is entirely MkDocs (uv + mkdocs-material 9.7.7, `--strict`,
  GitHub Pages). Lighthouse floors in `.lighthouserc.cjs` were measured on
  VitePress output; `scripts/quality-css-cascade.mjs` asserts the `@layer`
  override contract that the port removes.
- Packaging: `exports["./theme"]` → `src/theme/index.mts`; pack-smoke
  asserts that export resolves and scans `.vue` imports; attw excludes
  `./theme`. Peers `vitepress`/`vue` → `astro`.
