import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/build/engine.js";
import { rootJsonBytes, sha256Digest, utf8 } from "../sources/helpers.js";
import { withTempDir } from "./helpers.js";

/*
 * C-301/C-303 — real CLI path (`buildCatalog()`, the shipped
 * `ocx-catalog build` entrypoint), no mocks: a real `catalog.config.json`
 * (siteUrl + a brand logo + one real package with a desc) -> real source
 * reading -> a real `vitepress build()` -> real bytes in `dist/`. Proves
 * the identity-gate defect this WP exists to fix is actually reachable
 * through the shipped entrypoint, not just through `generateConfig()`
 * called directly (`config_gen.test.ts` covers the unit-level shape;
 * this file is the "a shipped entrypoint actually reaches it" half —
 * subsystem-tests.md's own "coverage cannot detect unreachable production
 * code" rule).
 */

const BRAND_TITLE = "SEO Real Build Test";
const SITE_URL = "https://mirror.example.test";
const LOGO_BYTES = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><!-- fixture logo --></svg>\n';

const IMAGE_INDEX = utf8(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: `sha256:${"c".repeat(64)}`,
        size: 512,
        platform: { os: "linux", architecture: "amd64" },
      },
    ],
  }),
);
const IMAGE_INDEX_DIGEST = sha256Digest(IMAGE_INDEX);

const WIDGET_ROOT = rootJsonBytes({
  name: "ocx.sh/acme/widget",
  created: "2026-01-01",
  desc: { title: "Widget", description: "The widget package.", keywords: ["widget"] },
  tags: { "1.0.0": { content: IMAGE_INDEX_DIGEST, observed: "2026-01-02T00:00:00Z" } },
});

const WIRE_TREE: Readonly<Record<string, Uint8Array>> = {
  "config.json": utf8(JSON.stringify({ format_version: 1 })),
  "p/acme/widget.json": WIDGET_ROOT,
  [`p/acme/widget/o/sha256/${IMAGE_INDEX_DIGEST.slice("sha256:".length)}.json`]: IMAGE_INDEX,
};

async function writeFixture(configDir: string): Promise<string> {
  for (const [relPath, bytes] of Object.entries(WIRE_TREE)) {
    const full = join(configDir, "index", relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
  await mkdir(join(configDir, "assets"), { recursive: true });
  await writeFile(join(configDir, "assets", "logo.svg"), LOGO_BYTES, "utf8");

  const configPath = join(configDir, "catalog.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      sources: [{ path: "index", root: true, label: "ocx.sh" }],
      brand: { title: BRAND_TITLE, logo: "assets/logo.svg" },
      siteUrl: SITE_URL,
    }),
    "utf8",
  );
  return configPath;
}

describe("C-301/C-303 buildCatalog — per-page SEO head + robots.txt reach dist/ (real CLI path)", () => {
  it(
    "a real catalog.config.json with siteUrl + brand.logo produces per-page title/canonical/preload, site-wide og:image, and robots.txt",
    async () => {
      await withTempDir("catalog-seo-config-", async (configDir) =>
        withTempDir("catalog-seo-out-", async (outDir) => {
          const configPath = await writeFixture(configDir);
          await buildCatalog({ configPath, outDir });

          const [indexHtml, widgetHtml] = await Promise.all([
            readFile(join(outDir, "index.html"), "utf8"),
            readFile(join(outDir, "acme", "widget.html"), "utf8"),
          ]);

          // 1. Per-page <title> (C-301): the detail page's OWN desc title
          // leads, the site title trails via VitePress's own
          // titleTemplate — NOT the bare site title every detail page
          // rendered before this fix.
          expect(widgetHtml).toContain(`<title>Widget | ${BRAND_TITLE}</title>`);
          // The landing page is legitimately just the bare site title —
          // untouched by the C-301 fix, still correct.
          expect(indexHtml).toContain(`<title>${BRAND_TITLE}</title>`);

          // 2. link rel=canonical (C-301), siteUrl + clean path, on both
          // the landing page and a detail page.
          expect(indexHtml).toContain(`<link rel="canonical" href="${SITE_URL}/">`);
          expect(widgetHtml).toContain(`<link rel="canonical" href="${SITE_URL}/acme/widget">`);

          // 3. Detail-page-only preload for its own wire root (C-301) — the
          // `_root.json` alias `usePackageRoot.ts` actually fetches, never
          // the canonical `<pkg>.json` an ad blocker's unanchored
          // `/<word>.js` rule matches (sources/types.ts
          // `packageRootAliasPath`).
          expect(widgetHtml).toContain('<link rel="preload" href="/p/acme/widget/_root.json" as="fetch" crossorigin="">');
          expect(widgetHtml).not.toContain('href="/p/acme/widget.json"');
          expect(indexHtml).not.toContain("/p/acme/widget");

          // 4. Site-wide og:image/twitter:image from the brand logo,
          // absolute (siteUrl is set) — present on every page, including
          // the landing page.
          const absoluteLogo = `${SITE_URL}/logo.svg`;
          expect(indexHtml).toContain(`<meta property="og:image" content="${absoluteLogo}">`);
          expect(indexHtml).toContain(`<meta name="twitter:image" content="${absoluteLogo}">`);
          expect(widgetHtml).toContain(`<meta property="og:image" content="${absoluteLogo}">`);

          // 5. color-scheme meta, unconditional, every page.
          expect(indexHtml).toContain('<meta name="color-scheme" content="light dark">');
          expect(widgetHtml).toContain('<meta name="color-scheme" content="light dark">');

          // 6. robots.txt (C-303), reachable through the SAME shipped
          // entrypoint, with a Sitemap: line — and VitePress's own
          // sitemap.xml (driven by the same siteUrl guard) really landed
          // beside it, proving the two site-discovery files agree.
          const robots = await readFile(join(outDir, "robots.txt"), "utf8");
          expect(robots).toContain("User-agent: *");
          expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
          expect(await stat(join(outDir, "sitemap.xml")).then((s) => s.isFile())).toBe(true);
        }),
      );
    },
    30_000,
  );
});
