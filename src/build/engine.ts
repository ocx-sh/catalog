import { join, resolve } from "node:path";
import { build as vitepressBuild } from "vitepress";
import { assertOutDirSafe } from "../cli/out_dir.js";
import { loadConfig } from "../config/load.js";
import { generateConfig } from "./config_gen.js";
import { synthesizePages } from "./pages.js";
import { createScratchRoot } from "./scratch.js";
import { emitCatalogTree, resolveCatalog } from "./sources_pipeline.js";

/**
 * `buildCatalog` (C-005): the `ocx-catalog build` entrypoint. Orchestrates,
 * in this FIXED order (per `research_vitepress_programmatic_api.md`
 * "Invocation pattern"):
 *
 * 1. `loadConfig(configPath)` (C-002) — config shape errors surface here as
 *    `ConfigError`, unchanged, before anything is written to disk.
 * 2. `resolveCatalog()` (`sources_pipeline.ts`) — reads every configured
 *    source (C-003), resolves its label, and merges their packages into the
 *    routes, the per-package `descLookup`, and the `/data/catalog/catalog.json`
 *    bytes the rest of this pipeline consumes. Runs BEFORE the scratch root
 *    exists: a source failure (`BuildError` `DATA`/`UNAVAILABLE`, see that
 *    module's "Error mapping") then leaves nothing behind at all, and
 *    nothing partial can reach `outDir`.
 * 3. `createScratchRoot()` (`scratch.ts`).
 * 4. `synthesizePages()` (`pages.ts`) — one page per resolved package (step
 *    2's `routes`, depth-N), the always-on `index.md`/`404.md`, plus the
 *    docs mount when `config.docs` is set and the public-assets mount when
 *    `config.publicDir` is set.
 * 5. `generateConfig()` (`config_gen.ts`) — scratch root's
 *    `.vitepress/config` + theme shim. Forwards `brand`/`nav`/`footer`/
 *    `docsNav` verbatim, `brand.logo` additionally resolved against `configDir` as
 *    `brandLogoSource` (the file that function copies into the site's public
 *    root — the raw config value is a path, and the theme needs an href),
 *    `css` resolved against `configDir` (C-002's containment
 *    guarantee already ran inside `loadConfig`), `siteUrl`/`description`/
 *    `favicon` verbatim, and step 2's `descLookup` — which that function evaluates
 *    once per page step 4 just wrote, baking the results into the generated
 *    config as static JSON.
 * 6. `assertOutDirSafe(scratchRoot, outDir)` — MUST run before the actual
 *    `vitepress` `build()` call, never after; refuses `outDir` equal to,
 *    an ancestor of, or a descendant of the scratch root (the scratch root
 *    is self-sweeping — output written inside it would be deleted at
 *    cleanup).
 * 7. `vitepress` `build(scratchRoot, { outDir })`. `outDir` is the CALLER's
 *    own directory, resolved against `process.cwd()`, never a path inside
 *    the scratch root. No `cacheDir` option here — the real, installed
 *    `vitepress@2.0.0-alpha.19` `build()` type has no such field (verified
 *    standalone `tsc` check, not guessed): it's a Vite ROOT-level
 *    `UserConfig` field, so `cacheDir` is written into the GENERATED config
 *    by `generateConfig()` instead, pointed inside the scratch root (never
 *    Vite's own default `node_modules/.vite`, which — now that the scratch
 *    root lives inside the CONSUMER's own `node_modules` tree, see
 *    `scratch.ts`'s "Location" doc — would otherwise share and stale-bleed
 *    the consumer's own Vite cache across unrelated builds).
 * 8. `emitCatalogTree()` (`sources_pipeline.ts`) — C-006's mirror copy of
 *    every source's wire tree (`<outDir>/index/<label>/**`, plus the
 *    `<outDir>` root itself for the `root: true` source), `_headers`, and
 *    the merged `<outDir>/data/catalog/catalog.json`. AFTER the VitePress
 *    run, deliberately: `outDir` is VitePress's own output directory, so
 *    anything written there earlier is at the mercy of the build's own
 *    emptyOutDir/publicDir handling. See that module's doc for why the
 *    merged catalog is the last write to land.
 * 9. `scratchRoot.dispose()` in a `finally` — cleanup on both success and
 *    a build failure; the module-level exit hook (`scratch.ts`) is
 *    strictly a backstop, not a substitute for this.
 *
 * S-007's identity comparison runs against the same `outDir` this function
 * returns, and stays outside this function's own responsibility (its diff
 * harness is WP-02/WP-11).
 */
export interface BuildCatalogOptions {
  /** Path to `catalog.config.json`, resolved against `process.cwd()` when
   * relative. Required — unlike `dev`, `build` has no bare `--source`
   * shortcut (C-001). */
  readonly configPath: string;
  /** Output directory, resolved against `process.cwd()` when relative. */
  readonly outDir: string;
}

export interface BuildCatalogResult {
  /** Absolute output directory the build wrote to (same value as
   * `options.outDir`, resolved). */
  readonly outDir: string;
}

export async function buildCatalog(options: BuildCatalogOptions): Promise<BuildCatalogResult> {
  const loaded = await loadConfig(options.configPath);
  const outDir = resolve(options.outDir);
  const srcDir = "src";
  const catalog = await resolveCatalog(loaded.sources, loaded.configDir);

  const scratchRoot = await createScratchRoot();
  try {
    await synthesizePages({
      scratchRoot: scratchRoot.path,
      srcDir,
      packages: catalog.routes,
      docsSourceDir: loaded.config.docs !== undefined ? join(loaded.configDir, loaded.config.docs) : undefined,
      publicDirSource:
        loaded.config.publicDir !== undefined ? join(loaded.configDir, loaded.config.publicDir) : undefined,
    });
    await generateConfig({
      scratchRoot: scratchRoot.path,
      srcDir,
      brand: loaded.config.brand,
      brandLogoSource:
        loaded.config.brand.logo !== undefined ? join(loaded.configDir, loaded.config.brand.logo) : undefined,
      nav: loaded.config.nav ?? [],
      footer: loaded.config.footer,
      docsNav: loaded.config.docsNav,
      css: loaded.config.css !== undefined ? join(loaded.configDir, loaded.config.css) : undefined,
      siteUrl: loaded.config.siteUrl,
      description: loaded.config.description,
      favicon: loaded.config.favicon,
      descLookup: catalog.descLookup,
    });

    assertOutDirSafe(scratchRoot.path, outDir);
    await vitepressBuild(scratchRoot.path, { outDir });
    await emitCatalogTree(catalog, outDir);

    return { outDir };
  } finally {
    await scratchRoot.dispose();
  }
}
