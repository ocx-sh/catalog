import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Semaphore } from "../sources/walker.js";

/**
 * Page synthesis (C-005, S-008) — writes one real `.md` file per package
 * into the scratch root, at the package's full logical-name path. Real
 * files on disk, not a virtual-module hook, per
 * `research_vitepress_programmatic_api.md`: VitePress's page discovery is a
 * chokidar watcher over `srcDir`, and there is no public rest-param dynamic
 * route (`[...segments].md` is not a thing VitePress supports) — a SINGLE
 * `[ns]/[pkg].md` + `.paths.ts` template, the pattern the current site uses
 * (`site/src/[ns]/[pkg].paths.ts`), can only ever express one fixed segment
 * count. Synthesis exists because the package set this engine renders is
 * not fixed-depth: C-003's name shape is "opaque 1..N segments after
 * prefix, never a two-segment split" (plan #716) — one static file per
 * package is the one mechanism that renders every depth uniformly without
 * a separate route template per observed depth.
 *
 * ## Depth-N -> file mapping
 *
 * A package whose logical name is `/a/b/c` (wire root `p/a/b/c.json`) is
 * `segments: ["a", "b", "c"]`. Its synthesized file is
 * `<scratchRoot>/<srcDir>/a/b/c.md` — VitePress's own `srcDir`-relative
 * `.md` -> route mapping (`cleanUrls: true`, matching the current site's
 * `config.mts`) then serves it at `/a/b/c`, no different from any other
 * page in the tree.
 *
 * ## Passing package identity to `DetailPage.vue` (Specify-spike correction)
 *
 * The design this file originally shipped with wrote frontmatter
 * `params: { ns, pkg }` on each synthesized file, expecting
 * `useData().params` to read it back the same way VitePress's own
 * `defineRoutes` mechanism populates that field for a DYNAMIC route. A
 * Specify-phase spike REFUTED this for a plain (non-`[param]`-named) static
 * file on the pinned `vitepress@2.0.0-alpha.19`: `useData().params` is
 * `null` outside a `defineRoutes`/`[param]` page — literal frontmatter
 * `params` is never read back. `DetailPage.vue` (WP-06-owned, no other
 * in-flight WP touches it) now derives `ns`/`pkg` from
 * `useData().page.relativePath` instead — the exact string this module
 * writes each package's file to, needing no frontmatter identity key at
 * all. This file therefore writes only ONE frontmatter key,
 * `layout: detail` — see "Layout dispatch" below — never `params`.
 *
 * ## Layout dispatch
 *
 * `Layout.vue` (WP-03, verbatim-lifted, already merged) dispatches purely on
 * `frontmatter.layout` (`'catalog' | 'detail' | else DocLayout`) — every
 * synthesized package page therefore carries `layout: detail` in its
 * frontmatter, or it would silently fall through to `DocLayout` instead of
 * rendering `DetailPage.vue`.
 *
 * ## Multi-source `wireBase` (C-004/C-006 coupling)
 *
 * `PackageRoute.wireBase` carries the per-source fetch-base prefix
 * (`""` for the config's `root:true` source, `"index/<label>"` for every
 * other configured source) that C-004's multi-source model assigns each
 * package's wire data. It is written into each synthesized page's
 * frontmatter (`packagePageContent`), which is the only channel the
 * client-side detail page has for it: `DetailPage.vue` reads it back off
 * `useData().frontmatter` and hands it to `usePackageRoot`, `useImageIndex`
 * and the two `utils/cas.ts` callers.
 *
 * It was plumbed here but unconsumed until 0.2.1, and everything downstream
 * fetched an unconditional root-relative `/p/<ns>/<pkg>...` (a single-source
 * assumption baked in by WP-03's verbatim lift). The mirror wrote a non-root
 * source's tree to `index/<label>/p/**` while every URL naming it pointed at
 * `/p/**`, so its package roots, image indices, logos and READMEs all 404'd
 * — and the theme's image-fallback chains degrade silently, so the result
 * read as "these packages publish no description" rather than as a broken
 * fetch.
 *
 * ## Docs mount (S-006) placement
 *
 * When `docsSourceDir` is given, its content is copied (recursively, real
 * files — not a symlink; VitePress's own chokidar watcher follows real
 * files uniformly across `dev`/`build` without a platform-dependent symlink
 * caveat) into `<scratchRoot>/<srcDir>/docs/`, so it renders at `/docs/**`
 * exactly like the current site's own `src/docs/**`. This function owns
 * only the mount POINT; nav wiring and the docs-specific layout/sidebar
 * behavior are WP-10's contract (S-006 owner).
 *
 * ## Public dir mount
 *
 * When `publicDirSource` is given, its content is copied the same way into
 * `<scratchRoot>/<srcDir>/public/` — VitePress's own default `publicDir`
 * resolution (`<srcDir>/public`, verified against the installed
 * `vitepress@2.0.0-alpha.19`), so no generated-config field is needed for
 * this: files land at the site root verbatim (e.g. `public/favicon.svg` ->
 * `/favicon.svg`), matching the current site's own `src/public/**`.
 *
 * ## Root + 404 pages
 *
 * Every synthesized site always gets `index.md` (`layout: catalog` — the
 * catalog's own landing page; a consumer never authors this, per the ADR's
 * fixed-skeleton layout contract) and `404.md` (body irrelevant —
 * `Layout.vue` dispatches on `page.isNotFound` before ever reading this
 * page's frontmatter; it exists purely so VitePress emits `404.html`),
 * mirroring the current site's own `src/index.md`/`src/404.md`.
 */
