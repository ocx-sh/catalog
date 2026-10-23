/**
 * Pure builder of the complete `AstroUserConfig` (ADR D1). Only
 * `import type` from "astro" is allowed here (C-025): this module runs
 * inside the Astro child, but is also loaded by the CLI's tests.
 * Pins per C-043/C-044/C-045.
 */
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import type { AstroUserConfig } from "astro";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { docsMarkdownPlugin } from "./docs_markdown.js";
import { catalog } from "./integration.js";
import { HELPER_ID } from "./lean_preload.js";

export interface SiteInput {
  /** Canonical config `base`: `/` or `/seg/…/`. */
  readonly base: string;
  /** `siteUrl`, when set: enables `site` and `@astrojs/sitemap`. */
  readonly siteUrl?: string;
  /** Staging output directory. */
  readonly outDir: string;
  /** `<scratch>/public`. */
  readonly publicDir: string;
  /** Inside the scratch root, never Vite's default `node_modules/.vite`. */
  readonly cacheDir: string;
  /** Absolute path of `<scratch>/site.json`. */
  readonly sitePath: string;
  /** `script-src` hashes from `cspHashes()`. */
  readonly cspHashes: readonly string[];
  /** Absolute path of the consumer's `docs` directory, when `docs` is set: its markdown gets link rewriting. */
  readonly docsDir?: string;
  /** Dev only: bound with `strictPort` on `127.0.0.1`. */
  readonly port?: number;
  /** `vite.server.fs.allow`: scratch root, this package's dir, the resolved theme dir. */
  readonly fsAllow: readonly string[];
}

type ScriptHash = `sha256-${string}`;
type CodeTheme = Exclude<NonNullable<NonNullable<AstroUserConfig["markdown"]>["shikiConfig"]>["theme"], string | undefined>;

/**
 * The docs fences' Shiki theme. Every colour is a `var(--ocx-color-code-*)`
 * reference, which Shiki copies into each span's `style` untouched and the
 * browser resolves there; the tokens swap per colour scheme in the theme's
 * `tokens.css`, so ONE theme follows light and dark with no per-scheme rule.
 * No italics: the design has none.
 */
const codeVar = (role: string): string => `var(--ocx-color-code-${role})`;
const OCX_CODE_THEME: CodeTheme = {
  name: "ocx",
  type: "light",
  colors: { "editor.background": codeVar("bg"), "editor.foreground": codeVar("fg") },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: codeVar("comment") } },
    { scope: ["string", "string.quoted", "constant.other.symbol"], settings: { foreground: codeVar("string") } },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "support.type", "entity.name.tag"],
      settings: { foreground: codeVar("keyword") },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "keyword.other.unit"],
      settings: { foreground: codeVar("number") },
    },
    {
      scope: ["entity.name.function", "support.function", "entity.name.section", "markup.heading"],
      settings: { foreground: codeVar("function"), fontStyle: "bold" },
    },
    {
      scope: ["variable", "variable.parameter", "entity.other.attribute-name"],
      settings: { foreground: codeVar("variable") },
    },
    { scope: ["markup.deleted"], settings: { foreground: codeVar("deleted") } },
  ],
};

/** A path as a literal glob: forward slashes, glob metacharacters escaped. */
const globLiteral = (path: string): string => path.split(sep).join("/").replace(/[\\*?[\]{}()!@+|]/g, "\\$&");

/**
 * Vite's `assetsInlineLimit` (also Astro's rule for inlining a script chunk with no imports). A component script
 * Astro inlines is copied into the HTML once per rendered instance, not once per page: the theme's `LogoTile`
 * script (the logo load/error listeners, 400 B gz) would ship three times in the landing HTML, which has no room
 * for that (14,200 B budget). It stays an external file the three tags share. Anything else keeps the default (4096).
 * The name is Astro's own (`<Component>.astro_astro_type_script_index_<n>_lang`); `lean_chunks.test.ts` fails the day it drifts.
 */
export const inlineLimit = (file: string): boolean | undefined => (/LogoTile\.astro_astro_type_script/.test(file) ? false : undefined);

