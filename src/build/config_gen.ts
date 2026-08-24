import { cp, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Brand, NavEntry } from "../config/types.js";

/**
 * Generates the scratch root's `.vitepress/config.mts` and
 * `.vitepress/theme/index.ts` shim (C-005). The shim is the documented
 * theme-from-package pattern (`research_vitepress_programmatic_api.md`
 * "Theme-from-package"): `userThemeDir` is hardcoded by VitePress to
 * `<root>/.vitepress/theme`, so the shim is a two-line re-export —
 * `import Theme from "@ocx-sh/catalog/theme"; export default Theme` (plus a
 * third, conditional line importing the consumer's own `css` — see
 * "CSS cascade order" below).
 *
 * ## Injection channel: `themeConfig`, static JSON, no live closures
 *
 * `generateConfig()` WRITES a plain text file; a later, SEPARATE call
 * (`vitepress build()`/`createServer()` — possibly in a different process
 * entirely, for `dev`'s forked worker) loads that file fresh as its own ES
 * module. Nothing this function closes over (`options.descLookup` included)
 * survives that boundary — only what gets serialized into the file's own
 * text does. Every value a consumer's `catalog.config.json` supplies
 * (`brand`, `nav`, `docs` presence, `siteUrl`) is therefore baked
 * into the generated `defineConfig({ themeConfig: {...} })` call as literal
 * JSON at WRITE time, and read back via `useData().theme` on the client —
 * never passed as a live function reference.
 *
 * `descLookup` is the one exception needing extra work to fit this shape:
 * it's a per-PACKAGE callback, and `GeneratedConfigOptions` carries no
 * package list of its own. `synthesizePages()` (this pipeline's PRECEDING
 * step — see `engine.ts`'s fixed 8-step order, step 4 before step 5) has
 * already written one real `.md` file per package into
 * `<scratchRoot>/<srcDir>/**` by the time this function runs, so this
 * function DISCOVERS the package set by walking that tree back into
 * segment lists (the exact inverse of `pages.ts`'s depth-N mapping),
 * evaluates `descLookup` once per discovered package, and bakes only the
 * non-null results into `themeConfig.descLookup` — a plain
 * `{ "<ns>/<pkg...>": { title, description } }` map the generated
 * `transformHead` hook (also literal, generated text — see below) reads
 * back via plain property lookup, never a function call across the
 * generated-file boundary.
 *
 * | Setting | Disposition |
 * |---|---|
 * | `srcDir` | Carried verbatim — `GeneratedConfigOptions.srcDir` |
 * | `cleanUrls: true` | Carried verbatim (fixed, not configurable) |
 * | `srcExclude: ["public/**"]` | VitePress globs every `.md` under `srcDir` for pages and does NOT exclude `publicDir` by default, so a `.md` inside `public/` is compiled as a page. `dev` writes the live wire tree there (`dev_worker.ts`), which includes every package's README CAS blob — without this, each one becomes a bogus route at `/p/<ns>/<pkg>/o/sha256/<hex>` and is run through Shiki, emitting an "unknown language" warning per unusual code fence. `build` is unaffected (its mirror lands in `outDir` after the VitePress build), so this is a dev-only defect with a config-level fix. `public/` is static-asset territory by definition; a `.md` there is never an intended page. |
 * | `title` | `themeConfig.brand.title` (C-002's `brand.title`) |
 * | `description` | `GeneratedConfigOptions.description` (C-002's `CatalogConfig.description`) — omitted entirely when absent, letting VitePress fall back to its own default rather than baking in placeholder copy. |
 * | `vite.cacheDir` | Always emitted — see `GeneratedConfigOptions.cacheDir`'s own doc for why this can never be left to Vite's own default once the scratch root lives inside the consumer's `node_modules`. |
 * | `vite.plugins` (`ocx-dev-wire`, the original site's dev-only wire mirror) | **N/A, not carried, not an open item**: that plugin existed only because the ORIGINAL site's `vitepress dev` had no live render step of its own (needed `task site:dev`'s pre-rendered snapshot). This package's `dev.ts`/`dev_worker.ts` instead serve LIVE wire data from the loaded config's resolved sources directly (S-003) — a different mechanism for the same underlying need, not a gap to fill here. |
 * | `head` `og:site_name`/`og:type`/`twitter:card`/`color-scheme` | Carried verbatim; `og:site_name` sourced from `brand.title`. `color-scheme: light dark` (C-301) is unconditional — a cheap, static SEO/UX win the theme's own light/dark support already backs, so it needs no per-config guard. |
 * | `head` `<link rel="icon">` | Emitted from `GeneratedConfigOptions.favicon` (C-002's `CatalogConfig.favicon`) — a site-root-relative href the consumer serves out of its own `publicDir`; `brand.logo` is NOT a favicon source (it's the header logo) and this package ships no bundled default, so an absent `favicon` emits no link at all. |
 * | `head` `og:image`/`twitter:image` (C-301) | Site-wide, from the SAME resolved logo href `themeConfig.brand.logo` gets (see `logoHref`/`copyBrandLogo` below) — made absolute against `siteUrl` when set, else left site-root-relative (still correct against whatever origin actually serves the page). Absent logo -> neither meta emitted; never a build failure either way. |
 * | `transformHead` per-page `description` fallback | Fixed template `Install {name} from <brand.title>.`, `{name}` replaced with the page's `<ns>/<pkg>` key — never a hardcoded deployment identity (the index's own `ocx.sh/` prefix and "the OCX public package index" phrasing live in a *desc* per package root, not here). |
 * | `themeConfig.brand`/`.nav`/`.docsPresent`/`.siteUrl` | Baked static JSON — see "Injection channel" above. `docsPresent` is `true` iff `<scratchRoot>/<srcDir>/docs` exists on disk when this function runs (i.e., `synthesizePages()` was given a `docsSourceDir`). `brand` is a PROJECTION of C-002's `Brand`, not the raw value: `logo` is replaced by the site-root href of the copy this function makes (see `brandLogoSource`), since a config-relative filesystem path is meaningless to a browser. `wordmark` is passed through UNRESOLVED — `SiteHeader.vue` owns the `wordmark ?? title` fallback, so a hand-written `themeConfig` behaves the same as a generated one. **No `descLookup` key** (C-302, removed): it had zero runtime consumer — the theme never reads `useData().theme.descLookup` — and only bloated every page's metadata chunk; the module-level `DESC_LOOKUP` const below (`transformHead`/`transformPageData`'s own lookup table) is unaffected, since neither hook reads it through `themeConfig` at all. |
 * | `themeConfig.search.provider: 'local'` | Carried verbatim — VitePress core reads this itself (independent of active theme) to decide whether to build the local-search virtual module at all. |
 * | `ignoreDeadLinks: [/^\/p\//]` | Carried verbatim — every synthesized page still links CAS paths the dead-link linter can't see until the mirror copy (C-006) exists. |
 * | `markdown.theme` (`ocxCodeTheme`, dual light/dark Shiki JSON) | Carried verbatim, including its hardcoded OCX brand hex values — this package ships one fixed visual identity (C-008: config parameterizes brand/nav CONTENT, not the theme's own CSS token palette). |
 * | `markdown.headers: { level: [2, 3] }` | Carried verbatim — matches `OnThisPage.vue`'s fixed two-tier scroll-spy. |
 * | `sitemap.hostname` / `transformHead` `og:url`/`link rel=canonical` (C-301) | Only emitted when `siteUrl` is given — degrades to no sitemap + no `og:url`/canonical, never a build failure. `canonical` is emitted for every routable page (index, docs, detail) from the SAME clean-URL path `og:url` already derives; a 404 page gets neither (nothing to canonicalize). |
 * | `public/robots.txt` (C-303) | Emitted by `generateConfig()` (not `transformHead` — this is a static file write, not a per-request head hook) under the SAME `siteUrl` guard as `sitemap.hostname` above, into the same `public/` mount `copyBrandLogo` writes into, carrying a `Sitemap:` line pointing at VitePress's own `sitemap.xml`. Written with the `wx` flag — a `publicDir`-supplied `robots.txt` (already copied there by `synthesizePages()`, which runs BEFORE this function) always wins; this is a default, not an override. |
 * | `transformPageData` per-page `title` (C-301) | Sets `pageData.title` to the package's own resolved title (desc title, or the bare `<ns>/<pkg>` key on a miss) for a detail page ONLY — index/404/docs pages are left alone, so VitePress's OWN `createTitle()` templating (`"<page title> \| <site title>"`, or the bare site title when no override is set) does the suffixing; this package does not reimplement that logic. Fixes the identity-gate defect where every detail page's rendered `<title>` was literally the SITE title, `brand.title` itself, never the package's own name. |
 * | `transformHead` per-page `og:title`/`og:description`/CAS preload (C-301) | Derives the page's identity from `pageData.relativePath` (NOT `pageData.params` — see `pages.ts`'s "Specify-spike correction" doc note; a synthesized page is a plain static file, `params` is never populated for it), looks up `DESC_LOOKUP[key]` (the baked table above), degrades to generic copy on a miss. Detail pages additionally get `link rel=preload as=fetch crossorigin` for their own `/p/<key>.json` — the wire root `usePackageRoot.ts` fetches on mount, so a bare navigation now beats the first fetch's own round-trip. |
 * | `themeConfig.githubUrl` | **Open item, unchanged**: no C-002 field carries it yet; `SiteHeader.vue`'s own nav is still hardcoded too (WP-10 territory, depends on WP-06). |
 *
 * ## CSS cascade order (C-005 named requirement)
 *
 * A consumer's `css` (when given) is imported from the theme shim AFTER the
 * theme's own default import — `import Theme from "@ocx-sh/catalog/theme";
 * import "<css>"; export default Theme;` — the documented VitePress
 * customization pattern (equivalent to `import DefaultTheme from
 * 'vitepress/theme'; import './custom.css'` in VitePress's own docs): a
 * later side-effect CSS import lands later in Vite's emitted CSS chunk
 * order, so the consumer's rules win the cascade for any custom property
 * both files set — verified by a real build in `css_order.test.ts`.
 */