export interface PackageRoute {
  /** Opaque 1..N path segments after the catalog root, in order —
   * `segments[0]` is the namespace ("prefix"); `segments.slice(1)` is the
   * (possibly multi-segment) package path. Never assume `length === 2`. */
  readonly segments: readonly string[];
  /** This package's per-source wire-fetch mount prefix — `""` for the
   * root:true source, `"index/<label>"` otherwise. See the file doc's
   * "Multi-source wireBase" section. */
  readonly wireBase: string;
}

export interface SynthesizePagesOptions {
  /** Absolute path to the scratch root `createScratchRoot()` returned. */
  readonly scratchRoot: string;
  /** VitePress `srcDir` setting `config_gen.ts` generates — pages are
   * written under `<scratchRoot>/<srcDir>/`, matching where the generated
   * config tells VitePress to look. */
  readonly srcDir: string;
  readonly packages: readonly PackageRoute[];
  /** Absolute path to the config's resolved `docs` directory, when set. */
  readonly docsSourceDir?: string;
  /** Absolute path to the config's resolved `publicDir` directory, when set. */
  readonly publicDirSource?: string;
}

/** Frontmatter for one synthesized package page: the `layout` key every
 * page needs (see the file doc's "Layout dispatch" section), plus this
 * package's `wireBase` when it has one.
 *
 * `wireBase` is how the per-source mount prefix reaches the BROWSER — the
 * detail page's own wire fetches (`usePackageRoot`, `useImageIndex`,
 * `ReadmePane`/`IdentityBlock` via `utils/cas.ts`) are client-side and have
 * no other channel to it. Emitted only when non-empty, so the root source's
 * pages keep byte-identical frontmatter to what this function has always
 * written.
 *
 * Single-quoted: `labels.ts`'s `SAFE_LABEL_RE` already bounds a label to
 * `[A-Za-z0-9._-]+` (no quote character can appear in one), and quoting
 * keeps the value a YAML string regardless of what the label looks like. */
function packagePageContent(wireBase: string): string {
  const base = wireBase === "" ? "" : `wireBase: '${wireBase}'\n`;
  return `---\nlayout: detail\n${base}---\n`;
}

/** Always synthesized — the catalog's own landing page (see the file doc's
 * "Root + 404 pages" section). */
const CATALOG_PAGE_CONTENT = "---\nlayout: catalog\n---\n";

/** Always synthesized — content is irrelevant, see the file doc. */
const NOT_FOUND_PAGE_CONTENT = "<!-- Exists so VitePress emits 404.html. -->\n";

/** C-304: caps in-flight package-page writes — an unbounded `Promise.all`
 * over every resolved package opened one `mkdir`+`writeFile` pair per
 * package simultaneously, which a large index (thousands of packages) turns
 * into thousands of concurrent filesystem operations at once. Same cap as
 * `walker.ts`'s own fetch queue (`MAX_CONCURRENCY`) — one bounded-
 * concurrency policy, not a per-caller-tuned number. */
const PAGE_WRITE_CONCURRENCY = 16;

export async function synthesizePages(options: SynthesizePagesOptions): Promise<void> {
  const srcRoot = join(options.scratchRoot, options.srcDir);
  await mkdir(srcRoot, { recursive: true });

  const semaphore = new Semaphore(PAGE_WRITE_CONCURRENCY);

  await Promise.all([
    writeFile(join(srcRoot, "index.md"), CATALOG_PAGE_CONTENT, "utf8"),
    writeFile(join(srcRoot, "404.md"), NOT_FOUND_PAGE_CONTENT, "utf8"),
    ...options.packages.map(async (route) => {
      const release = await semaphore.acquire();
      try {
        const filePath = join(srcRoot, ...route.segments.slice(0, -1), `${route.segments[route.segments.length - 1]}.md`);
        await mkdir(join(filePath, ".."), { recursive: true });
        await writeFile(filePath, packagePageContent(route.wireBase), "utf8");
      } finally {
        release();
      }
    }),
  ]);

  await Promise.all([
    options.docsSourceDir !== undefined
      ? cp(options.docsSourceDir, join(srcRoot, "docs"), { recursive: true })
      : undefined,
    options.publicDirSource !== undefined
      ? cp(options.publicDirSource, join(srcRoot, "public"), { recursive: true })
      : undefined,
  ]);
}
