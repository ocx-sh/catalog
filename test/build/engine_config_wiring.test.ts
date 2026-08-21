import { describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCatalog } from "../../src/build/engine.js";
import { withTempDir } from "./helpers.js";

/*
 * Spec-panel Block 2: `buildCatalog()` (the REAL `ocx-catalog build` CLI
 * path — not the lower-level synthesizePages/generateConfig/build
 * composition `engine_real_build.test.ts` exercises directly) must forward
 * a consumer's `catalog.config.json` `css`/`siteUrl`/`docs` all the way
 * through to the real rendered `dist/`. Unit tests (`engine.test.ts`,
 * mocked) only prove `buildCatalog` CALLS the right functions in the right
 * order; this file proves the values it calls them WITH survive a REAL
 * build, from a REAL config file on disk, to REAL bytes in `dist/`.
 *
 * `og:url` is NOT asserted here: `config_gen.ts`'s `transformHead`
 * deliberately never emits it for docs pages (`segments[0] === "docs"`,
 * matching the ORIGINAL site's own behavior — see that function's doc), and
 * `buildCatalog` has no package-list injection point yet (C-003/WP-07,
 * same limitation `engine_real_build.test.ts`'s own header already
 * documents), so there's no page in THIS test that could ever carry one.
 * `siteUrl`'s wiring to `og:url` is instead verified end-to-end on a real
 * PACKAGE page in `engine_real_build.test.ts` (which already has one).
 */

const CONSUMER_ACCENT = "#123456";
const THEME_ACCENT = "#ff6047"; // src/theme/styles/tokens/palette.css, --c-accent
const SITE_URL = "https://e2e.example.test";

describe("C-005/C-002 buildCatalog — real config.css/siteUrl/docs reach dist/", () => {
  it(
    "custom.css wins the cascade and sitemap.xml reflects siteUrl, via a real catalog.config.json",
    async () => {
      await withTempDir("catalog-e2e-config-", async (configDir) => {
        await mkdir(join(configDir, "packages"), { recursive: true });
        await mkdir(join(configDir, "docs"), { recursive: true });
        await writeFile(join(configDir, "docs", "guide.md"), "# Guide\n\nHello from the docs fixture.\n", "utf8");
        await writeFile(join(configDir, "custom.css"), `:root { --c-accent: ${CONSUMER_ACCENT}; }\n`, "utf8");
        const configPath = join(configDir, "catalog.config.json");
        await writeFile(
          configPath,
          JSON.stringify({
            // Explicit label: an unlabeled source with zero package roots is
            // a hard `LABEL_DERIVATION_EMPTY` error now that the source
            // pipeline is wired (`labels.ts`) — this test is about css/
            // siteUrl/docs forwarding, not label derivation.
            sources: [{ path: "packages", root: true, label: "packages" }],
            brand: { title: "E2E Config Wiring Test" },
            css: "custom.css",
            siteUrl: SITE_URL,
            docs: "docs",
          }),
          "utf8",
        );
        // No linkNodeModules() call needed here (unlike
        // engine_real_build.test.ts/css_order.test.ts's still-manual
        // scratch roots): scratch roots now live inside this repo's own
        // node_modules by construction (scratch.ts's "Location" doc), and
        // buildCatalog() creates its own — nothing for this test to link.
        await withTempDir("catalog-e2e-out-", async (outDir) => {
          await buildCatalog({ configPath, outDir });

          const sitemap = await readFile(join(outDir, "sitemap.xml"), "utf8");
          expect(sitemap).toContain(`${SITE_URL}/docs/guide`);

          const html = await readFile(join(outDir, "docs", "guide.html"), "utf8");
          const hrefs = [...html.matchAll(/<link[^>]*rel=["'][^"']*\bstylesheet\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/g)].map(
            (m) => m[1] as string,
          );
          expect(hrefs.length).toBeGreaterThan(0);
          const cssChunks = await Promise.all(hrefs.map((href) => readFile(join(outDir, href.replace(/^\//, "")), "utf8")));
          const concatenated = cssChunks.join("\n");
          const themeIdx = concatenated.lastIndexOf(THEME_ACCENT);
          const consumerIdx = concatenated.lastIndexOf(CONSUMER_ACCENT);
          expect(consumerIdx).toBeGreaterThan(-1);
          expect(consumerIdx).toBeGreaterThan(themeIdx);
        });
      });
    },
    30_000,
  );
});