export interface GeneratedConfigOptions {
  /** Absolute path to the scratch root `createScratchRoot()` returned. */
  readonly scratchRoot: string;
  /** VitePress `srcDir` — must match the value `pages.ts` writes under. */
  readonly srcDir: string;
  readonly brand: Brand;
  /** Absolute path to the config's resolved `brand.logo` file, when set.
   * Copied into the scratch root's `public/` mount (VitePress's own default
   * `publicDir`, the same one `pages.ts` writes) under its own basename, and
   * baked into `themeConfig.brand.logo` as the site-root href `/<basename>`
   * — a browser can't fetch the config-relative path C-002 validates, and
   * the theme needs an href. Copied AFTER `synthesizePages()` has already
   * populated that directory, so a `publicDir` file of the same name loses
   * to the explicitly configured logo. Absent -> no `logo` key at all, and
   * `Logo.vue` keeps rendering the theme's built-in mark. */
  readonly brandLogoSource?: string;
  readonly nav: readonly NavEntry[];
  /** Absolute path to the config's resolved `css` file, when set — must
   * load AFTER the theme's own CSS in the final cascade (the named
   * css-order test in C-005 gates this: "`custom.css` rules win in final
   * CSS order", guarding against the Vite CSS-chunk-ordering bug class
   * vite#5185/#6375/#22252 across the package boundary). */
  readonly css?: string;
  /** Deployment origin for `sitemap.hostname`/`og:url` — see the "Open
   * item" note above; absent degrades to no sitemap + no `og:url` meta,
   * never a build failure. */
  readonly siteUrl?: string;
  /** Site-wide tagline (VitePress's own top-level `description` field —
   * `CatalogConfig.description`, C-002), distinct from `brand.title` and
   * from `descLookup`'s PER-PAGE result below. Absent -> the `description`
   * key is omitted entirely, letting VitePress fall back to its own
   * default rather than baking in brand-specific placeholder copy. */
  readonly description?: string;
  /** Site-root-relative href for the browser-tab icon (e.g. `/favicon.svg`),
   * emitted as the first `head` entry on every page with a `type` derived
   * from its extension. Absent -> no `<link rel="icon">` at all. */
  readonly favicon?: string;
  /** Per-package OG title/description lookup, keyed by the same
   * `segments` `pages.ts` synthesizes routes from. `null` (unknown
   * package, or lookup unset) degrades to generic fallback copy. */
  readonly descLookup?: (segments: readonly string[]) => { title: string; description: string } | null;
  /** Vite's `cacheDir` (pre-bundled deps + build cache), emitted into the
   * generated config's `vite: {}` sub-object. Absent -> defaults to
   * `<scratchRoot>/.vitepress/cache` — NEVER Vite's own default
   * (`node_modules/.vite`, resolved by walking up to the nearest
   * `package.json`): since `scratch.ts` now nests every scratch root
   * inside the CONSUMER's own `node_modules` (see its "Location" doc),
   * that walk lands on the CONSUMER's own `package.json`, so Vite's
   * default would point every unrelated build/dev run at the SAME shared
   * cache directory — exactly the stale-bleed class `scratch.ts`'s doc
   * warns about. Overridable for callers that want a different location,
   * but it must stay inside `scratchRoot` (the self-sweeping root) or it
   * won't be cleaned up between runs. */
  readonly cacheDir?: string;
}

