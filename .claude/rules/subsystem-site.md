---
paths:
  - src/site/**
---

# Site Subsystem

`src/site/**` is the Astro site this package ships: pages, the `Page` layout,
components, pure view-model builders (`model/`), shared logic (`lib/`) and the
browser islands (`client/`). `ocx-catalog build|dev` runs it in an
`astro build|dev` **subprocess** against a generated scratch root
(`src/build/engine.ts`, `astro_runner.ts`); chrome, tokens and widgets come from
the `@ocx-sh/theme` npm dependency, never copied here. A theme capability that
is missing is a request to the theme, not a vendored component or stylesheet.

Layering: `model/*` builders are pure and deterministic (same input, byte-equal
JSON) and `site.json` holds route keys and small views only (C-031, C-047);
`lib/` is logic that runs in Node and the browser; `client/` is the islands;
`.astro` files stay thin. Templates are outside `tsc`, eslint and the coverage
gate, so what pins them is the built-HTML acceptance suite and the grep tests
named below.

## Route identity: bare `ns`/`pkg`, never the route, never `root.name`

**The route rule has exactly one implementation, `src/viewmodel/route.ts`.**
`build/sources_pipeline.ts` uses it to decide where a page is WRITTEN and the
site uses it to decide where to LINK, so the two cannot drift (they did, twice,
before it was one function). `model/route_key.ts` derives a page's **route key**
(`segments.join("/")`) from it; a key identifies a page in the model and is
never a link. The ROOT index keeps bare `<ns>/<pkg>` routes; every other index
qualifies its pages with its own name.

- **Links:** `packageHref(name, indexes, base)` (`viewmodel/url.ts`) is the only
  producer of a detail link, in HTML and in island DOM (C-009). The route
  primitives (`packageRoutePath`, `packageRouteSegments`, `isRootIndex`) may
  only be named by `route.ts`, `url.ts` and `route_key.ts`;
  `test/viewmodel/url_sink.test.ts` fails on any other module.
- **Identity:** each `DetailView` carries bare `ns`/`pkg`. Never recover them by
  splitting the route (a non-root page's first segment is an index label, not a
  namespace), and never build a wire URL from `root.name` (it carries the
  qualified prefix, so every CAS fetch 404s and the image fallbacks hide it as
  "publishes nothing"). Route is presentation; `ns`/`pkg` is identity.
- **CAS gotcha:** wire URLs come from `lib/cas.ts` (`casUrl`, `rootHref`) with
  the source's `wireBase` through `wirePrefix` — `""` for the
  root source, `index/<label>` otherwise. Never concatenate `wireBase` by hand.
  `catalog.json` keeps `logoUrl`/`readmeUrl` catalog-root-relative (no `base`);
  clients resolve them with `joinBase` (C-008, C-016).
- **Index is the name's first `/`-segment**, so a package's origin needs no badge
  or colour; DISPLAY the qualified name elided in the middle
  (`lib/elideMiddle.ts`), but build every URL from the bare name.
- **Three per-index facts, three readers.** `indexes[].root` is placement
  (mirrored at the site root, so bare routes): only `route.ts` reads it.
  `indexes[].default` is which index the catalog opens on: only the scope
  control reads it (resolved once in `sources_pipeline.ts`). `excludeFromAll`
  narrows the "all" tab only, via `filterPackages`' `excludeIndexes`; every count
  and list for "all" reads it so they agree, and the palette deliberately does
  not. A route never asks `default` or `excludeFromAll`: a preselected tab must
  not move a URL and an excluded index's pages still exist.
  `catalog.indexes` ships for EVERY catalog, one source included; "is there a
  scope to pick" is `hasIndexScope`, not the envelope's presence.
- **Owner links:** a source's `ownerUrl` overrides the top-level one
  (`model/detail.ts`); the template goes through `lib/ownerUrl.ts` (`{login}`
  split/join + `encodeURIComponent`, then `safeHref`); plain text on `null`.

## URL sinks

`viewmodel/url.ts` holds the two choke points. `joinBase(base, path)` accepts a
catalog-root-relative path only (`^/(?!/)`) and throws on `\`, a control
character or a `.`/`..` segment, so `joinBase("/", "//evil.example")` cannot
yield a protocol-relative URL (C-039). `wireHref(value)` is the only way a
wire-derived `href`/`src` reaches the DOM: it returns the canonical `URL#href`
of an absolute `http(s)` string or `null` (`safeHref` decides the scheme), and a
caller renders plain text on `null` (C-042).

`url_sink.test.ts` greps `src/site/**` for any `href={…}`/`src={…}` (and
`href="${…}"` in template strings) that is not fed by `wireHref`, `packageHref`
or `joinBase`. A value that is provably not wire data goes in that test's
`NON_WIRE_EXPRESSIONS` **with the reason**; the fix is never to loosen the
regex. Logos are always `<img>` with intrinsic width/height, never inlined wire
SVG (C-015).

## Sanitisation boundary (hard rule)

README content is untrusted wire data and takes one route:

1. **Parent-side render.** `src/build/readmes.ts` renders and sanitises every
   README in the CLI process during assembly (`createReadmeRenderer`: markdown-it
   with `html: false`, then DOMPurify over an injected jsdom window, then the
   `SanitizedHtml` brand) and writes `<scratch>/readme/<sha256(key)>.html`.
   jsdom cannot be bundled into the Astro child and an external one resolves
   from the staging dir, so it never enters the Astro graph
   (`test/site/astro_graph.test.ts`). `site.json` carries those file paths and
   `writeSiteJson` rejects any outside the README dir (C-047).
2. **One sink.** `set:html` appears exactly once, in `components/ReadmePane.astro`,
   fed a `SanitizedHtml` read by `readSanitizedHtml`. `brandSanitized(` is called
   only in `readmeSanitizer.ts` and `sanitizedHtml.ts`. Both are pinned by grep in
   `test/site/lib/readmeRender.test.ts` (C-014); `dompurify >= 3.4.0` by a
   version test.
3. **Fault isolation (C-037).** An oversize (the mirror's 1 MiB cap, checked
   BEFORE the read), missing or unsanitisable README, or a sanitiser whose output
   is not idempotent, costs that package its pane ("README unavailable") and one
   stderr line; the build still exits 0.
4. **Islands write no markup.** `test/site/client/no_html_sinks.test.ts` fails on
   `innerHTML`/`outerHTML`/`insertAdjacentHTML` or web storage anywhere under
   `src/site/client`; wire text goes through `textContent`, `setAttribute` and
   template clones, and state lives in the URL (C-040).
5. **No inline data.** The site emits no inline JSON and no `define:vars`
   (`test/site/no_inline_json.test.ts`); islands fetch `catalog.json` instead.
   No raw interpolation into the generated `astro.config.mjs` (two
   `JSON.stringify`'d strings only).

## Content-Security-Policy (C-043)

`src/site/astro_config.ts` turns on Astro's `security.csp` (SHA-256):
`script-src 'self'` plus hashes, `object-src 'none'`, `base-uri 'none'`,
`style-src 'self' 'unsafe-inline'` (the last stays because sanitised README
tables carry `style=`). Astro hashes its own bundled scripts but NOT `is:inline`
ones, so the theme `Shell`'s inline-script hashes come from
`cspHashes()` (`csp_hashes.ts`) = `INLINE_SCRIPT_HASHES` from
`@ocx-sh/theme/csp`, which derives them from the constants the chrome renders.
**Never compute hashes by scanning our own output**: that allow-lists whatever
appears there, a hostile inline script included. A new inline script of ours
needs its hash covered; `test/acceptance/csp.test.ts` fails on any built page
whose inline `<script>` hash is missing (and is shown able to fail).

## Install commands: one source of truth

`lib/installFlavors.ts`'s `DEFAULT_INSTALL_FLAVORS` is the only place an
`ocx …` command is spelled; the install card, the copy menu and the landing
cards build text through `installCommand()` (C-018).
`test/site/install_literals.test.ts` greps `src/site/**` for the literal shapes.
Substitute `{name}` with `split`/`join`, never `replace`: `$&` and `$1` are
significant in a replacement string and `qualifiedName` is wire data.

## Catalog toolbar and grid: invariants that each cost a defect

- **Every selection narrows.** `filterPackages` ANDs values WITHIN a facet as
  well as across facets (two platform chips mean "ships both"). It was OR once,
  and a second click widened the result, which read as a broken rail
  (`test/site/lib/filterPackages.test.ts`, "AND within the facet").
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
- **Build bound:** `lib/windowing.ts` renders a growing slice (48, doubling to a
  384 cap), never shrinking while scrolling; it is a RENDER slice and every
  count and filter reads the full set. None of this is measurable in a DOM
  emulator: `task quality:web` measures it in Chrome and its budgets are the gate.

## Lazy islands and their DOM contracts (C-011, C-033)

Nothing loads before the first interaction: no `catalog.json` request and no
island chunk. The grid, palette and versions islands (`client/grid.ts`,
`palette.ts`, `versions.ts`) take a `LazyMount` (`client/mount.ts`, the shape of
`@ocx-sh/theme/lazy`'s `mount(root, {load, trigger, replay})`); the real binding
is the `<script>` in `CatalogGrid.astro`, `Palette.astro` and `VersionList.astro`,
and the filter code sits behind a dynamic `import()` in `load`. A static import
of that code from an entry breaks C-017's pre-input JS budget (11 KiB gz).
State-bearing URLs (`?q ?index ?sort ?view`, written with `replaceState`) boot
at load without a layout shift.

Each island's header docblock IS its markup contract (`data-*` hooks, template
elements, theme events). The `.astro` template and the island change in the same
commit. Islands drive theme widgets through their documented DOM events only and
never import theme internals; `base` arrives as `data-base`, never a global; every
island test has a `/catalog/` case. The `*_real_lazy.test.ts` suites run each
island against the real `@ocx-sh/theme/lazy` and fail on drift in either shape.

## Docs mount

The consumer `docs` tree is the one content collection Astro itself processes
(READMEs never are, see the sanitisation boundary). `build/docs_scan.ts` derives
the routes (`index.md` serves its directory: `docs/index.md` is `/docs/`,
`<dir>/index.md` is `/docs/<dir>/`), `build/content_config.ts` declares the glob
and `pages/docs.astro` renders it. Links in those pages go through
`src/site/docs_markdown.ts`, a Sätteri hast plugin wired in `astro_config.ts`:
`rewriteDocsHref` resolves a relative link against its own file, drops `.md`,
maps `index.md` to its directory and prepends `base` to a root-relative one.
External, `//`, `mailto:`, `#only` and relative non-page links are untouched.
A raw-HTML `<a href>` is not rewritten, and a `{#id}` heading suffix stays
visible text on purpose (S-010). Docs are trusted content, so they get no
sanitiser.

## Page seam

`layouts/Page.astro` is the only seam between pages and the theme's `Shell`
(C-032); its props are `PageProps`. Head tags come from the pure `lib/seo.ts`.
Consumer `css` is linked inside the `head` slot but Astro appends the bundled theme
stylesheets after it; the theme's rules all sit in `@layer ocx`, so an unlayered
consumer rule wins in either order (asserted in `test/acceptance/seo.test.ts`).

## Coverage and linting

`**/*.astro` is excluded from coverage (v8 does not instrument compiled Astro);
logic that needs coverage belongs in `model/`, `lib/` or `client/`, which stay at
100%. See [subsystem-tests.md](./subsystem-tests.md). eslint has no Astro plugin
and `tsc` does not read `.astro`, so a type error inside a template surfaces only
when the acceptance build renders that page.
