# ADR: Port the renderer to Astro + `@ocx-sh/theme`, docs to Starlight

- Status: proposed, revision 1 (2026-10-07, after review round 1). Awaiting
  owner sign-off on the three open questions at the end.
- Deciders: owner, architect (this document); `ocx-sh/website` session owns
  every library request listed in [Library requests](#library-requests).
- Context input: [`research_ocx_theme_port_discovery.md`](./research_ocx_theme_port_discovery.md),
  [`research_astro_programmatic_renderer.md`](./research_astro_programmatic_renderer.md),
  `.agents/handover/ocx-theme-port.md`, the code at the seams
  (`src/build/*`, `src/cli/*`, `src/viewmodel/{route,catalog,types}.ts`,
  `src/sources/mirror.ts`, `src/config/types.ts`), the theme skills
  `ocx-theme-{setup,components,quality}` in `/home/mherwig/dev/ocx-website`,
  and the installed `astro@7.3.5` source in that checkout (revision 1 checks).
- Review input: `.claude/state/plans/review_ocx_theme_port_round1.md`. Every
  triage ID is answered in [Revision 1](#revision-1-2026-10-07).
- Owner rulings already in force (2026-10-07): port approved; the public
  `@ocx-sh/catalog/theme` export and the CSS-override contract (`@layer ocx`,
  `data-slot`, the `--ocx-*` component hooks) are **removed without a compat
  layer** in a breaking 0.x minor. Budget class `content`, SSR first page
  N=24, a `catalog.json` fetch on first interaction is allowed.

## Context in five lines

1. Only ~1.45k LOC (`src/build/{engine,config_gen,pages,scratch,dev,dev_worker,dev_worker_protocol}.ts`
   + `src/cli/out_dir.ts`) is VitePress-coupled; `config/`, `sources/`,
   `viewmodel/`, `ci/` and `sources_pipeline.ts` are framework-agnostic.
2. The narrowest seam is `ResolvedCatalog` (`sources_pipeline.ts:90-103`) plus
   `emitCatalogTree()`; a new renderer implements one thing:
   `renderSite({ loaded, catalog, outDir })`.
3. The site today is a client-rendered SPA (grid and detail pages hydrate from
   wire JSON). The library's budgets (pre-input JS ≤ 11 KiB, HTML ≤ 14.2 KB gz,
   DOM ≤ 800, nothing loads before interaction) make that model illegal: the
   port is a rendering-model change, not only a component swap.
4. The catalog must now run under a base path (`/catalog/` on `ocx.sh`); today
   every URL is root-absolute (`docs/ops/known-limitations.md` #1).
5. Astro's programmatic `build()`/`dev()` API is documented as experimental;
   its `astro` CLI, config file and integration API are not. Nobody else ships
   "a CLI drives Astro against a hidden root". The spike proved the
   integration shape (build, dev, base path, symlinked and tarball installs,
   10k pages in 5.5 s) through the programmatic API.

---

## D1 — Renderer architecture (rev 1)

### Options

- **(a) In-process.** The CLI imports `astro`'s `build()`/`dev()` and calls them
  with `configFile: false` and an inline config. One internal integration
  `injectRoute()`s every page and hands data over a Vite virtual module.
- **(a′) Subprocess.** The CLI writes a two-line `astro.config.mjs` into the
  scratch root and spawns the stable `astro build|dev --root <scratch>
  --config <scratch>/astro.config.mjs` CLI as a child process. The same
  internal integration reads its data from a JSON file in the scratch root.
- **(b) Public integration.** The consumer owns an Astro project
  (Starlight/TutorialKit pattern); `ocx-catalog build` wraps `astro build` or
  disappears.
- **(c) Keep VitePress, adopt the theme's CSS only** (`@ocx-sh/theme/vitepress`
  + `fonts.css`), as the website's phase 1 did.
- **(d) Render the whole catalog as a Starlight site.**

### Hard gates first

| Gate | (a) | (a′) | (b) | (c) | (d) |
|---|---|---|---|---|---|
| G1 Library budgets: pre-input JS ≤ 11 KiB, nothing loads before interaction, Zag `.astro` components usable | pass | pass | pass | **fail**: VitePress ships the Vue runtime before input and cannot render `.astro` components | pass |
| G2 Corporate mirrors at any host and base, no `ocx.sh` claim | pass | pass | pass | pass | **fail**: the theme's Starlight plugin throws unless `base` is an `ocx.sh` claim and `site` is `https://ocx.sh` |

(c) stays the fallback if Astro breaks irreparably (see Risks). (d) is out.

### Survivors scored (1–5)

The owner's port approval is not evidence for any option and is not scored.
Neither (a) nor (a′) keeps the consumer contract "unchanged": `base`, `chrome`,
the `favicon` semantics and the Node floor change it for both.

| Criterion | Weight | (a) | (a′) | (b) |
|---|---|---|---|---|
| Consumer runs a CLI over a config and owns no Astro project | 25 | 4 | 4 | 1 |
| API stability (inverse risk) | 20 | 2 | 4 | 4 |
| Test isolation and coverage honesty | 15 | 3 | 4 | 3 |
| Operability: exit mapping, logs, memory control | 15 | 4 | 4 | 3 |
| Dev parity and reload | 15 | 4 | 3 | 4 |
| Engineering cost (inverse) | 10 | 4 | 3 | 2 |
| **Weighted total** | 100 | 3.45 | **3.75** | 2.75 |

Score notes:

- **Stability.** (a) rests on the experimental `build()`/`dev()` signatures
  ("API signature may change"). (a′) rests on the `astro` CLI flags `--root`
  and `--config` (verified in `astro@7.3.5` `dist/cli/flags.js`), the config
  file and the integration hooks, all stable surfaces.
- **Test isolation.** (a) needs `astro_runner.ts` excluded from coverage and
  runs Vite inside the CLI process, the Vite-in-Vite shape the old fork
  existed to avoid. (a′) keeps Astro out of every process vitest touches. The
  runner is a spawn wrapper with an injected `spawn`, so it stays under the
  100% gate with no new exclusion.
- **Operability.** Both map errors the same way in practice: config and source
  errors (64/65/69) happen in the CLI before Astro starts, in either design.
  What (a) adds is typed Astro errors and the `logger` hook; (a′) relays the
  child's output line by line with the `ocx-catalog:` prefix and maps a
  non-zero child exit to 1. (a′) adds a heap boundary: the render child takes
  its own `NODE_OPTIONS`, and `ocx-catalog ci` never loads Astro.
- **Dev.** (a′) loses "one process": the CLI supervises an `astro dev` child
  (signals, readiness, port probe). Astro's in-place restart still does the
  reload work.
- **Cost.** (a′) adds config generation, bin resolution, line relay and signal
  forwarding (~120 lines, all unit-testable). It deletes the same fork and IPC
  protocol (a) deletes.

What in-process would have bought, and why it does not outweigh (a′): typed
errors (only render-phase failures, which map to exit 1 either way), the
`logger` hook (replaced by line relay; the generated config can still set
`logger` if structured output is ever wanted), and no child process in dev.
What (a′) buys: no experimental API, process isolation from vitest, a
per-render heap boundary, no coverage exclusion for the runner.

### Decision: (a′) subprocess (rev 1)

- `src/site/astro_config.ts` (pure) builds the complete `AstroUserConfig`
  from the site input: `base`, `site`, `outDir`, `publicDir`, `cacheDir`,
  `trailingSlash`, `build`, `security`, `vite`, `devToolbar`, `server`,
  `integrations: [catalog(sitePath)]`. Unit-tested at 100%.
- The generated `<scratch>/astro.config.mjs` is two lines with exactly two
  interpolated strings, both via `JSON.stringify`: the absolute file URL of
  this package's `dist/site/astro_config.js`, and the absolute path of
  `<scratch>/site.json` (C-040).
- `src/build/astro_runner.ts` resolves the `astro` bin from
  `createRequire(import.meta.url).resolve("astro/package.json")` plus its
  `bin.astro` (`./bin/astro.mjs`; `./package.json` is exported, verified on
  7.3.5), spawns `process.execPath <bin> build|dev --root <scratch> --config
  <scratch>/astro.config.mjs`, relays output with the CLI prefix, and forwards
  SIGINT/SIGTERM. Child env adds `ASTRO_TELEMETRY_DISABLED=1` and
  `ASTRO_DISABLE_UPDATE_CHECK=true` (the variable `dist/core/dev/update-check.js`
  reads). No module in `src/**` value-imports `astro` (C-025).
- The integration (`src/site/integration.ts`) is **internal**. Exposing it as
  option (b) later is additive.
- Exit mapping: the source pipeline's DATA/UNAVAILABLE/USAGE mapping is
  unchanged and runs before any spawn. A non-zero child exit is an internal
  failure (exit 1) with the child's stderr already relayed. Per-README faults
  never fail a build (C-037).
- `astro` is a **regular dependency**, pinned to a minor range (`~7.N`): the
  consumer never imports it, and `@ocx-sh/theme`'s `astro ^7` peer is
  satisfied by it. `vitepress`/`vue` peers disappear. Two-way door.
- `engines.node` moves `>=20.19` → **`>=22.13`** (jsdom ^29 floor
  `^22.13.0`, Astro 7 floor 22.12; jsdom 30 needs `^22.22.2`, so jsdom stays
  on ^29). CI stays on Node 24 / npm 11, which `scripts/pack-smoke.mjs`
  asserts (`EXPECTED_NPM_MAJOR = 11`).
- Heap: the child inherits `NODE_OPTIONS`; the CLI adds no heap flag by
  default. `build.concurrency` is pinned to `1`. The 10k measurement step
  (D2) decides whether a default heap flag is warranted; the docs name
  `NODE_OPTIONS=--max-old-space-size=<MiB>` for large indices.

---

## D2 — Data and rendering model per page type

Criteria for every sub-decision below, weighted: budgets and "first paint is
final" (35), parity with today's behaviour (25), security boundary unchanged
(20), cost and new dependencies (20). Any option that breaks a budget is
disqualified before weighing.

Principle: **everything the build already knows is rendered at build time**; the
client only loads code and data in response to input.

### Data handoff to pages (rev 1)

`resolveCatalog()` gains no new responsibilities. The CLI process:

1. assembles the scratch `public/` tree: consumer `publicDir` first, then
   `brand.logo`, the default `robots.txt` (`wx`, so a consumer file wins), then
   `emitCatalogTree(catalog, publicDir, base)` last (wire mirror, `_headers`,
   merged `catalog.json`; last-write-wins as in `sources_pipeline.ts`);
2. writes `<scratch>/site.json` from the pure `siteModel(catalog, packages,
   loaded)` (`src/site/model.ts`): route keys, the landing view (first 24 cards
   of the default scope), one small `DetailView` per `PackageRoute`, the docs
   list, chrome props, and for each route the catalog-root-relative path of
   its README CAS file. **No README body, no wire root, no image index** is in
   `site.json`.

The integration reads `site.json` in `astro:config:setup` and exposes it as
`virtual:ocx-catalog/site`. Each detail page renders its README **per page**
from the mirrored CAS file under the scratch `public/` (C-037). With
`build.concurrency: 1`, one README is in memory at a time.

The mirror already skips CAS assets over 1 MiB (`MAX_CAS_ASSET_BYTES`,
`src/sources/mirror.ts:33`), so the README cap and the mirror cap are one
constant by construction: a skipped README is absent on disk and renders the
"README unavailable" pane.

Build cost: Astro copies `public/` into `outDir`, so the wire tree is written
twice per build. `ponytail:` one code path for build and dev; if the copy
measures badly at corporate size, mirror into the staged output after Astro
returns and point README reads at the scratch copy.

**Measurement before the shape freezes:** a plan step builds a synthetic
10k-package index with ~20 KB READMEs through the real CLI and records wall
time and the child's peak RSS in the research artifact. That number decides
the default heap flag (D1). The 2–3 GB figure from the spike came from READMEs
held in `getStaticPaths` props, which this shape no longer does.

### Catalog landing (`/`)

| Option | First paint | Pre-input JS | Scale | Verdict |
|---|---|---|---|---|
| (1) SSR first 24 cards + toolbar in final state; island loads on first interaction, fetches `catalog.json`, owns search/filter/sort/scope/view and windowed growth | final, 24 real links | bootstrap only | `catalog.json` already exists, windowing logic reused | **chosen** |
| (2) Static pagination: `/page/N/` pages of 24 cards each, links in `Pagination` | final | none | +⌈n/24⌉ pages; filters still need the island | rejected for v1: two navigation models; the sitemap already makes every detail page crawlable |
| (3) Client-only grid as today | skeleton | framework + data at load | — | illegal under the budgets |

Rules the landing follows:

- Default sort `name`, default scope = `indexes[].default` (else "all"), cards in
  reserved boxes. The SSR order and the island's order for the same state come
  from the **same** pure function (`filterPackages` + sort).
- **Accepted trade-off (ARCH-W6, decided):** sort and view mode live in the URL
  (`?sort=`, `?view=`) next to `?q=`/`?index=`. The `localStorage` view/sort
  preferences and `ocx-install-pin` are dropped; the install card defaults to
  `latest` and a selection lasts one visit. Reason: a stored preference applied
  after load is a first-paint correction (layout shift, visible flicker) and
  needs JS before input, which the budget forbids. A URL is state the server
  page can already be in.
- A cold load whose URL already carries state (`?q=`, `?index=`, `?sort=`,
  `?view=`, keyword) boots the island at load. That URL is the result of an
  interaction on a previous page (keyword links, Back), which is the documented
  exception to "nothing loads before interaction" (C-011). The grid keeps its
  reserved box so the swap cannot shift layout.
- Cards and table rows the island renders are **cloned from SSR markup**: the
  page ships one `<template>` per item shape, rendered by the same `.astro`
  component the SSR cards use. Text goes in through `textContent` and
  attributes through `setAttribute`, never HTML strings (C-040).
- No UI framework and no custom `client:*` directive. The island is plain TS
  loaded by `import()` from the theme's interaction loader (`@ocx-sh/theme/lazy`,
  R2). Client modules receive `base` through a `data-base` attribute or mount
  options, never a global.