/** True when `dir` exists and is a directory — never throws. */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Top-level entries `pages.ts` always writes that are never a package —
 * the docs mount, the public-assets mount, and the always-on catalog/404
 * pages (`pages.ts`'s own "Root + 404 pages" doc). */
const NON_PACKAGE_TOP_LEVEL_DIRS = new Set(["docs", "public"]);
const NON_PACKAGE_TOP_LEVEL_FILES = new Set(["index.md", "404.md"]);

/**
 * Discovers every package this pipeline already synthesized, by walking
 * `srcRoot` (the exact inverse of `pages.ts`'s depth-N -> file mapping) and
 * skipping the top-level non-package entries above. Returns `[]` when
 * `srcRoot` doesn't exist yet (e.g. `generateConfig()` called before
 * `synthesizePages()`, as this module's own unit tests do for settings
 * unrelated to package content) — a missing tree means zero packages, not
 * an error.
 */
async function discoverPackageSegments(srcRoot: string): Promise<string[][]> {
  async function walk(dir: string, prefix: readonly string[]): Promise<string[][]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const results: string[][] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (prefix.length === 0 && NON_PACKAGE_TOP_LEVEL_DIRS.has(entry.name)) continue;
        results.push(...(await walk(join(dir, entry.name), [...prefix, entry.name])));
      } else {
        if (prefix.length === 0 && NON_PACKAGE_TOP_LEVEL_FILES.has(entry.name)) continue;
        // Every remaining non-directory entry is a page `pages.ts` itself
        // wrote for a resolved package — always `<segment>.md`, by
        // construction.
        results.push([...prefix, entry.name.replace(/\.md$/, "")]);
      }
    }
    return results;
  }
  return walk(srcRoot, []);
}

