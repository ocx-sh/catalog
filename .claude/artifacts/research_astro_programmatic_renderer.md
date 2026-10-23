# Research: Astro as the programmatic renderer for `@ocx-sh/catalog`

Date: 2026-10-07. Role: researcher (ecosystem). Scope: replace the programmatic VitePress
driver (`src/build/engine.ts`, `dev.ts`, `scratch.ts`, `config_gen.ts`, `pages.ts`) with Astro,
plus a shared `@ocx-sh/theme` Astro component library.

Evidence labels: **[verified]** = I ran it (scratch experiments, below) or read the installed
package source; **[docs]** = Astro docs via Context7 / docs.astro.build; **[unverified]** =
inferred or only seen in search snippets, treat as a hypothesis.

## Recommendation

1. **Target Astro 7 (current `latest` = 7.3.6, released 2026-06-22 as 7.0.0), not 5 or 6.**
   `@astrojs/starlight@0.42.5` peers `astro ^7.2.10` [verified, `npm view`], so "Starlight-compatible"
   means Astro 7. Astro 6 and 7 both need **Node >= 22.12**; Astro 5.18 still allows Node 20.3+
   but is two majors behind [verified, `npm view astro@N engines`]. **This package's `engines`
   (`>=20.19`) must move to `>=22.12`.** Astro 7 runs on Vite 8 + Rolldown and a Rust compiler;
   the repo's Vitest/Vite toolchain should be checked for Vite 8 interplay (not tested here).
2. **Keep the architecture shape you already have; change what is inside it.** The CLI calls
   `build()` / `dev()` from `astro` in-process with `configFile: false`, an inline config, and a
   thin scratch `root`. The package ships **one Astro integration** (`@ocx-sh/catalog/integration`)
   that `injectRoute()`s every page from `node_modules` and exposes the resolved view-model as a
   **Vite virtual module**. Nothing is synthesized as markdown any more. I built this end to end
   (build, dev, base path, symlinked and tarball installs) and it works.
3. **Packages: `getStaticPaths()` over a virtual module, not the Content Layer.** 10,000 pages
   built in **5.5 s / 590 MB RSS** this way (plain HTML per package) versus **17.6 s / 3.1 GB**
   through a custom Content Layer loader rendering the same READMEs. Use the Content Layer
   `glob()` loader only for the optional user `docs` mount (works with an absolute `base`
   outside the root; no copy needed [verified]).
4. **Islands: do not rely on `client:idle|visible|only`.** All three load JS without a user
   gesture. Register a **custom `client:interaction` directive** via `addClientDirective` (Astro
   documents this exact pattern with `client:click` [docs]); I built and verified it: JS stays
   unfetched until first pointer/focus/key/touch. Server islands need an adapter and a runtime,
   so they do not apply to a static catalog [docs].
5. **Dev reload works, but needs two lines.** `addWatchFile()` alone does nothing for files
   outside the root; also call `server.watcher.add(file)` in `astro:server:setup`. Then an edit
   to the data file triggers Astro's in-place container restart and the new data is served
   [verified].
6. **Biggest risk is not technical, it is stability:** the programmatic API is documented as
   **experimental** ("API signature may change") [docs]. Mitigation: confine all `astro` imports
   to one adapter module (`src/build/astro_runner.ts`), pin `astro` to a minor range, and keep a
   smoke test that runs a real `build()` against the fixture catalog (the same "orphaned module"
   rule `AGENTS.md` already states).

No mainstream precedent exists for "an npm package whose CLI drives Astro programmatically
against a hidden scratch root" (see Q3). Starlight and TutorialKit both are *integrations inside
a user-owned Astro project*. Your design is a legitimate but less-travelled path; the experiments
below are the evidence that it holds.

## Method (what was actually run)

Scratch dirs under the session scratchpad (not in the repo). Astro 7.3.6, Node 24.14, Linux/WSL2.

- `exp/`: package `fake-catalog` installed via `npm i ./pkg` (symlink, like a `file:` dep), exporting an integration that
  `injectRoute()`s `/p/[...pkg]` and `/` from `.astro` files inside the package, reading data through a
  Vite virtual module. Driven by a script calling `build({ root, configFile: false, outDir, base: '/catalog/', site, integrations })`.
