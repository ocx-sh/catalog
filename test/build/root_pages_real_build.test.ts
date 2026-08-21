import { describe, it, expect } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCatalog } from "../../src/build/engine.js";
import { withTempDir } from "./helpers.js";

/*
 * Identity-gate blockers found in WP-10's first pass (missing from a
 * package-built site vs. the current site's `site/src/`): a root `index.md`
 * (`layout: catalog`), a `404.md` (so VitePress emits `404.html`), and a
 * copied `publicDir` (the current site's `src/public/favicon.svg`). Real
 * `buildCatalog()` end-to-end, no mocks — same posture as
 * `engine_config_wiring.test.ts`, which this file is a sibling to (new
 * `publicDir` config field, not covered there).
 */

describe("C-005/C-002 buildCatalog — root page, 404, and publicDir all reach dist/", () => {
  it(
    "a real catalog.config.json with publicDir set produces /, /404.html, and the copied public asset (nested included)",
    async () => {
      await withTempDir("catalog-root-pages-config-", async (configDir) => {
        await mkdir(join(configDir, "packages"), { recursive: true });
        await mkdir(join(configDir, "assets", "nested"), { recursive: true });
        await writeFile(join(configDir, "assets", "favicon.svg"), "<svg><!-- favicon --></svg>\n", "utf8");
        await writeFile(join(configDir, "assets", "nested", "logo.svg"), "<svg><!-- nested --></svg>\n", "utf8");

        const configPath = join(configDir, "catalog.config.json");
        await writeFile(
          configPath,
          JSON.stringify({
            // Explicit label: an unlabeled source with zero package roots is
            // a hard `LABEL_DERIVATION_EMPTY` error now that the source
            // pipeline is wired (`labels.ts`) — this test is about the root
            // page/404/publicDir, not label derivation.
            sources: [{ path: "packages", root: true, label: "packages" }],
            // `brand.logo` is a config-relative path (here a NESTED one) —
            // the build flattens it to its basename in the public root.
            brand: { title: "Root Pages Test", wordmark: "root.pages.example", logo: "assets/nested/logo.svg" },
            publicDir: "assets",
          }),
          "utf8",
        );

        await withTempDir("catalog-root-pages-out-", async (outDir) => {
          await buildCatalog({ configPath, outDir });

          const [indexExists, notFoundExists] = await Promise.all([
            stat(join(outDir, "index.html")).then(() => true),
            stat(join(outDir, "404.html")).then(() => true),
          ]);
          expect(indexExists).toBe(true);
          expect(notFoundExists).toBe(true);

          // VitePress's default publicDir resolves to <srcDir>/public and
          // copies its content to the outDir ROOT verbatim — no rewriting.
          const [favicon, nestedAsset] = await Promise.all([
            readFile(join(outDir, "favicon.svg"), "utf8"),
            readFile(join(outDir, "nested", "logo.svg"), "utf8"),
          ]);
          expect(favicon).toContain("favicon");
          expect(nestedAsset).toContain("nested");

          // The index page itself renders (catalog layout, not a bare
          // frontmatter dump) — the fixed skeleton (header/nav) is present.
          const indexHtml = await readFile(join(outDir, "index.html"), "utf8");
          expect(indexHtml).toContain('class="site-header"');

          // C-002 brand, end to end through buildCatalog: the configured
          // logo is served from the site root under its own basename (NOT
          // the nested config path), and the header shows the wordmark.
          expect(await readFile(join(outDir, "logo.svg"), "utf8")).toContain("nested");
          expect(indexHtml).toContain('src="/logo.svg"');
          expect(indexHtml).toContain("root.pages.example");
        });
      });
    },
    30_000,
  );

  it(
    "publicDir absent -> no public assets are copied, build still succeeds",
    async () => {
      await withTempDir("catalog-no-public-config-", async (configDir) => {
        await mkdir(join(configDir, "packages"), { recursive: true });
        const configPath = join(configDir, "catalog.config.json");
        await writeFile(
          configPath,
          JSON.stringify({
            sources: [{ path: "packages", root: true, label: "packages" }],
            brand: { title: "No Public Dir Test" },
          }),
          "utf8",
        );

        await withTempDir("catalog-no-public-out-", async (outDir) => {
          await expect(buildCatalog({ configPath, outDir })).resolves.not.toThrow();
          await expect(stat(join(outDir, "favicon.svg"))).rejects.toThrow();
        });
      });
    },
    30_000,
  );
});