/** `ocxCodeTheme` — the Shiki theme, emitted as literal generated-file source.
 *
 * Every colour is a `var(--ocx-color-code-*)` reference rather than a hex.
 * Shiki copies a `settings.foreground` value straight into the rendered
 * `style` attribute without interpreting it, so a custom property reaches the
 * browser intact and resolves there — the same mechanism Shiki's own
 * `createCssVariablesTheme()` uses, without taking a direct dependency on a
 * package this repo only has transitively through VitePress.
 *
 * This replaced 18 hardcoded hex values that no consumer stylesheet could
 * reach. They were also stale: still the pre-WP6 palette (#6f5bd0/#0e9f6e/
 * #9a6b13) that the a11y pass had already replaced for highlight.js, so docs
 * fences and README fences rendered the same language in two different
 * palettes, only one of which met AA.
 *
 * ONE theme, not a light/dark pair: the `--ocx-color-code-*` tokens already
 * swap on `.dark` in palette.css, so a second registration would be a second
 * mechanism doing the same job. That also retires the `--shiki-light`/
 * `--shiki-dark` per-span pair and the `docs-prose.css` rules that switched
 * between them. */
const OCX_CODE_THEME_SOURCE = `function ocxCodeTheme() {
  const v = (role) => \`var(--ocx-color-code-\${role})\`
  return {
    name: 'ocx',
    type: 'light',
    colors: { 'editor.background': v('bg'), 'editor.foreground': v('variable') },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: v('comment'), fontStyle: 'italic' } },
      { scope: ['string', 'string.quoted', 'constant.other.symbol'], settings: { foreground: v('string') } },
      { scope: ['keyword', 'storage.type', 'storage.modifier', 'support.type', 'entity.name.tag'], settings: { foreground: v('keyword') } },
      { scope: ['constant.numeric', 'constant.language', 'constant.character', 'keyword.other.unit'], settings: { foreground: v('number') } },
      { scope: ['entity.name.function', 'support.function', 'entity.name.section', 'markup.heading'], settings: { foreground: v('function'), fontStyle: 'bold' } },
      { scope: ['variable', 'variable.parameter', 'entity.other.attribute-name'], settings: { foreground: v('variable') } },
      { scope: ['markup.deleted'], settings: { foreground: v('deleted') } },
    ],
  }
}`;