- Windowed growth reuses the `useWindowedList` algorithm (48, doubling, cap 384)
  extracted to pure TS. `content-visibility` rules from `subsystem-theme.md`
  carry over (cards only, never table rows).
- Search engine: MiniSearch over `catalog.json`, built on first interaction.
  First-keystroke INP is measured on the 250-package bulk site; if it fails the
  INP budget, the fallback is a prebuilt `MiniSearch.toJSON` index emitted at
  build next to `catalog.json`.

### Package detail (`/<route>/`)

| Section | Option chosen | Rejected options |
|---|---|---|
| Identity, status, deprecation/yank banners, `supersededBy` link, latest version, install command, platform matrix (latest tag's image index), metadata rail (license/source/revision, owners) | **SSR from build data** | client fetch at load (needs JS before input), client fetch on interaction (blank first paint) |
| README | **Rendered per page at build (rev 1)**: read the mirrored CAS file → existing `readmeMarkdown.ts` (markdown-it, `html: false`, comment drop, highlight.js classes; unlabelled fences render as plain escaped text, no `highlightAuto`) → `createReadmeSanitizer(window)` (DOMPurify over an injected `new JSDOM("")` window, no `runScripts`/resources; window and purifier recreated every ~500 documents) → branded `SanitizedHtml` → `set:html` inside `.ocx-prose` | Sätteri at build (no `html:false` equivalent verified; second sanitizer path), client render on load (≈ 50 KiB before input), client render on interaction (README is the page's main content) |
| Version tree | **SSR the newest 20 tags**; "show all versions" and per-tag hover preview (image index) load on interaction from the mirrored wire tree | SSR every tag (DOM budget on packages with hundreds of tags) |
| Copy menus | `ActionMenu` (context menu) with actions from the extracted `buildTagCopyActions` | — |

README sanitizer policy (SEC-F6/SEC-D3/RES-S7, decided):

- one shared `SANITIZE_CONFIG`: `ALLOW_DATA_ATTR: false`,
  `SANITIZE_NAMED_PROPS: true`, `class` limited to `^(hljs|language-)`, the
  existing `style` allowlist hook (markdown-it table alignment);
- `<a>` gets `rel="noopener noreferrer nofollow ugc"`; `<img>` gets
  `referrerpolicy="no-referrer" loading="lazy" decoding="async"`;
- allowed link targets: absolute `http(s):`, `mailto:`, `#fragment`.
  Protocol-relative (`//x`), root-relative (`/x`) and relative (`./x`, `x`)
  targets are neutralised: a link becomes its text, an image is dropped. This
  is what makes C-005 hold for README content;
- an idempotency tripwire (`sanitize(out) === out`) guards against mXSS; a
  mismatch renders the "README unavailable" pane (C-037);
- `dompurify` floor `>=3.4.0`, asserted by a version test;
- remote README images render in a CSS `aspect-ratio` box; the no-flicker gate
  runs on image-free fixture READMEs.

Identity rule unchanged and now simpler: the page receives `namespace`/`package`
from its `PackageRoute` (props), never from the URL and never from `root.name`.
Every wire URL is built by the existing `casUrl`/`wirePrefix` pair and then
`joinBase` (C-016, C-039).

The `MetaRail.vue:383` defect (`<a href=null>` for an owner whose URL fails
`safeHref`) is fixed by construction: plain text on `null` (C-013, C-042).

### Search

| Surface | Options | Decision |
|---|---|---|
| Grid search box | (1) MiniSearch over `catalog.json` (today's engine, lazy) (2) Pagefind over built detail pages (3) the theme's internal `fuzzy.mjs` | **(1)**: same engine, same `filterPackages` semantics and tests; Pagefind's filter model does not match platform/keyword/scope facets and the `/catalog/` claim is `search: false` for v1 |
| ⌘K palette | (1) packages only, MiniSearch over `catalog.json` (2) packages + docs titles (3) packages + Pagefind docs full-text | **(1)** for v1. Docs full text returns when the `/catalog/` claim flips to `search: true`. Parity gap, recorded in release notes. |

The palette is composed from `ui/Dialog` + `ui/SearchField` + `ui/List`
(`async`), opened by `Mod+K` or the trigger in Shell's `header-search` slot.
Selecting an option navigates to `packageHref(...)` (C-009, C-019).

### Docs mount (`docs` config key)

| Option | Fit |
|---|---|
| (1) Keep `docs`: Astro content collection with the `glob()` loader (absolute `base`, no copy, verified in the spike), rendered in `Shell` inside `.ocx-prose`; sidebar derived from the docs tree (directory groups, frontmatter `order`, then title) | keeps the key, works for corporate mirrors, kills the hard-coded `DOCS_NAV` |
| (2) Nest a Starlight build for the docs | the theme's Starlight plugin rejects any non-claim base → every corporate mirror breaks |
| (3) Drop `docs`; consumers host docs elsewhere | breaks `ocx-sh/index`'s 16 pages with no landing place |

**Decision: (1)**, see OQ2. A generated `src/content.config.ts` in the scratch
root declares the one collection, glob pattern `**/*.md` only (no MDX: MDX is
code execution at build). Docs markdown is **consumer-authored, trusted**
content (unchanged trust stance).

Markdown processor (rev 1, RES-W2): Astro 7's default, Sätteri, chosen
explicitly in `astro_config.ts`. `markdown.syntaxHighlight: false` for the
mount: Shiki emits inline `style` attributes, and Astro warns on every build
when Shiki and `security.csp` are both on (`warnIfCspWithShiki`, verified in
7.3.5). Docs code blocks are unhighlighted in v1 (release note). Heading ids
are whatever Sätteri generates; the acceptance suite asserts them on a fixture
page. `{#id}` custom anchors are not supported: a recorded deviation from
DOC-NAV-07 for consumer docs. VitePress-only syntax (`::: details`, `{#id}`,
`<span v-pre>`) fails visibly in the rendered page (migration note).

### Chrome

`@ocx-sh/theme/layouts/Shell.astro` (R1, accepted, SHA pending). A new config
key selects the mode explicitly: `chrome: "ocx"` renders the `nav.json` ocx.sh
header (for `ocx-sh/index` at `/catalog/`); `"neutral"` (the default) renders
the mirror's own `brand`/`nav`/`footer`. Explicit, never inferred from `base`.
The schema marks `chrome` as experimental (description text), so its values
may still change before 1.0.

### Page security (rev 1, SEC-F7)

Every page carries a CSP `<meta>` from Astro 7 `security.csp` (C-043):
`script-src 'self'` plus SHA-256 hashes, `object-src 'none'`,
`base-uri 'none'`, `style-src 'self' 'unsafe-inline'`.

Verified in `astro@7.3.5` (`dist/core/csp/common.js` `trackScriptHashes`):
Astro hashes the scripts it bundles or inlines itself, client directives,
`injectScript` head scripts and the island bootstrap. It does **not** hash
`<script is:inline>`, and the theme's `Shell.astro` emits two
(`THEME_SCRIPT`, `PLATFORM_SCRIPT` from the unexported `head-scripts.mjs`).
Those hashes come from the theme: library request R7.

`style-src` keeps `'unsafe-inline'` on purpose: README tables carry
`style="text-align:…"` attributes (the sanitizer's style allowlist), and
Astro suppresses style hashes when `'unsafe-inline'` is present. Script
injection is the threat the CSP addresses; style attributes are already
allowlisted by the sanitizer.

---

## D3 — Base-path support (rev 1)

### Options

| Option | Single source of truth | Problem |
|---|---|---|
| (1) New `base` key in `catalog.config.json` | the config | one more key |
| (2) Derive from `siteUrl`'s path only | `siteUrl` | `siteUrl` is optional; a relatively deployed mirror has no origin to state |
| (3) CLI flag `--base` only | the command line | `dev` and `build` can disagree; the base becomes deploy-script state |

Criteria, weighted: one source of truth for build and client (40), works for
relative/origin-less corporate deploys (30), dev and build cannot disagree
(20), config surface size (10). (1) wins the first three.

**Decision: (1), defaulting from `siteUrl` (ARCH-S1).**

- `base` absent: it takes `siteUrl`'s path when `siteUrl` has one, else `"/"`.
- `base` present and `siteUrl` origin-only: valid (`siteUrl: "https://ocx.sh"`,
  `base: "/catalog/"`).
- Both carry a path and they differ: `BASE_SITEURL_MISMATCH`.
- `base` must match `^/(?:(?!\.{1,2}/)[A-Za-z0-9._-]+/)*$`: leading and
  trailing slash, label-like segments, no `.` or `..` segment. Anything else is
  `BASE_INVALID`. Tests cover `/../`, `/./`, `/catalog/../`, and compare
  normalised request paths against the emitted `_headers` patterns.
- No `--base` flag (YAGNI; additive later).

### One join, one place

`src/viewmodel/url.ts` (new, beside `route.ts`):

- `joinBase(base, path)` — `base + path.slice(1)`. It **throws** unless
  `path` matches `^/(?!/)`, contains no `\`, no control character and no `.`
  or `..` segment. `joinBase("/", "//evil.example")` throws (C-039).
  Deliberately not the theme's `withBase`, whose "already under the base →
  unchanged" heuristic mis-joins `/index/<label>/p/…` under a base of
  `/index/`.
- `packageHref(name, indexes, base)` = `joinBase(base, packageRoutePath(name, indexes)) + "/"`
  — the only producer of detail-page links, build side and island (C-009).
- Wire and CAS URLs: the existing `wirePrefix()` (`viewmodel/catalog.ts:191`,
  `""` for the root source, `/index/<label>` otherwise) and `casUrl()`
  (`catalog.ts:202`, module-private today, exported by the port) produce the
  catalog-root-relative path; `joinBase` adds `base`. String-concatenating
  `wireBase` is banned: the original formula `"/" + wireBase + "/p/…"` yields
  `//p/…` (protocol-relative) for the root source (SEC-F3).

Build side receives `base` from `loaded.config`; client modules receive it
from the page (`data-base`), which Astro's `BASE_URL` and the config agree on.

### Every base-sensitive surface

| Surface | Today | After |
|---|---|---|
| Page routes, `_astro/` assets, island chunks | root | Astro `base`; `trailingSlash: "always"`, `build.format: "directory"` (OQ3) |
| Detail links (cards, rows, palette, `supersededBy`, keyword links `?q=`) | `/<route>` hand-built in places | `packageHref` / `joinBase(base, "/?q=" + encodeURIComponent(k))` only |
| `catalog.json` fetch | `/data/catalog/catalog.json` hard-coded | `joinBase(base, "/data/catalog/catalog.json")` |
| `catalog.json` `logoUrl`/`readmeUrl` | `/p/…`, `/index/<label>/p/…` | **bytes unchanged**; pinned as catalog-root-relative; every reader joins with `base` |
| Wire fetches (root JSON, image index, README/logo CAS) | `<wirePrefix>/p/…` | `joinBase(base, casUrl(…))` / `joinBase(base, wirePrefix(wireBase) + "/p/…")` |
| `_headers` | `/p/*`, `/index/<label>/p/*` | `base` threaded `emitCatalogTree(catalog, dir, base)` → `mirrorSources(…, base)` → `renderHeaders(sources, base)`, same call in build and dev |
| Sitemap, canonical, `og:url` | VitePress sitemap from `siteUrl` | `@astrojs/sitemap` with `site = siteUrl`, under `base`; absent `siteUrl` → none |
| `robots.txt` | default written with `wx` when `siteUrl` is set | unchanged rule, written into scratch `public/` after `publicDir` (consumer wins); under a sub-path base it is inert (crawlers read host-root `robots.txt`) |
| `favicon` key | site-root-relative href | catalog-root-relative, joined with `base`; identical at base `/` |
| `brand.logo` | copied to public root as `/<basename>` | **unchanged**: copied to the catalog root as `<basename>`, linked via `joinBase`. Keeps `favicon: "/logo.svg"` + `brand.logo: "./brand/logo.svg"` configs working (the quality fixture does exactly this) |
| `docsNav[].link` | must start `/docs/` | same rule, joined with `base` |
| `nav[]`, `footer.links[]` | verbatim | verbatim (they may point outside the catalog) |
| dev server | root | serves under `base` |
| README-internal links/images | verbatim | absolute `http(s)`/`mailto:`/`#` kept; every other target neutralised (D2 sanitizer policy) |
| Reserved names | static `p,index,data,docs,assets,404,public` | computed at build (C-027) |

The dist tree itself stays base-agnostic: `outDir` maps to `base` at deploy
time, so `index.ocx.sh` (base `/`) and `ocx.sh/catalog/` get the same layout.

---

## D4 — Package boundary (rev 1)

### Module fate

| Module | Fate |
|---|---|
| `src/config/*`, `src/sources/*`, `src/viewmodel/*`, `src/ci/*`, `build/errors.ts`, `cli/{main,build,dev,exit}.ts` | **kept**; `config` gains `base`/`chrome`; `labels.ts` checks the computed reserved set; `mirror.ts`'s `mirrorSources`/`renderHeaders` gain `base`; `catalog.ts` exports `casUrl` |
| `build/sources_pipeline.ts` | kept; `emitCatalogTree` gains `base`; its `PackageRoute` import moves to `viewmodel/route.ts`, `cacheBaseDir` to `build/cache_dir.ts` (cut these two seams first, on `main`) |
| `build/scratch.ts` | kept, slimmed: the root holds `astro.config.mjs`, `site.json`, `public/`, and `src/content.config.ts` when `docs` is set; never a `src/fetch.ts` (reserved by Astro 7); location rule (`node_modules/.cache/ocx-catalog/`) unchanged |
| `build/engine.ts` | rewritten: `loadConfig → assertOutDirSafe + input-tree guard (C-036) → resolveCatalog → createScratchRoot → assemble public/ → write site.json + astro.config.mjs → astro_runner.build(staging) → promote staging → outDir (C-038) → dispose` (dispose and staging cleanup in `finally`) |
| `build/astro_runner.ts` | **new**: bin resolution, spawn with injected `spawn`, line relay, signal forwarding, exit mapping |
| `build/dev.ts` | **rewritten** as the `astro dev` child supervisor (D5) |
| `build/config_gen.ts`, `build/pages.ts`, `build/dev_worker.ts`, `build/dev_worker_protocol.ts` | **deleted** |
| `cli/out_dir.ts` | kept, extended with the input-tree guard (C-036) |
| `src/theme/**` (72 files) | **deleted**; the 16 pure-TS utils move to `src/site/lib/` with their tests (the `tsconfig` covering `src/site/lib` gets the DOM lib for the browser-only ones); pure logic trapped in `.vue`/composables (`buildTagCopyActions`, `DEFAULT_INSTALL_FLAVORS`/`installCommand`, wire types + `ownerLogin`, fetch cores with dedup + monotonic token, `CatalogPage` URL-state logic, `MetaRail` pin-level logic) is extracted to `src/site/lib/` **before** the swap |
| `scripts/quality-css-cascade.mjs`, `scripts/gen-token-docs.mjs`, `tsconfig.theme.json`, `test/fixtures/local-search-index.mts` | deleted |

### The Astro layer

```
src/build/astro_runner.ts        spawns the astro CLI; the only bin resolver
src/site/astro_config.ts         pure: site input → full AstroUserConfig
src/site/integration.ts          astro:config:setup → injectRoute ×4, updateConfig
                                 (virtual module from site.json, ssr.noExternal
                                 for @ocx-sh/catalog + @ocx-sh/theme),
                                 addWatchFile(site.json); astro:server:setup →
                                 watcher.add(site.json)
src/site/model.ts                siteModel(): pure, builds every page's view
src/site/lib/*.ts                pure TS: utils, URL state, filters, windowing,
                                 copy actions, install flavors, sanitizer
                                 factory, README loader, safe URL helper
src/site/client/*.ts             island modules (grid, palette, versions);
                                 DOM code, unit-tested under happy-dom
src/site/pages/{index,404}.astro, package.astro ([...pkg]), docs.astro ([...slug])
src/site/components/*.astro      PackageCard, PackageRow, Toolbar, VersionList,
                                 MetaRail, InstallCard, ReadmePane, DocsSidebar
```

- `.astro` files keep logic out of frontmatter: they call `src/site/lib`/`model`
  functions and map the result to markup. Convention, enforced by review.
- `set:html` appears in exactly one file, `ReadmePane.astro`, on one
  expression of type `SanitizedHtml` (C-014). No `define:vars` with wire data.
- Shipping: `.astro` files are copied next to the compiled JS into `dist/site/`
  by `postbuild`, and import the compiled `.js` siblings. The generated config
  imports `astro_config.js` by absolute file URL, and route entrypoints are
  resolved with `new URL(…, import.meta.url)`. If Astro 7 insists on bare
  specifiers, they are exported under a `./internal/*` subpath documented as
  non-public. The **tarball** install is the gate (C-026).
- `package.json`: `exports` loses `./theme`; `files` loses `src/theme`;
  `keywords` gains `astro-component`; `description` drops "VitePress".

### Coverage and the acceptance spec

How `.astro` output is tested — options, weighted on black-box fidelity (40),
coverage honesty (30), runtime and memory (30):

| Option | Verdict |
|---|---|
| (1) Subprocess acceptance build of the fixture site in `globalSetup`; suites assert on files | **chosen**: tests the shipped CLI exactly as consumers run it; one build per config |
| (2) Astro container API (`experimental_AstroContainer`) rendering components inside vitest | rejected: a second experimental API, Vite inside vitest's Vite |
| (3) Render pages as TS string templates (no `.astro`) so v8 covers them | rejected: the theme's components are `.astro`; this would copy them |

| Exclusion (`vitest.config.ts`) | Reason |
|---|---|
| `src/cli/index.ts` | unchanged: bin shim, subprocess only |
| `**/*.astro` | v8 does not instrument compiled Astro templates; the built-HTML acceptance suite and the Playwright gates cover them |
| `**/*.d.ts`, lhci configs, quality fixtures | unchanged |
| removed: `src/build/dev_worker.ts`, `**/*.vue`, `src/theme/index.mts` | files deleted |

- `astro_runner.ts` and `dev.ts` are **not** excluded: both take an injected
  `spawn` and are unit-tested against a fake child (exit codes, relay,
  signals, readiness). The real spawn is exercised by the acceptance build.
- `integration.ts` (hooks called with spy `injectRoute`/`updateConfig`/
  `addWatchFile`, no Astro import), `astro_config.ts`, `model.ts`, `lib/` and
  `client/` stay at 100%.
- **Acceptance spec replacing `*_real_build.test.ts`:** `test/global-setup.ts`
  builds `dist/`, then runs the real CLI as a subprocess against committed
  fixture indices in two configurations — base `/` (root source, neutral
  chrome, docs, publicDir, siteUrl) and base `/catalog/` (multi-index,
  `chrome: "ocx"`). Fixture configs sit above their sources (`loadConfig`'s
  containment rule, `src/config/load.ts:179`). Suites under `test/acceptance/`
  parse that output and assert C-004…C-016, C-020…C-022, C-036…C-043. One
  build per configuration per run; heavy gates one at a time.
- **Orphan check** (AGENTS.md rule): every new `lib/` module needs an
  acceptance assertion or a `client/` test proving a shipped page reaches it.
- Behaviour gates (budgets, CLS, images blocked, no early loads, axe,
  Lighthouse 100×4, CSP violations) live in `task quality:web`, out of
  process, one at a time. Floors are re-measured, and each gate is shown red
  once before it lands.
- **Types in `.astro` (CDX, accepted as review-only):** Astro's build does not
  typecheck `.astro` props, and `astro check` is not adopted (it needs an
  Astro project root and `@astrojs/check`, which the hidden-root design does
  not have). Props are typed by `Props` interfaces fed from typechecked
  `src/site/lib`/`model` functions; a prop mismatch surfaces only in the
  acceptance build output. Recorded as review-only coverage.

---

## D5 — Dev mode (rev 1)

| Option | Pros | Cons |
|---|---|---|
| (1) **CLI supervises an `astro dev` child** (follows D1) | dev = build (same config builder, same integration, same `public/` assembly); deletes the custom IPC protocol; Astro's in-place restart does the reload | readiness and port handling live in the supervisor |
| (2) Keep the forked VitePress-era worker shape with IPC | familiar | a protocol whose reason (VitePress under vitest) is gone; dev ≠ build today (`footer`/`docsNav`/`publicDir` omitted in `dev_worker.ts:119-142`) |
| (3) Build + static preview + rebuild on change | one code path | full rebuild per edit; slow at corporate size |

Criteria, weighted: dev = build parity (40), code deleted vs added (25),
reload latency (20), test isolation (15). (1) wins on all four.

**Decision: (1).** Details:

- **Ports (C-001 unchanged).** `--port` given: the CLI probes a bind on
  `127.0.0.1:<port>`; in use → exit 69. Absent: the CLI takes the first free
  port from 4321 upward. Either way the child gets that port with
  `strictPort` and `host: 127.0.0.1`. A bind race between probe and child
  start exits 1 with the child's stderr relayed.
- **Readiness.** The CLI polls `http://127.0.0.1:<port><base>` until 200,
  child exit or a 60 s timeout, then prints the banner (URL including `base`).
- **Signals.** SIGINT/SIGTERM are forwarded to the child; the CLI waits for
  its exit, then removes the scratch root. A child that dies on its own ends
  the CLI with exit 1 after cleanup.
- **`--smoke`.** Boot, request `<base>` and `<base>data/catalog/catalog.json`
  (both 200), stop the child, exit 0, scratch root gone.
- **Watching (CDX V.1).** Astro's restart check compares exact file paths
  (`dist/core/dev/restart.js`, `settings.watchFiles.some(path === changedFile)`,
  verified 7.3.5), so directory watching stays in the CLI. The CLI watches
  the config file, every `path` source root, `docs`, `css`, `publicDir` and
  `brand.logo` with `fs.watch(…, { recursive: true })`, debounced. Any event
  under a watched directory (nested change, add, unlink) triggers a reload.
  The only file Astro watches is `site.json` (`addWatchFile` plus
  `server.watcher.add`, the spike's gotcha).
- **Staged reload.** A reload re-reads the config and re-resolves `path`
  sources only. `url`/`git` results are cached in the CLI process, keyed by
  the source entry, and refetched only when that entry changes or `dev`
  restarts (ARCH-W5). The new `public/` tree and `site.json` are built beside
  the live ones (`public.next/`, `site.json.next`), from scratch, so removed
  files disappear. On success: rename-swap `public/`, then `site.json`, which
  triggers Astro's in-place restart. On failure: print the error with the CLI
  prefix and keep serving the last good state.
- **`base` change.** Respawn the child on the same port with the new config.
  Astro's in-place restart is not relied on for a base change (unverified).
- **Dev server confinement (SEC-F9).** `vite.server.fs = { strict: true,
  allow: [scratch root, this package's dir, the resolved @ocx-sh/theme dir] }`,
  `devToolbar.enabled: false`. A request for `/@fs/<configDir>/.env` returns
  403 or 404 (C-044).

---

## D6 — Migration and rollout (rev 1)

### Options

| Option | Risk | Verdict |
|---|---|---|
| (1) One big branch: docs + renderer together | largest diff, nothing proven before the hard part | rejected |
| (2) **Seams on `main` → docs pilot → renderer → one breaking release** | small steps, each proves something | **chosen** |
| (3) Two renderers behind a flag | compat layer the owner ruled out; doubles the test surface | rejected |

Criteria, weighted: never a `file:` dependency on `main` (hard), earliest
proof of the theme in this repo (35), size of the long-lived diff (35), owner
review load (30).

### Order

1. **Seam cuts on `main` (non-breaking, 0.5.x patch-level, no theme dependency):**
   move `PackageRoute` to `viewmodel/route.ts`, `cacheBaseDir` to its own module,
   extract the pure logic trapped in `.vue`/composables into TS with tests.
   Capture immutable 0.5.3 baselines (merged `catalog.json`, route set) for
   C-002 before any port commit.
2. **Docs pilot (first proving step), on `feat/ocx-theme-port` (ARCH-W8).**
   It needs the `file:` theme dependency, so it gives local proof only and
   reaches `main` together with the theme `v0.2.0` swap (docs PR first). MkDocs
   → Starlight + `ocxTheme()` at base `/apps/catalog/`, `trailingSlash:
   "always"`, no `site`, Pagefind on (claim `search: true`). A separate
   private Astro project in `docs/` with its own `package.json`, so Starlight
   never enters the published package. The processor is Starlight's default
   (Sätteri under Astro 7), chosen explicitly. Content: 21 pages port
   (`customize-components.md` and the generated `theme-tokens.md` are deleted
   with the contract they documented); admonitions → asides, `=== "x"` tabs →
   `Tabs` in `.mdx`, grid cards → `CardGrid`/`LinkCard`, `.md` links → slug
   links checked against built HTML. `pages.yml` builds it, runs `ocx-site
   check --dist` and lychee on PRs. `token_docs_drift.test.ts` is deleted; the
   MkDocs/uv tooling leaves `ocx.toml` (`setup-uv` stays in `ci.yml` for
   zizmor).
3. **Docs host move (ARCH-W7, one-way door).** GitHub Pages keeps deploying
   `ocx-sh.github.io/catalog/` until the website deploy action claims
   `ocx.sh/apps/catalog/`. Then the last GitHub Pages deploy is a tree of
   meta-refresh stubs, one per old URL, each pointing at its new counterpart
   (C-048). `README.md`'s docs pointer switches only after that hand-off.
   MkDocs heading ids and Starlight/Sätteri ids differ in places, so external
   deep links to `#anchor`s can break; stubs redirect the page, not the
   anchor. Recorded, not fixed.
4. **Renderer port on `feat/ocx-theme-port`** (long-lived, `file:` theme
   dependency, never merged while that dependency exists). Order inside:
   config `base`/`chrome` + `url.ts` + `renderHeaders(base)` → `astro_config`,
   integration, runner, landing/404 → detail → islands → docs mount → dev →
   acceptance + quality gates → pack-smoke (tarball) → `task dev:catalog`
   visual comparison → real `../index` render compared with the live site
   (read-only).
5. **Theme `v0.2.0` on npm** (website owner's hardening pass) → both branches
   swap `file:` → `^0.2.0`, regenerate both lockfiles, rerun clean installs,
   acceptance and tarball gates; docs PR merges first, renderer PR second.
6. **Release `0.6.0`** (breaking 0.x minor) through the existing OIDC lane.
7. **Deployment gate for `ocx.sh/catalog` (SEC-F2, owner/index hand-off).**
   Before 0.6.0 output goes live at `ocx.sh/catalog/`, a post-deploy probe of
   one `/catalog/p/…` and one `/catalog/index/<label>/p/…` URL must show
   `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`
   from the `catalog-sandbox` edge rule (C-049). Documented here and in the
   index migration notes; this repo does not execute it.

Branch rule: a CI check on `main` fails when any `package.json` or lockfile
(root or `docs/`) contains a `file:` specifier (C-026). Rebase the renderer
branch on `main` after each seam PR.

### `ocx-sh/index` migration notes (for that repo's PR; this repo never edits it)

- `package.json`: remove `vitepress`/`vue`; bump `@ocx-sh/catalog` to `^0.6`;
  Node ≥ 22.13 in CI and `ocx.toml`.
- `.catalog.config.render.json`: add `"base": "/catalog/"` (or set `siteUrl`
  to `https://ocx.sh/catalog/`, which implies it) and `"chrome": "ocx"` for the
  `ocx.sh` deploy; keep a base-`/` config if `index.ocx.sh` still renders HTML
  until the redirect lands. `favicon` becomes catalog-root-relative.
- `--out site/.vitepress/dist` → any directory outside `docs`/`publicDir`
  (suggest `dist`); the website deploy action uploads it to `/catalog/`.
- `golden-baseline.manifest` pins VitePress dist hashes: regenerate from the
  0.6.0 output. `catalog.json` bytes are unchanged for the same input; HTML is not.
- `task site:preview` called `vitepress preview`: replace with
  `ocx-catalog dev` or any static server over the output.
- 16 docs pages under `site/src/docs/**`: remove VitePress-isms (`{#id}` →
  generated ids and fixed links, `<span v-pre>` → plain code,
  `::: details` → `<details>`); add frontmatter `order` for sidebar order.
- Contract paths survive: `/data/catalog/catalog.json`, `/config.json`,
  `/c/index.json`, `/p/**`, `_headers`, `404.html`, `favicon.svg`, `robots.txt`,
  `/docs/**` — all relative to `base`. Detail URLs gain a trailing slash (OQ3).
- Bunny ignores `_headers`; the `catalog-sandbox` edge rule (website-owned,
  accepted) carries the sandbox at `/catalog/p/*` and `/catalog/index/*/p/*`,
  and the deployment gate (D6 step 7) proves it.
- **Accepted limitation (SEC-D1, decided):** Bunny's deploy prune deletes
  stale `.html` only, so a package removed from the index keeps its wire files
  reachable until a `bunny:gc` exists. Taking down a hostile package needs a
  manual Bunny delete. Documented in known limitations (plan C-034).
- Security note for docs PRs: consumer docs are trusted markdown rendered at
  build; review them like code.

### Release notes must tell corporate mirror consumers

1. Node ≥ 22.13 required. `vitepress`/`vue` peers gone; nothing to install
   besides `@ocx-sh/catalog`.
2. `@ocx-sh/catalog/theme` is removed. The `@layer ocx` override contract,
   `data-slot` hooks and `--ocx-*` component hooks are removed with no
   replacement. `css` still loads last but carries **no stable selector
   contract**; only `:root` token overrides are expected to survive upgrades.
3. New keys: `base` (deploy under a sub-path; defaults from `siteUrl`'s path),
   `chrome` (`neutral` default, experimental). `favicon` and
   `docsNav[].link` are now relative to `base`.
4. More reserved names (ARCH-S3): a label or root-source namespace equal to a
   top-level name the build writes (`_astro`, `sitemap-*`, `robots.txt`,
   `favicon*`, `pagefind`, the `brand.logo` file name, `publicDir` entries…)
   now fails with `INDEX_LABEL_RESERVED`. A 0.5.x config that loaded can stop
   loading.
5. `--out` may no longer equal or contain any input tree, or sit inside
   `docs`/`publicDir` (`OUT_DIR_OVERLAPS_INPUT`, exit 65). A failed build
   leaves the previous output untouched.
6. Detail-page URLs end in `/`; most static hosts redirect the old form, check
   yours.
7. The ⌘K palette no longer searches docs text (packages only); sort/view live
   in the URL; stored view/sort/install-pin preferences are gone.
8. Docs: VitePress-only Markdown syntax is not rendered; `{#id}` anchors are
   not supported; code blocks are unhighlighted; sidebar order comes from
   frontmatter `order`; only `.md` files are mounted.
9. README links and images that are not absolute `http(s)`/`mailto:`/`#` are
   neutralised (relative README links never resolved correctly on the
   catalog's own host anyway).
10. Pages carry a CSP `<meta>`; a consumer `css` file is unaffected, but
    inline scripts injected by a host proxy would be blocked.
11. `_headers` is still emitted (now base-prefixed) and is still a hard
    deployment precondition on hosts that do not read it — translate it.
12. `ocx-catalog build|dev|ci`, flags, exit codes and every multi-index key are
    unchanged. Large indices may need `NODE_OPTIONS=--max-old-space-size`.

---

## Config surface after the port

| Key | Status |
|---|---|
| `sources[]` incl. `label`, `root`, `default`, `excludeFromAll`, `ownerUrl` | unchanged |
| `brand.title`, `brand.wordmark`, `brand.logo`, `nav`, `footer` | unchanged meaning; rejected under `chrome: "ocx"` (`CHROME_OCX_CONFLICT`, mirroring Shell's own throw) |
| `docs` | unchanged meaning; new renderer (glob loader, `**/*.md`) |
| `docsNav` | unchanged rule, joined with `base` |
| `css` | kept, loaded last, no selector contract |
| `publicDir`, `ownerUrl`, `description`, `ci`, `configVersion` | unchanged |
| `siteUrl` | unchanged; its path, when present, is the default `base` and must equal an explicit `base` |
| `favicon` | catalog-root-relative (was site-root-relative) |
| `base` | **new**, default from `siteUrl`'s path, else `"/"` |
| `chrome` | **new**, `"neutral"` (default) \| `"ocx"`; experimental |

`configVersion` stays `1`: every 0.5.x config that does not set `favicon` and
uses no newly reserved name loads and means the same thing.

---

## Contracts

Each contract is checkable from outside the implementation (CLI behaviour,
files in `outDir`, served HTTP, or a pure function's I/O). C-031…C-035 are
plan-local contracts in `plan_ocx_theme_port.md`; ADR contracts continue at
C-036.

| ID | Contract |
|---|---|
| C-001 | CLI surface unchanged: `build [--config] [--out]` (default `./catalog.config.json`, `dist`), `dev [--source\|--config] [--port] [--smoke]`, `ci [--check]`; exit 0/1/64/65/69 for the same failure classes as 0.5.3 (`--source` with `--config` → 64, bad port → 64, config/data error → 65, unreachable `url` source or bound port → 69) |
| C-002 | Multi-index parity: for the same sources, `resolveCatalog` yields the same route set and byte-identical merged `catalog.json` as 0.5.3 (baselines captured on `main` before the port); golden suite unchanged |
| C-003 (rev 1) | Config delta: `base` validated (`BASE_INVALID`, dot segments rejected) and defaulted from `siteUrl`'s path; `BASE_SITEURL_MISMATCH` only when both carry a path and differ; origin-only `siteUrl` with any `base` is valid; `chrome` validated (`CHROME_OCX_CONFLICT`) and described as experimental in the schema; every other 0.5.x key loads with its documented meaning; JSON Schema agrees (`schema-agreement` test) |
| C-004 (rev 1) | Output layout: `index.html`, `404.html`, `<route>/index.html` per `PackageRoute`, `data/catalog/catalog.json` (merged, last write), `index/<label>/**` per source + root mirror, `_headers`, `publicDir` files, `brand.logo` at `<basename>`, `docs/**/index.html` when `docs` set, sitemap and default `robots.txt` only when `siteUrl` set (a `publicDir` `robots.txt` wins); every emitted favicon `href` resolves to a file in `outDir`; mirrored wire files byte-equal to the source |
| C-005 (rev 1) | Base containment: with `base: "/catalog/"`, every root-relative `href`/`src`/`srcset`/`action` in emitted HTML/CSS/JS, README content included, starts with `/catalog/`, except user `nav`/`footer` links and ocx-mode chrome links; no absolute URL names a third-party origin other than source data, `nav`/`footer` and ocx chrome; `ocx-site check --dist <d> --repo ocx-sh/index --path /catalog/` passes on the `/catalog/` fixture build |
| C-006 (rev 1) | `_headers` = today's blocks with every pattern prefixed by `base` (`/catalog/p/*`, `/catalog/index/<label>/p/*`); `base` reaches `renderHeaders` through `emitCatalogTree` → `mirrorSources` in both build and dev |
| C-007 (rev 1) | Read-only: a build writes nothing outside `outDir`, its staging and retired siblings (C-038), the url cache dir, the git clone `mkdtemp` dir (`os.tmpdir()`, `src/sources/git.ts:194`) and its scratch root; all but `outDir` and the url cache are gone at exit; source trees are unmodified (a `git` source fixture is exercised) |
| C-008 (rev 1) | `catalog.json` `logoUrl`/`readmeUrl` stay catalog-root-relative: the golden test asserts none contains `base` and none starts with `//`; every client reader resolves them with `joinBase` |
| C-009 | Route rule: every detail link in built HTML and in island-rendered DOM equals `packageHref(name, indexes, base)`; `packageHref` is the only producer (grep test) |
| C-010 | Landing SSR: `index.html` has exactly `min(24, n)` cards of the default scope in `name` order, each a link; toolbar rendered in final state |
| C-011 | Interaction: no `catalog.json` request and no island chunk before first pointer/focus/key/touch on the catalog region; first interaction fetches `catalog.json` once; state mirrored to `?q=`/`?index=`/`?sort=`/`?view=` via `replaceState`; a state-bearing cold URL boots at load without layout shift |
| C-012 | Filter semantics unchanged (AND within a facet, keyword rail from survivors with pinned actives, popover whole-catalog, table platform columns whole-catalog, `excludeFromAll` narrows "all" only, palette ignores it) |
| C-013 | Detail SSR: title, description, status and deprecation/yank banners, `supersededBy` link (safe-path checked, route rule), latest version, install command, platform matrix, license/source/revision, owners (template + `safeHref`, plain text on `null`) present in `<route>/index.html` without JS |
| C-014 (rev 1) | README sanitisation: rendered at build via `html:false` markdown + `createReadmeSanitizer(window)` (injected JSDOM window, shared `SANITIZE_CONFIG`, D2 link/img policy, recycled every ~500 documents); returns branded `SanitizedHtml`; `set:html` appears only in `ReadmePane.astro`, once (grep test); a hostile corpus (`<script>`, `javascript:`/`java&#9;script:`/`data:` links, raw HTML, `on*`, svg/math/noscript/style nesting) renders inert; `dompurify >=3.4.0` (version test) |
| C-015 | Logos only as `<img>` with intrinsic width/height; no wire SVG inlined |
| C-016 | Wire URLs built from bare `ns`/`pkg` via `wirePrefix`/`casUrl` + `joinBase`, never `root.name`, the route, or string-concatenated `wireBase`; version list SSRs newest 20 tags, the rest on interaction |
| C-017 | Budgets on the fixture site (landing with ≥ 24 default-scope packages, N=24, and one detail page): HTML ≤ 14.2 KB gz, pre-input JS ≤ 11 KiB gz, DOM ≤ 800, CLS 0, identical with images blocked, Lighthouse 100×4 mobile, axe clean |
| C-018 | Single install-command source: `DEFAULT_INSTALL_FLAVORS`; no `ocx …` command literal elsewhere in `src/site/**` (grep test, ported) |
| C-019 | ⌘K palette: `Mod+K` opens it, it searches packages only, results navigate via C-009 |
| C-020 (rev 1) | Docs mount: each `**/*.md` file under `docs` renders at `<base>docs/<slug>/` (no `.mdx`); heading ids on a fixture page match the asserted values; sidebar lists every page grouped by directory, ordered by frontmatter `order` then title; header docs links from `docsNav` |
| C-021 | Chrome: `neutral` renders brand title/wordmark/logo, `nav`, `footer` and no ocx.sh ecosystem menu; `ocx` renders the `nav.json` header |
| C-022 | Head/SEO: per-page title/description/OG from `descLookup` (generic fallback when `null`); canonical/`og:url` and sitemap only with `siteUrl` |
| C-023 (rev 1) | Dev parity: `dev` serves the same routes, chrome, footer, docs, `publicDir`, `_headers` and `catalog.json` bytes as `build` for one config, under `base` (same `astroConfig()` and `public/` assembly); `--smoke` exits 0 and leaves no scratch root; SIGINT stops the child and leaves no scratch root |
| C-024 (rev 1) | Dev reload: editing the config, a nested file in a `path` source, adding a package, removing a file, or editing a docs file serves new content without restarting the process; `url`/`git` sources are not refetched unless their entry changed; an invalid edit prints the error and keeps serving the last good state; a `base` change respawns the child on the same port |
| C-025 (rev 1) | Astro isolation: no file in `src/**` value-imports `build`, `dev`, `preview` or `sync` from `"astro"` (grep test; `import type`, hook-name strings, `astro:content` and other framework virtual modules allowed); only `astro_runner.ts` resolves the `astro` bin; every child gets `ASTRO_TELEMETRY_DISABLED=1` and `ASTRO_DISABLE_UPDATE_CHECK=true`; `ocx-catalog ci` never spawns Astro |
| C-026 (rev 1) | Packaging: a tarball install builds the fixture site; `exports` has no `./theme`; `engines.node` `>=22.13`; no `file:` specifier in any committed `package.json` or lockfile on `main` (CI check, shown red once); `release.yml` publish keeps `npm ci --ignore-scripts` (asserted) |
| C-027 (rev 1) | Reserved names are computed per build: the static list (`p`, `index`, `data`, `docs`, `assets`, `404`, `public`, `_astro`, `sitemap-*`, `robots.txt`, `favicon*`, `_headers`, `config.json`, `c`, `pagefind`) plus every top-level name the build writes (`publicDir` entries, the `brand.logo` file name); compared case-insensitively against non-root labels and root-source namespaces (`INDEX_LABEL_RESERVED`); no mirror write targets a path already written to the output except the merged `catalog.json` |
| C-028 (rev 1) | Coverage 100% with exactly the exclusions in D4's table (`src/cli/index.ts`, `**/*.astro`, `**/*.d.ts`, lhci configs, quality fixtures); `astro_runner.ts` and `dev.ts` are not excluded |
| C-029 | Docs site: builds with Starlight + `ocxTheme()` at `/apps/catalog/`; `ocx-site check --dist` clean; Pagefind bundle present; lychee clean; no page links to the removed theme docs |
| C-030 | No compat layer: importing `@ocx-sh/catalog/theme` fails to resolve (pack-smoke asserts) |
| C-036 | Output guard: before any write, `--out` (after `realpath`) is refused with `OUT_DIR_OVERLAPS_INPUT` (exit 65) when it equals or contains the config dir, any `path` source root, `docs`, `css`, `publicDir` or the `brand.logo` file, or lies inside `docs` or `publicDir`; the scratch-root refusal of 0.5.3 is unchanged |
| C-037 | README fault isolation: a README over 1 MiB (the mirror's `MAX_CAS_ASSET_BYTES`, applied before render), missing from the mirror, failing to render or sanitise, or failing the idempotency tripwire renders a "README unavailable" pane and one stderr warning naming the package; the build still exits 0 |
| C-038 | No partial output: Astro builds into a fresh sibling staging dir of `outDir`; only a fully successful build promotes it (rename `outDir` aside, rename staging into place, remove the old tree); a failure during public assembly, render or promotion leaves the previous `outDir` byte-unchanged and removes the staging dir |
| C-039 | URL joins: `joinBase` throws for a path not matching `^/(?!/)`, containing `\`, a control character, or a `.`/`..` segment (`joinBase("/", "//evil.example")` throws); the root source's `wirePrefix` is `""` and its CAS URLs start `/p/`, never `//p/` |
| C-040 | Inlined data and generated source: inline JSON uses one `jsonForScript()` (`JSON.stringify(x).replace(/</g, "\\u003c")`); the generated `astro.config.mjs` interpolates exactly two `JSON.stringify`'d paths (tests: `"`, `\`, `${`, newline, U+2028); no `define:vars` with wire data; no `innerHTML`/`outerHTML`/`insertAdjacentHTML` in `src/site/client/**` (grep test, shown red once); keyword links use `encodeURIComponent` |
| C-041 | Hostile metadata: a fixture package whose description, keywords, license, owner login, tag names, `supersededBy`, `ownerUrl` and `wireBase` carry `"`, `\n---`, `</script>`, `${…}` and `<img onerror>` renders inert in built HTML and in island DOM |
| C-042 | One URL sink: every wire-derived `href`/`src` goes through one `safeHref`-based helper returning the canonical `parsed.href` or `null`; a grep test fails on any other `href={`/`src={` expression fed from wire data in `src/site/**` |
| C-043 | Page CSP: every built HTML page carries a CSP `<meta>` with `script-src 'self'` + SHA-256 hashes, `object-src 'none'`, `base-uri 'none'`, `style-src 'self' 'unsafe-inline'`; no inline `<script>` whose hash is missing from the policy; Playwright reports no CSP violation on the fixture pages |
| C-044 | Dev confinement: dev binds `127.0.0.1` only; `vite.server.fs.strict` with `allow` = scratch root, this package's dir, the resolved theme dir; `/@fs/<configDir>/.env` → 403 or 404; dev toolbar off |
| C-045 | Pinned Astro settings: `astroConfig()` sets `compressHTML` explicitly, `build.inlineStylesheets: "never"`, `build.concurrency: 1`, `trailingSlash: "always"`, `build.format: "directory"`, `devToolbar.enabled: false`, `markdown.syntaxHighlight: false`, bundler options only under `rolldownOptions`; the scratch root never contains `src/fetch.ts` (unit test on the pure builder) |
| C-046 | Render subprocess: `build` and `dev` run `node <astro bin> build\|dev --root <scratch> --config <scratch>/astro.config.mjs`; child output reaches stderr line by line with the `ocx-catalog:` prefix; a non-zero child exit maps to exit 1; scratch and staging dirs are removed on success, failure and SIGINT |
| C-047 | Data handoff: `site.json` holds route keys and small views only (no README body, wire root or image index); detail pages read README bytes from the mirrored CAS file; the 10k-with-READMEs measurement is recorded before the model shape is frozen |
| C-048 | Docs host move: once `ocx.sh/apps/catalog/` serves the docs, every old `ocx-sh.github.io/catalog/<page>/` URL serves a meta-refresh stub to its new counterpart; until then GitHub Pages keeps deploying the old site |
| C-049 | Deployment gate (documented hand-off): before `ocx.sh/catalog/` serves 0.6.0 output, `/catalog/p/…` and `/catalog/index/<label>/p/…` respond with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` |

---

## Risks (rev 1)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `astro` CLI flags or config semantics change in a minor | low | build breaks | `~7.N` pin; acceptance build on every PR; Renovate/Dependabot `astro` bumps need it green |
| The spike's tarball resolution result does not carry over from the programmatic API to the CLI path | low | packaging rework | the first engine step re-runs the spike's tarball case through the spawned CLI; `./internal/*` export fallback |
| Large READMEs push detail pages over 14.2 KB gz | high on real data | Lighthouse < 100 on those pages | OQ1 |
| `jsdom` at runtime: install size, build memory at 10k READMEs | medium | slower builds | injected window recycled every ~500 docs; 10k measurement (C-047). Swapping jsdom for `linkedom`/`happy-dom` is **not** local: DOMPurify's mXSS guarantees are tested against real browser-like parsers, so a swap re-opens the sanitizer review |
| Child-process handling (signals, orphaned children, port race) | medium | stale dev servers, leaked scratch dirs | signal forwarding and `finally` cleanup unit-tested with a fake child; C-023/C-046 acceptance |
| Long-lived branch drift while theme v0.2.0 is pending | medium | painful rebase | step 1 seam cuts land first; rebase after each |
| Library requests slip | medium | blocked steps | each request lists a workaround; none blocks the docs pilot; R7 blocks only C-043 |
| `file:` symlink hides `node_modules`-only resolution bugs | high | broken publish | tarball install in pack-smoke is mandatory |
| Stale wire files on Bunny after a package is removed | certain until `bunny:gc` | hostile content stays reachable | accepted (SEC-D1); manual delete; documented |

### One-way doors (flagged)

1. **Detail-page URL shape** under `/catalog/` (trailing slash, OQ3).
2. **New public config keys `base` and `chrome`.** Names and semantics persist
   into 1.0 (`chrome` marked experimental to keep its values open).
3. **`catalog.json` URL fields defined as catalog-root-relative.**
4. **Removing `@ocx-sh/catalog/theme` and the override contract** — owner-ruled.
5. **Docs host move** `ocx-sh.github.io/catalog/` → `ocx.sh/apps/catalog/`
   (ARCH-W7): external links and anchors depend on it; stubs cover pages, not
   anchors.

Everything else (dependency vs peer for `astro`, subprocess vs in-process
rendering, palette scope, static pagination, the `site.json` handoff) is a
two-way door.

---

## Library requests (rev 1)

Sent one message per row to the website session (`ocx-website-*`). The website
session's numbering is in brackets. Prefer composition: the grid, cards,
table, palette and toolbar are composed from existing components.

| # | Need | State | Workaround meanwhile |
|---|---|---|---|
| R1 [4] | `layouts/Shell.astro` committed; `brand.logoSrc` rendered in a reserved logo box | **accepted**, ships in one SHA with R2, SHA pending | `Page.astro` fallback layout from `tokens.css`/`base.css`/`fonts.css` |
| R2 [5] | `@ocx-sh/theme/lazy` exporting `mount(root, { load, trigger, replay })` | **accepted**, same pending SHA as R1 | islands code against a `LazyMount` interface and a test double (plan C-033) |
| R3 [6] | `ocx-site check` on non-HTML data trees in a claim's dist | **resolved, no change needed**: the library accepts `p/**`, `index/**`, `data/**`, `_headers` as they are | none needed |
| R4 [8] | `keywords: ["astro-component"]` in the theme's `package.json` | **accepted**, pending | explicit `ssr.noExternal` for the theme (kept after it lands) |
| R5 [7] | `.hljs-*` token colours for `.ocx-prose pre` from `--ocx-color-code-*` tokens | **accepted**, pending | code blocks render without token colours |
| R6 | generic link card | **not requested**: cards are hand-composed from tokens | — |
| — | `catalog-sandbox` Bunny edge rule | **accepted**, pending; now a deployment gate (C-049) | `_headers` still emitted; documented as inert on Bunny |
| **R7 (new)** | CSP hashes for the theme's inline scripts | **to send** | ship without page CSP (C-043 red, release-blocking) until it lands |

R7 detail:

- **Need:** the SHA-256 CSP sources of every static `<script is:inline>` the
  theme emits, as a library export.
- **Why:** C-043. Verified in `astro@7.3.5` `dist/core/csp/common.js`:
  `security.csp` hashes bundled/inlined, directive, `injectScript` and island
  scripts only, never `is:inline`. `Shell.astro:39-40` emits `THEME_SCRIPT`
  and `PLATFORM_SCRIPT` from `src/head-scripts.mjs`, which `package.json`
  does not export, so the catalog cannot hash them itself.
- **Proposed API:** `@ocx-sh/theme/csp` exporting `INLINE_SCRIPT_HASHES:
  string[]` (`'sha256-…'`) covering every static inline script of `Shell` and
  any component a consumer may compose (`CommandBar`'s `PRE_PAINT`, `Tabs`'
  restore script if static), kept in sync by a theme test. The catalog passes
  it to `security.csp.scriptDirective.hashes`.
- **Workaround:** none acceptable. Hashing whatever inline scripts appear in
  the built HTML would allow-list anything, which defeats the policy.

Heads-up (not a request): `components/base-url.mjs` `withBase` mis-joins paths
that start with the base's own first segment (`/index/x` under base `/index/`).
Also noted: `Shell.astro` ocx mode links `/favicon.svg` root-absolutely; fine
on `ocx.sh`, listed in C-005's ocx-chrome allowance.

---

## Open questions (owner)

1. **OQ1 — README size vs the 14.2 KB HTML budget.** Real READMEs exceed it.
   Options: SSR the full README (capped at 1 MiB by C-037) and sign a Spec
   Delta excluding README payload from the detail-page HTML budget; truncate
   at a byte budget with a "read more" link to the source forge; or fetch the
   README on interaction. **Recommendation:** full SSR plus the Spec Delta —
   the README is the page's content, and the budget gate stays strict on the
   fixture page.
2. **OQ2 — Consumer docs mount.** Keep `docs` (glob loader in Shell, derived
   sidebar, `.md` only, unhighlighted code in v1), or drop it and move
   `ocx-sh/index`'s 16 pages elsewhere. **Recommendation:** keep; it costs one
   injected route and one collection and keeps corporate mirrors
   self-contained.
3. **OQ3 — Detail URL shape.** `/catalog/<ns>/<pkg>/` (trailing slash,
   directory format) vs `/catalog/<ns>/<pkg>` (today's `cleanUrls`).
   **Recommendation:** trailing slash; every URL already moves with
   `/catalog/`, so the redirect map is written once, and directory output
   serves correctly on every static host.

## Boundary and convention notes

- **Innovation tokens:** `astro` (replaces `vitepress`+`vue`, net zero),
  `@astrojs/sitemap` (official, replaces VitePress's built-in sitemap),
  `jsdom` promoted from dev to runtime dependency (DOMPurify's documented
  server path). `reka-ui`, `@vueuse/core`, `@fontsource/*`, `dompurify`'s
  client-only use and the Vue toolchain leave.
- **Coverage exclusions:** none added. `dev_worker.ts`, `**/*.vue` and
  `src/theme/index.mts` leave the list with their files.
- **Not testable, review-only:** `.astro` frontmatter stays logic-free;
  `.astro` props are not typechecked (`astro check` not adopted, see D4);
  `.astro` files are not linted (`eslint-plugin-astro` not adopted).
- **`subsystem-theme.md` rules that do not survive:** `@layer ocx` wrapping,
  `v-show` hydration rule, Vue composable conventions, `useData().isDark`
  dark mode (the theme's head script owns it now).
- **`product-context.md` deployment section** gains the Bunny edge rule as the
  `ocx.sh` translation of `_headers` and the C-049 gate; its "Status" section
  changes at release.

## Consequences

- The site becomes server-rendered first, interaction-loaded second; the SPA
  composables and their module-level caches disappear with Vue.
- Astro runs only in a child process; the CLI process stays a Node program
  with no Vite inside it, which keeps the test harness and the `ci`
  subcommand free of Astro.
- `subsystem-theme.md` is rewritten as `subsystem-site.md` (route identity,
  CAS gotcha, sanitisation boundary, install-command source, filter
  invariants, URL sink and CSP rules carry over; `@layer ocx`, Vue conventions
  and the `.vue` exclusion go). `quality-css-overrides.md` is deleted;
  `quality-design-tokens.md` points at the theme's tokens. The rules catalog
  changes in the same commit.
- Scale is measured, not waved off: the 10k-with-READMEs measurement (C-047)
  runs before the data shape freezes, and the 250-package bulk quality site
  keeps measuring on every gate run.

---

## Revision 1 (2026-10-07)

Answers `review_ocx_theme_port_round1.md`. One line per triage ID.

Section A:

- **ARCH-W2** — added option (a′) subprocess `astro` CLI; it wins 3.75 vs 3.45; D1, D4, D5, C-025, C-028 rewritten; C-046 added.
- **ARCH-W3** — hard gates (budgets, corporate mirrors) applied before scoring; (c) and (d) removed by gates; "owner approved" no longer scored; contract criterion scored 4, not 5, for both CLI options.
- **ARCH-W1 / RES-S8** — `site.json` carries keys and small views only; READMEs read per page from the mirrored CAS file; 10k measurement step; heap via inherited `NODE_OPTIONS`, `build.concurrency: 1` (C-047, D2).
- **ARCH-W4 / CDX T.1** — README fault isolation with the mirror's 1 MiB cap shared by construction (C-037).
- **ARCH-W5** — dev caches `url`/`git` results per source entry; `base` change respawns the child (D5, C-024 rev 1).
- **ARCH-W6 (decided)** — recorded as accepted trade-off in D2 landing rules (URL sort/view; view/sort/install-pin storage dropped).
- **ARCH-W7** — docs host move listed as one-way door 5; meta-refresh stubs (C-048); anchor breakage noted.
- **ARCH-W8** — docs pilot moved onto `feat/ocx-theme-port`, local proof only, lands with the v0.2.0 swap, docs PR first (D6 step 2).
- **ARCH-S1** — `base` defaults from `siteUrl`'s path; mismatch only when both carry a path (D3, C-003 rev 1).
- **ARCH-S2** — `chrome` marked experimental in the schema description (D2 Chrome, C-003 rev 1).
- **ARCH-S3** — release note 4 on newly reserved names.
- **RES-W1** — `engines.node >=22.13`; CI Node 24 / npm 11 (D1, C-026 rev 1).
- **RES-W2** — Sätteri chosen explicitly for docs mount and pilot; heading ids asserted; `{#id}` recorded as a deviation (D2 docs mount, C-020 rev 1).
- **RES-S9/S10** — Astro settings pinned in the pure config builder; `rolldownOptions`; no `src/fetch.ts` (C-045).
- **RES-S6** — unlabelled README fences render as plain escaped text (D2 README row).
- **RES-S13** — MiniSearch first-keystroke INP measured; prebuilt `toJSON` index fallback (D2 landing).
- **SEC-F7** — page CSP via `security.csp`; verified `is:inline` is not hashed; new library request R7 (D2 page security, C-043).
- **SEC-F8** — superseded by (a′): telemetry and update-check variables are set in the child env and the CLI never imports Astro; `devToolbar` off; third-party-origin check folded into C-005 rev 1.
- **SEC-F9** — dev server `fs.strict` allow-list, `127.0.0.1` (D5, C-044).
- **SEC-F6 / SEC-D3 / RES-S7 (decided)** — sanitizer link/img policy recorded in D2; C-005 rev 1 now covers README content.
- **SEC-D1 (decided)** — Bunny stale wire files accepted for v1; manual takedown; migration notes and Risks.
- **CDX/SPEC-B3 (C-025)** — isolation narrowed to runtime value imports; type imports and virtual modules allowed (C-025 rev 1).
- **CDX stated-convention (`astro check`)** — recorded as review-only coverage with the reason (D4).

Section B items that change a design statement or contract:

- **SEC-F1** — sanitizer factory with injected, recycled JSDOM window, tripwire, `dompurify >=3.4.0`; "local swap" claim removed from Risks (D2, C-014 rev 1).
- **SEC-F2** — `catalog-sandbox` probe is a deployment gate (D6 step 7, C-049).
- **SEC-F3** — `joinBase` input rules; wire URLs via existing `wirePrefix`/`casUrl` (code was already correct at `catalog.ts:191`; the ADR's formula produced `//p/…`) (D3, C-039).
- **SEC-F4** — base regex rejects dot segments (D3, C-003 rev 1).
- **SEC-F5** — reserved names computed per build, applied to labels and root namespaces, mirror overwrite check (C-027 rev 1).
- **SEC-F10** — `jsonForScript`, two-string generated config, DOM-sink grep (C-040).
- **SEC-F11** — hostile-metadata fixture (C-041).
- **SEC-F12** — single `safeHref`-based URL sink (C-042).
- **SEC-F13** — branded `SanitizedHtml`, one `set:html`, docs glob `**/*.md` only (C-014 rev 1, C-020 rev 1).
- **SEC-F14** — `file:` guard scans lockfiles; `npm ci --ignore-scripts` asserted (C-026 rev 1).
- **SEC-S2** — golden asserts no `base` and no `//` in `catalog.json` URLs (C-008 rev 1).
- **CDX S-001/E.3** — output guard against input trees (C-036).
- **CDX B.3** — `base` threaded through `emitCatalogTree` → `mirrorSources` → `renderHeaders` (D3 table, C-006 rev 1).
- **CDX E.5** — staged output with atomic promotion (C-038, D4 engine order).
- **CDX favicon** — `brand.logo` stays at the catalog root under its basename; favicon targets asserted (D3 table, C-004 rev 1).
- **CDX robots** — consumer-wins `wx` write kept (D2 handoff, C-004 rev 1).
- **CDX C-007** — git clone `mkdtemp` dir and staging siblings in the write-location contract (C-007 rev 1).
- **CDX V.1 (directory watching, staged reload)** — CLI-side recursive watching, staged `public.next`/`site.json.next` swap (D5, C-024 rev 1).
- **CDX CW.5** — fixture configs above their sources (D4 acceptance spec).
- **CDX G.1** — ≥ 24-package fixture for the N=24 budget (C-017).
- **CDX G.4** — `ocx-site check` command form in C-005 rev 1.
- **CDX C-002** — 0.5.3 baselines captured before the port (D6 step 1, C-002).
- **CDX D.6** — GitHub Pages keeps deploying until the hand-off (D6 step 3, C-048).
- **SPEC-W18** — client modules receive `base` through `data-base`/mount options (D2 landing).

Rejected or narrowed after checking the code:

- **SEC-F5, `brand` in the static reserved list** — narrowed: with the
  favicon fix the build no longer writes a `brand/` directory, so `brand` is
  not reserved; the logo's actual file name is (computed set).
- **ARCH-W5, "handle a `base` change in dev via `updateConfig`"** — replaced:
  whether Astro's in-place restart applies a new `base` to the running dev
  server is unverified; the supervisor respawns the child instead.
- **SEC-F8, "set the variable in `cli/main.ts` before a lazy import"** —
  superseded by (a′), not wrong: no in-process import exists any more.
