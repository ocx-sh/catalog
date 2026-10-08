/**
 * Pure builder of the complete `AstroUserConfig` (ADR D1). Only
 * `import type` from "astro" is allowed here (C-025): this module runs
 * inside the Astro child, but is also loaded by the CLI's tests.
 * Pins per C-043/C-044/C-045.
 */
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import type { AstroUserConfig } from "astro";
import { dirname, sep } from "node:path";
import { docsLinksPlugin } from "./docs_markdown.js";
import { catalog } from "./integration.js";

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

/** A path as a literal glob: forward slashes, glob metacharacters escaped. */
const globLiteral = (path: string): string => path.split(sep).join("/").replace(/[\\*?[\]{}()!@+|]/g, "\\$&");

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
  // Syntax highlighting off: Shiki emits inline `style` attributes and warns
  // under `security.csp`. The Sätteri processor is Astro 7's default, named so
  // an Astro default change cannot swap the docs renderer.
  markdown: {
    syntaxHighlight: false,
    processor: satteri({ hastPlugins: input.docsDir === undefined ? [] : [docsLinksPlugin(input.docsDir, input.base)] }),
  },
  security: {
    csp: {
      algorithm: "SHA-256",
      // `script-src 'self'` is Astro's default; the theme's `is:inline` scripts
      // are not hashed by Astro, so their hashes come from the caller.
      scriptDirective: { hashes: input.cspHashes as ScriptHash[] },
      // 'unsafe-inline' stays: sanitized README tables carry `style=` attributes.
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      directives: ["object-src 'none'", "base-uri 'none'"],
    },
  },
  server: { host: "127.0.0.1", ...(input.port === undefined ? {} : { port: input.port }) },
  vite: {
    // Bundler options live under `rolldownOptions` only (Vite 8): a `rollupOptions` key is a silent no-op.
    build: { rolldownOptions: {} },
    // The `file:`-linked theme resolves its own copy of Astro; one runtime or components see a foreign `Astro` global.
    resolve: { dedupe: ["astro"] },
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
