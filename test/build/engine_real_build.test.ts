import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig } from "../../src/build/config_gen.js";
import { assertOutDirSafe } from "../../src/cli/out_dir.js";
import { linkNodeModules, withTempDir, writeDocsFixture } from "./helpers.js";

/*
 * REAL end-to-end build — no mocks — over the actual function composition
 * `buildCatalog` (engine.ts) wires as steps 3-8 of its FIXED 8-step order.
 * This is the closest thing to the identity gate inside this package: real
 * scratch root, real page synthesis at multiple depths + a real docs mount,
 * a real generated VitePress config, a real `assertOutDirSafe` guard, and a
 * real `vitepress build()` producing real files on disk.
 *
 * Deliberately NOT routed through `buildCatalog()` itself: `BuildCatalogOptions`
 * has no injection point for a resolved package list, and the source layer
 * that would populate one (C-003, WP-07) isn't in this tree yet — see the
 * WP-06 report. Steps 1-2 (config load + source resolution) are covered
 * separately (mocked) in `engine.test.ts`.
 *
 * ALSO REQUIRES (flagged, not worked around): `generateConfig`'s theme shim
 * hardcodes `import Theme from "@ocx-sh/catalog/theme"` (config_gen.ts's own
 * contract) — this package's `package.json` does not yet export a "./theme"
 * subpath (confirmed empirically: no "./theme" key in `exports`, and no
 * `@ocx-sh` scope exists anywhere under this package's own `node_modules`).
 * Until that lands (WP-01/WP-12 territory per config_gen.ts's own doc), this
 * test will fail with a module-resolution error even after engine/pages/
 * config_gen are implemented — a real, load-bearing cross-WP dependency,
 * not a bug in this test.
 */

const SRC_DIR = "src";
const SITE_URL = "https://e2e.example.test";

/** A root:true source's route: namespace/package read straight back off segments. */
function route(segments: readonly string[]): PackageRoute {
  return {
    segments,
    namespace: segments[0]!,
    package: segments.slice(1).join("/"),
    wireBase: "",
  };
}

describe("C-005 real end-to-end build (no mocks)", () => {
  it(
    "synthesizes pages at multiple depths + a docs mount, generates a config, and vitepress build() produces real dist output",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        const docsSourceDir = await writeDocsFixture(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["standalone"]), route(["kitware", "cmake"]), route(["a", "b", "c"])],
          docsSourceDir,
        });

        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Real Build Test Catalog" },
          nav: [{ text: "Docs", link: "/docs/" }],
          siteUrl: SITE_URL,
        });

        await withTempDir("catalog-engine-real-out-", async (outDir) => {
          assertOutDirSafe(root.path, outDir);

          // NOT passing cacheDir here: engine.ts's own doc describes step 7
          // as `build(scratchRoot, { outDir, cacheDir })`, but vitepress
          // 2.0.0-alpha.19's REAL `build()` type (verified here, standalone
          // tsc) has no `cacheDir` in its options param at all — it's a
          // Vite root-level `UserConfig` field (`vite`'s own
          // `UserConfig.cacheDir`), not a `build()` call option. The likely
          // fix is `generateConfig()` writing `cacheDir` into the generated
          // `.vitepress/config.mts` instead (`GeneratedConfigOptions` has no
          // such field yet either) — flagged in the WP-06 report, not
          // guessed at here by passing a param the real library rejects.
          await build(root.path, { outDir });

          const rendered = await Promise.all(
            [
              join(outDir, "standalone.html"),
              join(outDir, "kitware", "cmake.html"),
              join(outDir, "a", "b", "c.html"),
              join(outDir, "docs", "guide.html"),
            ].map(async (file) => {
              const stats = await stat(file);
              return stats.isFile();
            }),
          );
          expect(rendered).toEqual([true, true, true, true]);

          // C-002/Block-2: siteUrl reaches a real package page's og:url —
          // never emitted for the docs page (config_gen.ts's transformHead
          // deliberately skips `docs/**`, matching the original site).
          const packageHtml = await readFile(join(outDir, "kitware", "cmake.html"), "utf8");
          expect(packageHtml).toContain(`<meta property="og:url" content="${SITE_URL}/kitware/cmake">`);
          const docsHtml = await readFile(join(outDir, "docs", "guide.html"), "utf8");
          expect(docsHtml).not.toContain("og:url");

          // S-007, absent half: this config sets no `favicon`, so the build
          // emits NO icon link, and the per-package description falls back
          // to the theme's fixed, brand-titled default — the deployment-
          // specific `ocx.sh/` + "OCX public package index" copy lives in
          // the index's own package roots (`desc`), never baked in here.
          expect(packageHtml).not.toContain('rel="icon"');
          expect(docsHtml).not.toContain('rel="icon"');
          const fallback = "Install kitware/cmake from Real Build Test Catalog.";
          expect(packageHtml).toContain(`<meta property="og:description" content="${fallback}">`);
          expect(packageHtml).toContain(`<meta name="description" content="${fallback}">`);
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );
});
