import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig } from "../../src/build/config_gen.js";
import { linkNodeModules, withTempDir } from "./helpers.js";

/*
 * C-005 named requirement: a consumer's `css` rules must WIN in the final
 * cascade order — the theme's own `--c-accent` (src/theme/styles/tokens/
 * palette.css: `#ff6047`) must be overridden by whatever the consumer's
 * `css` file sets for the same custom property, in the REAL built output.
 * Guards the Vite CSS-chunk-ordering bug class (vite#5185/#6375/#22252)
 * specifically across a package boundary (research artifact).
 *
 * Real build, same "requires the './theme' package export" caveat as
 * `engine_real_build.test.ts` — see that file's doc for the full note.
 */

const SRC_DIR = "src";
const CONSUMER_ACCENT = "#123456";
const THEME_ACCENT = "#ff6047"; // src/theme/styles/tokens/palette.css, --c-accent

function route(segments: readonly string[]): PackageRoute {
  return { segments, wireBase: "" };
}

/** Every stylesheet-loading `<link>` href in `html`, in document order.
 * `rel` matches "stylesheet" as one space-separated token, not an exact
 * string — Vite 8/VitePress 2's real build output emits
 * `rel="preload stylesheet"` for critical-CSS preload links (verified
 * against this package's own real build), not a bare `rel="stylesheet"`. */
function stylesheetHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<link[^>]*rel=["'][^"']*\bstylesheet\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/g;
  for (const match of html.matchAll(re)) {
    hrefs.push(match[1]);
  }
  return hrefs;
}

describe("C-005 css order — consumer css wins in the final cascade", () => {
  it(
    "the built page's stylesheets, concatenated in link order, resolve --c-accent to the consumer's override",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        await synthesizePages({ scratchRoot: root.path, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });

        await withTempDir("catalog-css-consumer-", async (consumerDir) => {
          const cssPath = join(consumerDir, "custom.css");
          await writeFile(cssPath, `:root { --c-accent: ${CONSUMER_ACCENT}; }\n`, "utf8");

          await generateConfig({
            scratchRoot: root.path,
            srcDir: SRC_DIR,
            brand: { title: "CSS Order Test" },
            nav: [],
            css: cssPath,
          });

          await withTempDir("catalog-css-out-", async (outDir) => {
            // No cacheDir here — see engine_real_build.test.ts's comment:
            // vitepress's real `build()` type has no such option; it's a
            // Vite root-level UserConfig field, likely `generateConfig()`'s
            // job to write, not `build()`'s to receive.
            await build(root.path, { outDir });

            const html = await readFile(join(outDir, "kitware", "cmake.html"), "utf8");
            const hrefs = stylesheetHrefs(html);
            expect(hrefs.length).toBeGreaterThan(0);

            const cssChunks = await Promise.all(
              hrefs.map((href) => readFile(join(outDir, href.replace(/^\//, "")), "utf8")),
            );
            const concatenated = cssChunks.join("\n");

            const themeIdx = concatenated.lastIndexOf(THEME_ACCENT);
            const consumerIdx = concatenated.lastIndexOf(CONSUMER_ACCENT);
            expect(consumerIdx).toBeGreaterThan(-1);
            expect(consumerIdx).toBeGreaterThan(themeIdx);
          });
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );
});