/** `<link rel="icon">` `type` by asset extension. An extension outside this
 * set emits the link with NO `type` attribute — browsers sniff, and a wrong
 * declared type is worse than an absent one. */
const FAVICON_MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * The generated `head[]` entry for `favicon`, or `""` when unset. Attribute
 * order (`rel`, `type`, `href`) is byte-significant: it's the order the
 * pre-extraction site emitted, and S-007 compares rendered HTML byte-wise.
 * `JSON.stringify` for the same reason the rest of this file uses it —
 * a consumer-supplied value stays inert data, never spliced source.
 */
function faviconHeadEntry(favicon: string | undefined): string {
  if (favicon === undefined) return "";
  const type = FAVICON_MEDIA_TYPES[extname(favicon).toLowerCase()];
  const attrs = type === undefined ? { rel: "icon", href: favicon } : { rel: "icon", type, href: favicon };
  return `\n    ["link", ${JSON.stringify(attrs)}],`;
}

/**
 * C-301: the generated `head[]` entries for site-wide `og:image`/
 * `twitter:image`, or `""` when no logo is configured. Not gated on
 * `siteUrl` the way `og:url`/canonical are — a root-relative href still
 * resolves correctly against whichever origin actually serves the page, so
 * a logo with no configured `siteUrl` still gets a working image reference
 * rather than none at all; `siteUrl`, when present, only upgrades it to an
 * absolute URL (some crawlers require one for `og:image` specifically).
 */
function ogImageHeadEntries(logoHref: string | undefined, siteUrl: string | undefined): string {
  if (logoHref === undefined) return "";
  const content = siteUrl !== undefined ? `${siteUrl}${logoHref}` : logoHref;
  return (
    `\n    ["meta", ${JSON.stringify({ property: "og:image", content })}],` +
    `\n    ["meta", ${JSON.stringify({ name: "twitter:image", content })}],`
  );
}

function renderThemeShim(css: string | undefined): string {
  const cssImport = css !== undefined ? `\nimport ${JSON.stringify(css)};` : "";
  return `import Theme from "@ocx-sh/catalog/theme";${cssImport}\nexport default Theme;\n`;
}

/**
 * Copies `brandLogoSource` into the scratch root's public mount and returns
 * the site-root href it will be served at, or `undefined` when no logo is
 * configured. `basename` is load-bearing beyond tidiness: it collapses any
 * directory part of the consumer-supplied path to a single file name, so the
 * write target can never leave the public mount even if C-002's own
 * containment check were ever relaxed.
 */