/** A bundler module id as a forward-slash path without its query. */
const modulePath = (id: string): string => id.replace(/\?.*$/s, "").replaceAll("\\", "/");

/**
 * Rolldown's `codeSplitting` (C-017). Two chunks, both named for what they are:
 *
 *  - `eager`: what every gated page loads before input anyway (the trigger layer, the preload stub, the dom helpers),
 *    so no page-script chunk is split off it.
 *  - `zag-core`: the `@zag-js/*` modules two or more lazy chunks share (`minShareCount`), plus the theme's runtime, the copy
 *    code with its toast and the drawer machine; a module one machine alone uses stays in that machine's chunk.
 *    Left to the automatic split they form a chain (`mobile-menu.zag` > `drawer.zag` > `dist` > `dismissable-layer`
 *    > `create-machine` > `state`) that the browser fetches one level per round trip, because the preload hints that
 *    would flatten it are dropped (`lean_preload.ts`). One chunk caps every lazy machine at two levels: its own
 *    and this. `lean_chunks.test.ts` asserts the depth.
 *
 * Theme modules are matched by their path under `themeSrc` (the resolved theme `src/`), the catalog's own by `siteDir`.
 */
export const codeSplitting = (themeSrc: string, siteDir: string) => {
  const theme = (...names: string[]): Set<string> => new Set(names.map((name) => `${modulePath(themeSrc)}/components/ui/${name}`));
  const eager = theme("lazy.mjs", "zag.mjs", "value-set.mjs");
  const core = theme("zag-runtime.mjs", "drawer.zag.mjs");
  // The copy code and its toast sit beside the machines (`components/`, not `components/ui/`): `copy-menu.zag` and the
  // page's code-copy buttons both load them, and left alone they chain `copy-menu.zag` > `copy` > `toast`.
  for (const name of ["copy.mjs", "toast.mjs"]) core.add(`${modulePath(themeSrc)}/components/${name}`);
  const dom = `${modulePath(siteDir)}/lib/dom`;
  return {
    groups: [
      {
        name: "eager",
        test: (id: string): boolean => {
          const path = modulePath(id);
          return id === HELPER_ID || eager.has(path) || path === `${dom}.js` || path === `${dom}.ts`;
        },
      },
      {
        name: "zag-core",
        minShareCount: 2,
        test: (id: string): boolean => {
          const path = modulePath(id);
          return core.has(path) || path.includes("/node_modules/@zag-js/");
        },
      },
    ],
  };
};

/** Every `@zag-js/*` package the theme depends on: each is behind a lazy import, so `dev` would find it mid-session. */
function themeZagDeps(): string[] {
  // The theme exports no `package.json`; it sits one level above `src/tokens.css`.
  const tokens = createRequire(import.meta.url).resolve("@ocx-sh/theme/tokens.css");
  const manifest: unknown = JSON.parse(readFileSync(join(dirname(tokens), "..", "package.json"), "utf8"));
  // The theme's own `@zag-js/*` dependencies are the reason this list exists: the field is always there.
  const deps = (manifest as { dependencies: Record<string, string> }).dependencies;
  return Object.keys(deps).filter((dep) => dep.startsWith("@zag-js/"));
}

/**
 * Dev only. Vite hands its logger an `Error` when a watched file change fails, and Astro's Vite logger calls
 * `msg.includes` on it (astro 7.3.6 to 7.4.2), so the real failure surfaces as an unhandled
 * "msg.includes is not a function". Passing the error's text with the error as `opts.error` shows the real one.
 */
export const viteErrorText = {
  name: "ocx-catalog:vite-error-text",
  configureServer(server: { config: { logger: { error: (msg: unknown, opts?: { error?: unknown }) => void } } }): void {
    const { logger } = server.config;
    const error = logger.error.bind(logger);
    logger.error = (msg, opts) =>
      typeof msg === "string" ? error(msg, opts) : error(msg instanceof Error ? (msg.stack ?? msg.message) : String(msg), { ...opts, error: opts?.error ?? msg });
  },
};