- `exp2/`: same package installed from an `npm pack` tarball (a real copy in `node_modules`), scratch root at
  `node_modules/.cache/oc/root` (mirrors `scratch.ts`'s current location rule), plus a second package
  (`fake-theme`) imported by bare specifier for `.astro` components.
- Data: 1,000 and 10,000 synthetic packages; a markdown variant with ~1.2 KB READMEs containing a
  code fence, table and headings (Shiki highlighting on).

## Q1. Astro programmatic API

**Stability.** Documented as experimental: "These APIs are experimental and their API signature may
change" [programmatic-reference](https://docs.astro.build/en/reference/programmatic-reference/).
It has existed since Astro 3 (upgrade guide: "new experimental JavaScript APIs ... `dev`, `build`")
and survived 4, 5, 6 and 7 without removal [docs, Context7 `/withastro/docs`, v3 upgrade page].

**Surface** [docs]:
- `build(inlineConfig, options?)`; options `devOutput` and `teardownCompiler` (default `true`; set false only when
  building several projects in one process).
- `dev(inlineConfig)` -> `{ address, handle, watcher, stop() }`. Note `watcher` is the Chokidar instance.
- `preview(inlineConfig)` -> `{ host, port, stop(), closed() }`.
- `sync(inlineConfig)`: type generation only; `build()` already generates `.astro/` in the root [verified: `.astro/types.d.ts`,
  `content.d.ts` appeared in the scratch root after `build()`], so `sync()` is not needed.
- `mergeConfig`, `validateConfig` helpers.

**Inline config.** `AstroInlineConfig extends AstroUserConfig` plus `configFile` (`false` disables file loading), `mode`,
`logLevel` [verified in `dist/types/public/config.d.ts`]. `root`, `outDir`, `base`, `site`, `integrations`, `vite`,
`publicDir`, `server.port`, `build.format` are all ordinary `AstroUserConfig` fields and were honoured inline [verified:
`/catalog/` base produced `href="/catalog/p/ns0/pkg0"`; dev served under `/catalog/`].

**New in Astro 7: `logger`.** `AstroUserConfig.logger` accepts a custom handler or `logHandlers.json(...)`
[verified in the 7.3.6 type comments, `@version 7.0.0`; reference: https://docs.astro.build/en/reference/logger-reference/].
Use it to route Astro output through the CLI's own reporter instead of its default console output.

**Exit and error behaviour** [verified]:
- `build()` and `dev()` never call `process.exit` (the `process.exit` calls in `dist/cli/*` belong to the `astro` binary only).
  A 1,000-page build returned and the process ended on its own (no dangling handles).
- Failures **throw**: an `injectRoute` entrypoint that does not resolve rejected `build()` with an `ENOENT` `Error`; the process
  stayed alive with `exitCode` unset. Map thrown errors to the existing `BuildError` / sysexit mapping.
- `dev().stop()` returned cleanly.
- **Telemetry:** Astro telemetry is on by default and `dev()` records an event
  (`telemetry.record(eventCliSession(...))`, `dist/core/dev/dev.js`). A wrapper CLI must set
  `ASTRO_TELEMETRY_DISABLED=1` (read at call time by `@astrojs/telemetry`) before invoking Astro; otherwise users of
  `ocx-catalog` get Astro telemetry they never opted into. `dev()` also starts a background npm update check
  (`shouldCheckForUpdates`) [verified in source; how to switch it off programmatically: not checked].

**Root / scratch root.** An essentially empty directory is a valid `root` when `configFile: false` and everything is inline;
no `src/pages`, no `package.json` needed [verified]. Astro writes `.astro/` (types, and the content data store when collections
exist) under the root, so keep the root disposable, as today. Running from a package installed in `node_modules` against a
scratch root inside `node_modules/.cache/` worked for both a symlinked and a tarball install [verified].

**Programmatic integrations.** `integrations: [catalog({...})]` inline works; hooks used: `astro:config:setup`
(`injectRoute`, `updateConfig`, `addWatchFile`, `addClientDirective`), `astro:server:setup`, and `astro:build:done`
[verified except `astro:build:done`, which is documented: https://docs.astro.build/en/reference/integrations-reference/].

## Q2. Generating thousands of pages from external data

### Options compared

| Approach | 10k pages (README rendered, Shiki on) | 10k pages (no markdown) | Notes |
|---|---|---|---|
| `injectRoute` + `getStaticPaths()` + virtual module [verified] | **11.3 s, 2.2 GB** with direct Sätteri rendering in `getStaticPaths` | **5.5 s, 590 MB** | Simplest; no collection config; data freshness = whatever you pass in |
| Content Layer, custom inline loader, `renderMarkdown()` + `render(entry)` [verified] | **17.6 s, 3.1 GB** (second identical run 17.5 s, no cache benefit because my loader re-set every entry) | n/a | Adds a persisted data store and a content-config requirement |
| Live collections (`defineLiveCollection`, `src/live.config.ts`) [docs] | n/a | n/a | Runtime-fetched data, needs on-demand rendering; wrong tool for a static catalog |

Absolute numbers are from a WSL2 box with synthetic data; the ratio is what matters. Markdown+Shiki cost about
~1.1 ms/page and dominates; the route machinery itself is cheap (~0.5 ms/page). The Content Layer path costs roughly +55% time and
+45% memory over direct rendering. Memory (2 to 3 GB at 10k) is the real ceiling: it scales with README size
and `props` size, since `getStaticPaths` props live in memory for the whole build. Keep per-page props to ids/small objects
and render READMEs lazily if packages exceed ~10k [unverified beyond 10k].

### `injectRoute` from `node_modules` [verified + docs]

`injectRoute({ pattern: '/p/[...pkg]', entrypoint: '<package>/pkg-page.astro' })` takes a bare module specifier; the
package must export the file in `package.json#exports` [docs, integrations reference]. Verified three ways:
symlinked package (build and dev), tarball copy in `node_modules` (build and dev), `.astro` file importing another `.astro` file
via a relative `.js` re-export and via a bare import from a second package (`fake-theme/Card.astro`), with and without
`vite.ssr.noExternal`. All rendered correctly. This is exactly Starlight's pattern: it injects `[...slug]` and `404`
from `@astrojs/starlight/routes/{static,ssr}/*.astro` (read from `@astrojs/starlight@0.42.5` `dist/index.js`).

Also injectable: `.ts` endpoint handlers [docs]. That is the clean home for `/data/catalog/catalog.json`
(generate it as a route instead of writing it after the build). The mirror of source wire trees and `_headers` should stay
a post-build copy (`astro:build:done` or after `build()` returns, as `engine.ts` does today); do not push thousands
of mirrored files through Astro's route table.

### Content Layer

- A collection needs `src/content.config.ts` **in the root**; I found no supported way for an integration to contribute a
  collection definition [unverified: absence of evidence in docs and a search that surfaced nothing]. Starlight itself requires the user to
  declare the `docs` collection with its exported `docsLoader()` (`dist/loaders.js`). In our design the scratch root is generated, so we could write one, but
  there is no reason to for packages.
- `glob()` with an absolute `base` outside the root, a `title` schema and `render()` produced the page [verified] — the right
  fit for `config.docs` (replaces `docsSourceDir` copying).
- Content Layer is the right tool if READMEs must be cached across builds (digest-skip in the loader). Not tested; do it only if build time at
  your real scale demands it.

### Rendering READMEs

Astro 7 replaced remark/rehype with **Sätteri** (Rust) as default; `@astrojs/markdown-remark` is now an optional peer
[docs, v7 upgrade guide: https://docs.astro.build/en/guides/upgrade-to/v7/; verified `@astrojs/markdown-satteri@0.4.3`].
`createSatteriMarkdownProcessor({})` from `@astrojs/markdown-satteri` rendered 10k READMEs inside `getStaticPaths`
(used above). Untrusted README HTML must still be sanitized or sandboxed exactly as `AGENTS.md`/`subsystem-sources.md` require; Astro adds no sanitizer
(`set:html` is raw) [verified in my test page].

## Q3. Precedent and Vite resolution of the package's own `.astro` files

**Starlight** (read from the published package, 0.42.5): single integration; `astro:config:setup` calls
`injectRoute` for `404` and `[...slug]` with entrypoints under `@astrojs/starlight/routes/...`, `addMiddleware`
(`@astrojs/starlight/locals`), `updateConfig({ vite: { plugins: [css-layer-order, lazy-barrel, virtual-modules] }})`, and
appends sub-integrations (Expressive Code, sitemap, MDX). Config reaches components through a **Vite virtual module**
(`vitePluginStarlightVirtualModules`), which is the same mechanism I used. Components ship as raw `.astro` files in `dist/`, exposed through `exports`
(`./components`, `./components/*`, `./routes/...`). Pagefind runs in `astro:build:done`. It does not
use `noExternal` or `preserveSymlinks`; it only adds `ssr.optimizeDeps.include` when the target is Cloudflare.
Caveat: Starlight is used inside a **user-owned Astro project** (`astro.config.mjs`, `src/content.config.ts`), not a hidden root.

**TutorialKit** (`@tutorialkit/astro@1.6.0`, read from `dist/index.js`): same shape: an integration that injects
`/` and `[...slug]` from `@tutorialkit/astro/default/pages/*.astro`, adds `vite.ssr.noExternal: ["@tutorialkit/astro", "@tutorialkit/react"]`,
`optimizeDeps.include/entries`, and virtual-module plugins. Its CLI (`@tutorialkit/cli`) is a scaffolder using `execa`; the
runtime is the user's Astro project. So `ssr.noExternal` for your own packages is established practice; in my tests it was **not**
required for `.astro` files in `node_modules` in either build or dev, but adding it is cheap insurance for the theme package (e.g. when a
plain `.js` module in the package starts importing `.astro` through a bare specifier from an externalized context) [verified not required; benefit
unverified].

**Why it just works** [verified, source]: `create-vite.js` runs `crawlFrameworkPkgs` (vitefu) over the root's dependency list
and auto-adds packages whose `package.json` has `astro` in `peerDependencies`/`dependencies`/`keywords` (`astro` or `astro-component`)
or an `astro-*` name to `ssr.noExternal`. Our scratch root has no `package.json`, so that crawl finds nothing; the experiments still passed
because injected route entrypoints and their relative imports are in the transformed graph. **Do both anyway:** publish `@ocx-sh/theme` and
`@ocx-sh/catalog` with `peerDependencies.astro` and `keywords: ["astro-component"]`, and set `ssr.noExternal` for them in `updateConfig`.

**Other CLI-wraps-Astro precedent.** I searched for npm packages that drive `astro build/dev` programmatically against a generated root and
found none (search returned only the docs page and unrelated tools). The Astro project itself discusses the shape
([roadmap#357 "Start Astro programmatically"](https://github.com/withastro/roadmap/discussions/357),
[roadmap#1308 `astro dev --background`](https://github.com/withastro/roadmap/discussions/1308)); I saw these only as search results, not read in full [unverified content].
Treat "no precedent" as a real signal: you are the early adopter, hence the adapter-module and smoke-test mitigation above.

## Q4. Client islands under "nothing loads before interaction"

Astro's built-in directives [docs: https://docs.astro.build/en/guides/framework-components/]:

| Directive | When JS loads | Fits budget? |
|---|---|---|
| `client:load` | on page load | no |
| `client:idle` | `requestIdleCallback` after load | no |
| `client:visible` | on viewport intersection (scroll, no gesture) | no |
| `client:media` | on media query match | no |
| `client:only` | on page load, no SSR | no (and loses SSR HTML) |
| server islands (`server:defer`) | HTML fetched at runtime | needs adapter; N/A for static output [docs: "With an adapter installed ... add `server:defer`"] |

**Use a custom directive.** [verified] A 6-line directive registered with `addClientDirective({ name: 'interaction', entrypoint })`
from the integration:

```js
export default (load, options, el) => {
  const go = async () => { const hydrate = await load(); await hydrate(); };
  for (const ev of ['pointerdown','focusin','keydown','touchstart'])
    el.addEventListener(ev, go, { once: true, capture: true });
};
```

Build output: the SSR HTML is fully rendered; the page contains an inline directive script plus an inline `astro-island` bootstrap
(a few KB, no network), and the component (`SearchBox.*.js`), renderer (`client.*.js`) and Preact chunks (~12 KB total, unminified-gz not measured) are fetched
only after the first gesture. Add `onfocusin`-style listeners on the *island element*, not `window`, to avoid loading on unrelated clicks.
Docs endorse custom directives; the entrypoint is bundled by esbuild and "should remain lightweight" [docs].

**Plain `<script>` alternative** [verified]: a hoisted `<script>` in an `.astro` file becomes a **160-byte module** (one request at page
load) that registers a listener and `import()`s the heavy chunk on first `focusin`. That is one tiny request at load, so it violates a
literal "zero requests" budget; use `is:inline` or the custom directive if the rule is strict.

**Search/filter over the JSON view-model.** Recommended: keep emitting `/data/catalog/catalog.json` (as an injected `.ts` endpoint),
and have a `client:interaction` search island `fetch()` it on first interaction, then filter client-side (MiniSearch/Fuse-size lib, or plain
substring/token filter). Starlight's default search does **not** meet this budget: its `Search.astro` loads `@pagefind/default-ui` via
`requestIdleCallback` after `DOMContentLoaded` (read from `dist/components/Search.astro`). If Starlight-compatible components are
ported, override their `Search` slot. Pagefind remains a fine option if full-text README search is wanted; it needs the built HTML
(runs in `astro:build:done`), and its filter model would need to be checked against platform/version facets [unverified].

**Zag.js adapters** [verified, `npm view`]: `@zag-js/{preact,vue,solid,react,svelte,vanilla}` all at 1.45.0; preact peers `preact >=10`.
Pick the smallest runtime for islands (Preact or Solid) and keep Zag-driven widgets (menus, dialogs, tabs) behind `client:interaction`.
For widgets that can be pure CSS/HTML (`<details>`, `popover`, `<dialog>`), ship zero JS.

## Q5. Dev mode with live config/data reload

[verified, experiment + source `dist/core/dev/restart.js`]

- In-process `dev({ root, configFile: false, integrations })` serves immediately (224 ms ready at 10k packages). First request
  paid ~2.5 s (Vite dependency optimization), subsequent pages 4 to 8 ms.
- Astro restarts the whole container (`restartContainerInPlace`) on a watcher `change|add|unlink` of: the config file, `package.json`/`tsconfig`
  (default `watchFiles`), or any path pushed through `addWatchFile()`. Restart re-runs `astro:config:setup` with `isRestart: true`, so
  an integration that re-reads its data file inside the hook picks up new data [verified: page count 3 -> 8, a previously 404 route became 200,
  "Configuration file updated. Restarting..." logged].
- **Gotcha** [verified]: `addWatchFile(path)` only registers the path for the restart *check*. Chokidar does not watch files outside the root unless told.
  Without `server.watcher.add(path)` in `astro:server:setup`, editing the data file did nothing. With both, it worked.
- A change to `catalog.config.json` itself needs the same treatment (add it to both). Source-tree changes (a `path` source on disk, git checkout) work
  identically if the integration adds the watched paths; for `url` sources there is nothing to watch, so keep the explicit "restart dev to refetch" behaviour.
- Restart failure mode: Astro logs the error, "Continuing with previous valid configuration", and keeps serving [source]. Surface that to the user rather than letting
  a bad config edit pass silently.
- The current `dev.ts` forks a child because `vitepress` `createServer()` must not share a process with another Vite (Vitest). Astro's `dev()` embeds Vite 8
  the same way, so **keep the fork for tests**; the CLI can run in-process if desired. Not tested under Vitest here [unverified].

## Q6. Risks and pitfalls

1. **Node floor.** Astro 6/7 require Node >= 22.12 [verified]. Breaking change for `engines`, CI matrix, `setup-ocx` toolchain pins and docs; do it in the same release as the Astro swap.
2. **Experimental API.** See Recommendation 6. Also note the 7.0 breaking changes already in the wild (Vite 8, Rust compiler stricter HTML, Sätteri default, `src/fetch.ts` reserved; `compressHTML` default `'jsx'`) [docs v7 upgrade guide]: the scratch root must not contain a user file named `src/fetch.ts`.
3. **Raw `.jsx` (and likely `.tsx`) in `node_modules` fails.** [verified] A Preact `.jsx` file shipped in a tarball install failed the build with
   `Rolldown failed to resolve import "react/jsx-runtime"` (the framework preset skips `node_modules` and Vite falls back to the React JSX runtime); passing
   `include` to `@astrojs/preact` did not fix it. The same file worked when the package was a symlink (real path outside `node_modules`), which would hide the bug in local `file:` dogfooding.
   **Ship framework components precompiled to plain JS** (importing `preact/jsx-runtime` explicitly); I verified a hand-compiled `.js` component built and hydrated from a tarball install. `.astro` files are fine raw.
   Vue/Svelte/Solid single-file components in `node_modules` were **not** tested.
4. **Symlinks / `file:` deps.** [verified] A `npm i ./pkg` symlink worked for build and dev with no `preserveSymlinks`, no extra `optimizeDeps`. The
   current `dev.ts` comment about stale pre-bundles for linked packages (esbuild dep optimizer cache keyed on lockfile) was not reproduced here (Vite 8 uses Rolldown for optimizing); set `cacheDir` inside the scratch root (as
   `config_gen.ts` does today) so the consumer's own `node_modules/.vite` is never shared. Peer duplication (two Preact copies via a symlinked package) is the classic failure to test with `file:` setups.
5. **Base path `/catalog/`.** [verified] Astro prefixes assets, island URLs and `import.meta.env.BASE_URL` (`/catalog/`, trailing slash); dev serves under the base too. **Not
   handled for you:** hrefs in README HTML and user docs markdown, hand-written `<a href="/p/...">` in components, and `fetch('/data/catalog/catalog.json')` in islands. Build every URL
   from `BASE_URL`, or rewrite root-relative links in the render step. Set `site` (needed for canonical/sitemap) from `siteUrl`. Decide `trailingSlash` and
   `build.format` explicitly (output here was `.../index.html` directories with links without trailing slash).
6. **`outDir` is emptied.** Astro clears `outDir` at build start; keep `assertOutDirSafe` and keep the mirror/`_headers` writes strictly after `build()` returns (or in `astro:build:done`).
7. **Memory at scale.** 2 to 3 GB RSS at 10k pages with rendered READMEs [verified]; raise `NODE_OPTIONS=--max-old-space-size` guidance, keep props small, consider batching README rendering.
8. **Untrusted content stays untrusted.** `set:html` of README output is raw; the sandbox/`_headers` precondition in `product-context.md` is unchanged.
9. **Astro writes into the root.** `.astro/` (types, content store) lands in the scratch root; keep it disposable and out of the consumer's tree. Do not run two `ocx-catalog` processes against the same root.
10. **Not covered by this research:** Windows path/`file:` URL handling for `injectRoute` entrypoints, Vitest-in-process behaviour, Zag components inside the shipped theme, and the CSS cascade-layer
    override story (the since-retired cascade-contract rule) under Astro's scoped-style strategy (Starlight sets `scopedStyleStrategy: "where"` and a CSS layer-order plugin, which is the precedent to copy).

## Sources

- Astro programmatic API: https://docs.astro.build/en/reference/programmatic-reference/ (also Context7 `/withastro/docs`)
- Integrations reference (`injectRoute`, `addClientDirective`, hooks): https://docs.astro.build/en/reference/integrations-reference/ (Context7)
- Astro v7 upgrade guide: https://docs.astro.build/en/guides/upgrade-to/v7/
- Framework components / client directives: https://docs.astro.build/en/guides/framework-components/
- Server islands: https://docs.astro.build/en/guides/server-islands/
- Content collections / loaders / live collections: https://docs.astro.build/en/guides/content-collections/ (Context7)
- Logger reference: https://docs.astro.build/en/reference/logger-reference/
- Starlight 0.42.5 package source (`dist/index.js`, `dist/loaders.js`, `dist/components/Search.astro`): `npm pack @astrojs/starlight`
- TutorialKit `@tutorialkit/astro@1.6.0` package source (`dist/index.js`): `npm pack @tutorialkit/astro`
- Astro 7.3.6 package source (`dist/core/dev/restart.js`, `dist/core/dev/dev.js`, `dist/core/create-vite.js`, `dist/types/public/config.d.ts`): `npm i astro@7`
- npm registry metadata: `astro`, `@astrojs/starlight`, `@zag-js/*` (`npm view`)
- Roadmap discussions seen only in search results: https://github.com/withastro/roadmap/discussions/357, https://github.com/withastro/roadmap/discussions/1308

## Scale probe (E.7)

Proves C-047 (data handoff: README bytes are read per page from the mirrored CAS file, never carried in `site.json`). Measured 2026-10-07 on Astro 7.3.6, Node 24.14, WSL2 (32 GB, V8 heap limit 4288 MB), through the real CLI (`node dist/cli/index.js build`) under `/usr/bin/time -v`, builds run sequentially. Input: `scripts/synthetic-index.mjs <n> 20 <dir>` (root source, one image index and one unique ~20 KB README per package; 2 platforms, 4 tags). Probe-only page: `package.astro` rendered every README through `createReadmeRenderer` (T.2) + `set:html`, with `publicDir` found under the build cwd (not committed; P-detail replaces the page).

| Packages | READMEs | Wall time | Peak RSS (largest process) | `site.json` | Output | Result |
|---|---|---|---|---|---|---|
| 1,000 | 20 KB each (44 MB tree) | 40.4 s | 949,772 KB (0.91 GiB) | 1,026,834 B | 135 MB | exit 0, 1,001 `index.html` |
| 10,000 | 20 KB each (431 MB tree) | 7 min 13.8 s | 1,438,292 KB (1.37 GiB) | 10,215,836 B | 1.4 GB | exit 0, 10,001 `index.html` |

- **Which process peaks.** `/usr/bin/time -v` on the parent reports the maximum over the parent and its waited-for children, i.e. the single largest process, not their sum. A `/proc/<pid>/status` `VmHWM` sampler run beside it confirmed the Astro child is the peak: child 1,441,020 KB vs `time` 1,438,292 KB (n=10,000); child 954,432 KB vs 949,772 KB (n=1,000). The CLI parent peaked separately at 1,111,960 KB (n=10,000; 268,176 KB at n=1,000) and stays resident while the child runs, so the machine-wide footprint during the render is about 2.4 GiB at 10k, about 1.2 GiB at 1k.
- **Stop rule not triggered.** Peak RSS 1.37 GiB is far below 4 GiB. `site.json` does not grow with README size: 200 packages with 1 KB READMEs vs 40 KB READMEs gave 210,831 B vs 210,832 B (a 1-byte difference), and it scales with package count only (about 1 KB per package: 1.03 MB at 1k, 10.2 MB at 10k). The model shape in C-047 stands.
- **Scaling.** Peak RSS grows about 0.5 GiB for 10x the packages (0.91 to 1.37 GiB); wall time is about 10x (about 36 ms per page on one core; `build.concurrency: 1` is pinned by C-045). Time, not memory, is what grows at 10k.
- **`--max-old-space-size`: not warranted.** Node 24's default V8 heap limit here is 4,288 MB (it derives from system memory), and the largest process uses 1.4 GB RSS, so a default flag would add nothing. The Q6 item 7 estimate of 2 to 3 GB was conservative. Leave `NODE_OPTIONS` to the consumer, and keep documenting it for hosts with small memory (a 2 GB CI runner is the realistic constraint, and the CLI parent plus child total 2.4 GiB at 10k).

### Finding: `ssr.noExternal: true` breaks README rendering inside the Astro child

`astroConfig` (E.1) pins `ssr.noExternal: true` and `environments.prerender.resolve.noExternal: true`, which bundles every dependency into the prerender chunk. `createReadmeRenderer` imports `jsdom` (CommonJS, uses `__dirname`); bundled, the first README render fails with `__dirname is not defined in ES module scope` (reproduced at n=3). The probe used `external: ["jsdom"]` next to both `noExternal: true` pins (`vite.ssr` and `vite.environments.prerender.resolve`) and every build above ran with that edit. This is not committed: P-detail (or the T.2 owner) must decide the fix. Options: keep `jsdom` external (the chunk then resolves it from the staging dir upward, so it must be hoisted where the consumer's `outDir` sits, which is the failure the `noExternal` comment describes for `cookie`), or render the README outside the Astro child (in the CLI parent, handing the page HTML through the mirrored `public/` tree rather than `site.json`), or swap the sanitizer for a bundle-safe DOM.
