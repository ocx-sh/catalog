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
 * | `head` `og:site_name`/`og:type`/`twitter:card` | Carried verbatim; `og:site_name` sourced from `brand.title`. |
 * | `head` `<link rel="icon">` | Emitted from `GeneratedConfigOptions.favicon` (C-002's `CatalogConfig.favicon`) — a site-root-relative href the consumer serves out of its own `publicDir`; `brand.logo` is NOT a favicon source (it's the header logo) and this package ships no bundled default, so an absent `favicon` emits no link at all. |
 * | `transformHead` per-page `description` fallback | Fixed template `Install {name} from <brand.title>.`, `{name}` replaced with the page's `<ns>/<pkg>` key — never a hardcoded deployment identity (the index's own `ocx.sh/` prefix and "the OCX public package index" phrasing live in a *desc* per package root, not here). |
 * | `themeConfig.brand`/`.nav`/`.docsPresent`/`.siteUrl`/`.descLookup` | Baked static JSON — see "Injection channel" above. `docsPresent` is `true` iff `<scratchRoot>/<srcDir>/docs` exists on disk when this function runs (i.e., `synthesizePages()` was given a `docsSourceDir`). `brand` is a PROJECTION of C-002's `Brand`, not the raw value: `logo` is replaced by the site-root href of the copy this function makes (see `brandLogoSource`), since a config-relative filesystem path is meaningless to a browser. `wordmark` is passed through UNRESOLVED — `SiteHeader.vue` owns the `wordmark ?? title` fallback, so a hand-written `themeConfig` behaves the same as a generated one. |
 * | `themeConfig.search.provider: 'local'` | Carried verbatim — VitePress core reads this itself (independent of active theme) to decide whether to build the local-search virtual module at all. |
 * | `ignoreDeadLinks: [/^\/p\//]` | Carried verbatim — every synthesized page still links CAS paths the dead-link linter can't see until the mirror copy (C-006) exists. |
 * | `markdown.theme` (`ocxCodeTheme`, dual light/dark Shiki JSON) | Carried verbatim, including its hardcoded OCX brand hex values — this package ships one fixed visual identity (C-008: config parameterizes brand/nav CONTENT, not the theme's own CSS token palette). |
 * | `markdown.headers: { level: [2, 3] }` | Carried verbatim — matches `OnThisPage.vue`'s fixed two-tier scroll-spy. |
 * | `sitemap.hostname` / `transformHead` `og:url` | Only emitted when `siteUrl` is given — degrades to no sitemap + no `og:url` meta, never a build failure. |
 * | `transformHead` per-page `og:title`/`og:description` | Derives the page's identity from `pageData.relativePath` (NOT `pageData.params` — see `pages.ts`'s "Specify-spike correction" doc note; a synthesized page is a plain static file, `params` is never populated for it), looks up `DESC_LOOKUP[key]` (the baked table above), degrades to generic copy on a miss. |
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

/** `ocxCodeTheme`, verbatim from `site/.vitepress/config.mts` — a fixed
 * Shiki theme (C-008: this package ships one visual identity), emitted as
 * literal generated-file source since Shiki themes are build-time JSON that
 * can't read CSS custom properties. */
const OCX_CODE_THEME_SOURCE = `function ocxCodeTheme(mode) {
  const c = mode === 'light'
    ? { bg: '#f6f8fa', fg: '#4b5665', comment: '#8a94a3', kw: '#6f5bd0', str: '#0e9f6e', num: '#9a6b13', fn: '#1b2129', vars: '#4b5665', accent: '#ff6047' }
    : { bg: '#14181f', fg: '#9aa5b3', comment: '#606c7c', kw: '#c0b3ff', str: '#3edea6', num: '#fab833', fn: '#e7ebf1', vars: '#9aa5b3', accent: '#ff6047' }
  return {
    name: \`ocx-\${mode}\`,
    type: mode,
    colors: { 'editor.background': c.bg, 'editor.foreground': c.fg },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment, fontStyle: 'italic' } },
      { scope: ['string', 'string.quoted', 'constant.other.symbol'], settings: { foreground: c.str } },
      { scope: ['keyword', 'storage.type', 'storage.modifier', 'support.type', 'entity.name.tag'], settings: { foreground: c.kw } },
      { scope: ['constant.numeric', 'constant.language', 'constant.character', 'keyword.other.unit'], settings: { foreground: c.num } },
      { scope: ['entity.name.function', 'support.function', 'entity.name.section', 'markup.heading'], settings: { foreground: c.fn, fontStyle: 'bold' } },
      { scope: ['variable', 'variable.parameter', 'entity.other.attribute-name'], settings: { foreground: c.vars } },
      { scope: ['markup.deleted'], settings: { foreground: c.accent } },
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

export default defineConfig({
  srcDir: ${JSON.stringify(options.srcDir)},
  srcExclude: ["public/**"],
  cleanUrls: true,
  vite: { cacheDir: ${JSON.stringify(cacheDir)} },
  title: BRAND_TITLE,${
    options.description !== undefined ? `\n  description: ${JSON.stringify(options.description)},` : ""
  }
  head: [${faviconHeadEntry(options.favicon)}
    ["meta", { property: "og:site_name", content: BRAND_TITLE }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { name: "twitter:card", content: "summary" }],
  ],${sitemapField}
  ignoreDeadLinks: [/^\\/p\\//],
  markdown: {
    theme: { light: ocxCodeTheme("light"), dark: ocxCodeTheme("dark") },
    headers: { level: [2, 3] },
  },
  themeConfig: {
    brand: ${JSON.stringify(themeBrand, null, 2)},
    nav: ${JSON.stringify(options.nav, null, 2)},
    docsPresent: ${JSON.stringify(docsPresent)},
    siteUrl: ${siteUrlLiteral},
    descLookup: DESC_LOOKUP,
    search: { provider: 'local' },
  },
  transformHead({ pageData }) {
    if (pageData.relativePath === "index.md") {
      return [["link", { rel: "preload", href: "/data/catalog/catalog.json", as: "fetch", crossorigin: "" }]];
    }
    if (pageData.relativePath === "404.md") return [];
    const segments = pageData.relativePath.replace(/\\.md$/, "").split("/");
    if (segments[0] === "docs") return [];
    const key = segments.join("/");
    const desc = DESC_LOOKUP[key];
    const title = desc ? \`\${desc.title} — \${BRAND_TITLE}\` : \`\${key} — \${BRAND_TITLE}\`;
    // split/join, not replace(): a replacement STRING is \`$\`-significant in
    // replace()/replaceAll(), and this one is consumer data.
    const description = desc ? desc.description : PKG_DESCRIPTION.split("{name}").join(key);
    const metas = [
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { name: "description", content: description }],
    ];
    if (SITE_URL) metas.push(["meta", { property: "og:url", content: \`\${SITE_URL}/\${key}\` }]);
    return metas;
  },
});
`;
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
  ]);
}