async function copyBrandLogo(options: GeneratedConfigOptions): Promise<string | undefined> {
  if (options.brandLogoSource === undefined) return undefined;
  const fileName = basename(options.brandLogoSource);
  const publicDir = join(options.scratchRoot, options.srcDir, "public");
  await mkdir(publicDir, { recursive: true });
  await cp(options.brandLogoSource, join(publicDir, fileName));
  return `/${fileName}`;
}

function renderConfig(
  options: GeneratedConfigOptions,
  docsPresent: boolean,
  descLookupTable: Record<string, { title: string; description: string }>,
  logoHref: string | undefined,
): string {
  const siteUrlLiteral = options.siteUrl !== undefined ? JSON.stringify(options.siteUrl) : "undefined";
  const sitemapField = options.siteUrl !== undefined ? `\n  sitemap: { hostname: ${siteUrlLiteral} },` : "";
  const cacheDir = options.cacheDir ?? join(options.scratchRoot, ".vitepress", "cache");
  // Fixed template, resolved HERE, not in the generated file: the default
  // keeps the generated `transformHead` branch-free (one template, one
  // substitution) instead of shipping a second fallback across the file
  // boundary.
  const packageDescription = `Install {name} from ${options.brand.title}.`;
  // `undefined` members drop out of JSON.stringify, so an unset wordmark or
  // logo emits no key at all rather than a `null` the theme would have to
  // special-case.
  const themeBrand = { title: options.brand.title, wordmark: options.brand.wordmark, logo: logoHref };

  return `import { defineConfig } from "vitepress";

${OCX_CODE_THEME_SOURCE}

const BRAND_TITLE = ${JSON.stringify(options.brand.title)};
const SITE_URL = ${siteUrlLiteral};
const PKG_DESCRIPTION = ${JSON.stringify(packageDescription)};
const DESC_LOOKUP = ${JSON.stringify(descLookupTable, null, 2)};

// C-301: shared between transformPageData/transformHead below — the one
// place a page's relativePath resolves to its package identity + fallback
// copy, so the two hooks can never disagree on what a page's title/
// description actually is. \`null\` for index/404/docs: none of those are a
// PACKAGE detail page (index/404 have no package identity at all; docs
// pages already get a real title from their own Markdown content).
function detailPageMeta(relativePath) {
  if (relativePath === "index.md" || relativePath === "404.md") return null;
  const segments = relativePath.replace(/\\.md$/, "").split("/");
  if (segments[0] === "docs") return null;
  const key = segments.join("/");
  const desc = DESC_LOOKUP[key];
  return {
    key,
    title: desc ? desc.title : key,
    // split/join, not replace(): a replacement STRING is \`$\`-significant in
    // replace()/replaceAll(), and this one is consumer data.
    description: desc ? desc.description : PKG_DESCRIPTION.split("{name}").join(key),
  };
}

// C-301: the clean-URL path \`link rel=canonical\`/\`og:url\` both resolve
// against — \`null\` for 404 (nothing to canonicalize), "/" for the landing
// page, "/<key>" for every other routable page (detail AND docs alike,
// unlike \`detailPageMeta\` above which is package-scoped only).
function canonicalPath(relativePath) {
  if (relativePath === "404.md") return null;
  if (relativePath === "index.md") return "/";
  return \`/\${relativePath.replace(/\\.md$/, "")}\`;
}

export default defineConfig({
  srcDir: ${JSON.stringify(options.srcDir)},
  srcExclude: ["public/**"],
  cleanUrls: true,
  vite: { cacheDir: ${JSON.stringify(cacheDir)} },
  title: BRAND_TITLE,${
    options.description !== undefined ? `\n  description: ${JSON.stringify(options.description)},` : ""
  }
  head: [${faviconHeadEntry(options.favicon)}${ogImageHeadEntries(logoHref, options.siteUrl)}
    ["meta", { property: "og:site_name", content: BRAND_TITLE }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "color-scheme", content: "light dark" }],
  ],${sitemapField}
  ignoreDeadLinks: [/^\\/p\\//],
  markdown: {
    theme: ocxCodeTheme(),
    headers: { level: [2, 3] },
  },
  themeConfig: {
    brand: ${JSON.stringify(themeBrand, null, 2)},
    nav: ${JSON.stringify(options.nav, null, 2)},
    docsPresent: ${JSON.stringify(docsPresent)},
    siteUrl: ${siteUrlLiteral},
    search: { provider: 'local' },
  },
  // C-301: sets a detail page's OWN title (bare — VitePress's own
  // titleTemplate does the " | BRAND_TITLE" suffixing from here, never
  // reimplemented in this file); index/404/docs pages are left untouched.
  transformPageData(pageData) {
    const meta = detailPageMeta(pageData.relativePath);
    if (meta) return { title: meta.title };
  },
  transformHead({ pageData }) {
    const head = [];
    if (pageData.relativePath === "index.md") {
      head.push(["link", { rel: "preload", href: "/data/catalog/catalog.json", as: "fetch", crossorigin: "" }]);
    }
    const path = canonicalPath(pageData.relativePath);
    if (SITE_URL && path !== null) {
      head.push(["link", { rel: "canonical", href: \`\${SITE_URL}\${path}\` }]);
    }
    const meta = detailPageMeta(pageData.relativePath);
    if (meta) {
      head.push(
        ["meta", { property: "og:title", content: \`\${meta.title} — \${BRAND_TITLE}\` }],
        ["meta", { property: "og:description", content: meta.description }],
        ["meta", { name: "description", content: meta.description }],
        // C-301: prefetches this page's own wire root ahead of
        // usePackageRoot.ts's mount-time fetch.
        ["link", { rel: "preload", href: \`/p/\${meta.key}.json\`, as: "fetch", crossorigin: "" }],
      );
      if (SITE_URL) head.push(["meta", { property: "og:url", content: \`\${SITE_URL}/\${meta.key}\` }]);
    }
    return head;
  },
});
`;
}