export const astroConfig = (input: SiteInput): AstroUserConfig => ({
  base: input.base,
  ...(input.siteUrl === undefined ? {} : { site: input.siteUrl }),
  outDir: input.outDir,
  publicDir: input.publicDir,
  cacheDir: input.cacheDir,
  trailingSlash: "always",
  compressHTML: true,
  build: { format: "directory", inlineStylesheets: "never", concurrency: 1 },
  devToolbar: { enabled: false },
  // Shiki highlights the docs fences only (READMEs take the parent-side
  // sanitiser and never reach this processor); with no docs mount it stays off,
  // since Astro warns about Shiki's inline `style` attributes under `security.csp`
  // (they are allowed: `style-src` keeps 'unsafe-inline' below). The Sätteri
  // processor is Astro 7's default, named so an Astro default change cannot swap
  // the docs renderer.
  markdown: {
    syntaxHighlight: input.docsDir === undefined ? false : "shiki",
    shikiConfig: { theme: OCX_CODE_THEME },
    processor: satteri({ hastPlugins: input.docsDir === undefined ? [] : [docsMarkdownPlugin(input.docsDir, input.base, input.publicDir)] }),
  },
  security: {
    csp: {
      algorithm: "SHA-256",
      // `script-src 'self'` is Astro's default; the theme's `is:inline` scripts
      // are not hashed by Astro, so their hashes come from the caller.
      scriptDirective: { hashes: input.cspHashes as ScriptHash[] },
      // 'unsafe-inline' stays: sanitized README tables carry `style=` attributes.
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      directives: ["object-src 'none'", "base-uri 'none'", "form-action 'none'"],
    },
  },
  server: { host: "127.0.0.1", ...(input.port === undefined ? {} : { port: input.port }) },
  vite: {
    // Bundler options live under `rolldownOptions` only (Vite 8): a `rollupOptions` key is a silent no-op.
    build: {
      rolldownOptions: {
        output: { codeSplitting: codeSplitting(dirname(createRequire(import.meta.url).resolve("@ocx-sh/theme/tokens.css")), dirname(fileURLToPath(import.meta.url))) },
      },
      assetsInlineLimit: inlineLimit,
    },
    // One Astro runtime: a second copy resolved from the theme's own dependencies would give components a foreign `Astro` global.
    resolve: { dedupe: ["astro"] },
    ...(input.port === undefined ? {} : { plugins: [viteErrorText] }),
    // `dev`: deps first imported by a lazy chunk are found mid-session; Vite then re-optimizes and the open page's
    // dynamic import dies ("Outdated Optimize Dep"), which the grid reports as a catalog that did not load.
    ...(input.port === undefined
      ? {}
      : { optimizeDeps: { include: ["minisearch", ...themeZagDeps().map((dep) => `@ocx-sh/theme > ${dep}`)] } }),
    // Build only (a `port` marks `dev`): bundle every dependency into the prerender chunk.
    // Left external, the chunk's bare
    // imports (`cookie`, `@oslojs/encoding`, …) resolve at runtime from the chunk's own
    // location (the staging dir beside the consumer's `outDir`), so they hit the
    // consumer's hoisted copy (e.g. `cookie@0.7.2` from an unrelated dev dependency)
    // instead of the one Astro itself resolves (`cookie@2`), or none at all.
    // Astro skips its own (partial) noExternal list for an environment that already says `true`.
    // `dev` must NOT set it: the module runner would load CommonJS dependencies as ESM inline
    // and every request dies with "require is not defined".
    ...(input.port === undefined
      ? { ssr: { noExternal: true }, environments: { prerender: { resolve: { noExternal: true } } } }
      : {}),
    server: {
      ...(input.port === undefined ? {} : { port: input.port, strictPort: true }),
      fs: { strict: true, allow: [...input.fsAllow] },
      // `dev`: Vite's watcher skips `node_modules`, where the scratch root lives, so it would
      // never see a reload swap `site.json` and Astro would not restart. The negation
      // re-includes the scratch root alone.
      ...(input.port === undefined ? {} : { watch: { ignored: [`!${globLiteral(dirname(input.sitePath))}/**`] } }),
    },
  },
  integrations: [catalog(input.sitePath), ...(input.siteUrl === undefined ? [] : [sitemap()])],
});