/**
 * C-303: emits `public/robots.txt` (with a `Sitemap:` line pointing at
 * VitePress's own `sitemap.xml`) whenever `siteUrl` is set — the SAME guard
 * as `sitemap.hostname` (`renderConfig`'s `sitemapField`), so the two
 * site-discovery files can never disagree about whether a deployment origin
 * is configured. Written into the SAME `public/` mount `copyBrandLogo`
 * writes the logo into (VitePress's default `publicDir`): `synthesizePages()`
 * has already copied a consumer's own `publicDir` there by the time this
 * runs, so `wx` (write-exclusive) fails with `EEXIST` on a `publicDir`-
 * supplied `robots.txt`, which this function treats as "the consumer
 * already has one" and leaves untouched — a default, never an override.
 */
async function emitRobotsTxt(srcRoot: string, siteUrl: string): Promise<void> {
  const publicDir = join(srcRoot, "public");
  await mkdir(publicDir, { recursive: true });
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  try {
    await writeFile(join(publicDir, "robots.txt"), body, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

export async function generateConfig(options: GeneratedConfigOptions): Promise<void> {
  const srcRoot = join(options.scratchRoot, options.srcDir);
  const vitepressDir = join(options.scratchRoot, ".vitepress");
  const themeDir = join(vitepressDir, "theme");
  await mkdir(themeDir, { recursive: true });

  const [docsPresent, segmentsList, logoHref] = await Promise.all([
    isDirectory(join(srcRoot, "docs")),
    discoverPackageSegments(srcRoot),
    copyBrandLogo(options),
  ]);

  const descLookupTable: Record<string, { title: string; description: string }> = {};
  if (options.descLookup !== undefined) {
    for (const segments of segmentsList) {
      const result = options.descLookup(segments);
      if (result !== null) {
        descLookupTable[segments.join("/")] = result;
      }
    }
  }

  await Promise.all([
    writeFile(join(vitepressDir, "config.mts"), renderConfig(options, docsPresent, descLookupTable, logoHref), "utf8"),
    writeFile(join(themeDir, "index.ts"), renderThemeShim(options.css), "utf8"),
    options.siteUrl !== undefined ? emitRobotsTxt(srcRoot, options.siteUrl) : undefined,
  ]);
}
