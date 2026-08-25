import { describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig, type GeneratedConfigOptions } from "../../src/build/config_gen.js";
import { linkNodeModules, withTempDir } from "./helpers.js";

/*
 * C-002 brand wiring — real end-to-end `vitepress build()` runs proving the
 * config surface reaches the RENDERED site, not just `themeConfig`. A test
 * that only checks `generateConfig` emitted the JSON is exactly the test
 * that already existed while `brand.wordmark`/`brand.logo` were read by no
 * component at all.
 *
 * The header (wordmark + logo) is server-rendered on every page, so it is
 * asserted against the emitted HTML directly. (Install commands used to be
 * config-driven and were pinned here too; now that `DEFAULT_INSTALL_FLAVORS`
 * is fixed theme content — see `useInstallFlavors.ts` — there is nothing
 * config-specific left to prove about them in a real build. The component
 * half of brand wiring — that a `<Logo>` really renders the configured mark
 * — is pinned by real DOM mounts in
 * `test/theme/components/brand_install_wiring.test.ts`.)
 */

const SRC_DIR = "src";
const LOGO_BYTES = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><!-- fixture logo --></svg>\n';

/** The theme's own built-in mark. C-606: it used to be inlined raw `<svg>`
 * DOM (identified by its own `viewBox`); it's now a Vite `?url` asset
 * import, emitted once as a real file and referenced via `<img src>` — the
 * `ocx-logo` stem (Vite appends its own content hash + keeps the extension)
 * is the one substring no consumer-configured logo asset would share. */
const BUILT_IN_MARK = /src="[^"]*ocx-logo[^"]*\.svg"/;

/** A root:true source's route: namespace/package read straight back off segments. */
function route(segments: readonly string[]): PackageRoute {
  return {
    segments,
    namespace: segments[0]!,
    package: segments.slice(1).join("/"),
    wireBase: "",
  };
}

/** The `<a class="brand">…</a>` header block — logo + wordmark. `[^>]*`
 * tolerates the scoped-CSS `data-v-xxxxxxxx` attribute Vue's SFC compiler
 * appends around the literal class written in the template. */
function brandBlock(html: string): string {
  const match = html.match(/<a[^>]*class="brand"[^>]*>[\s\S]*?<\/a>/);
  if (!match) throw new Error('no <a class="brand"> block found in rendered HTML');
  return match[0];
}

function wordmark(html: string): string {
  const match = brandBlock(html).match(/<span[^>]*class="brand-name"[^>]*>([^<]*)<\/span>/);
  if (!match) throw new Error('no <span class="brand-name"> found in the brand block');
  return match[1];
}

/** Writes the logo fixture into `dir` and returns its absolute path. */
async function writeLogoFixture(dir: string, fileName: string): Promise<string> {
  const assetDir = join(dir, "brand-assets");
  await mkdir(assetDir, { recursive: true });
  const path = join(assetDir, fileName);
  await writeFile(path, LOGO_BYTES, "utf8");
  return path;
}

/** Synthesizes one package page, generates the config, builds for real, and
 * hands `assert` the built package page's HTML plus its output directory. */
async function buildWith(
  outPrefix: string,
  options: (scratchRoot: string) => Omit<GeneratedConfigOptions, "scratchRoot" | "srcDir">,
  assert: (html: string, outDir: string) => Promise<void>,
): Promise<void> {
  const root = await createScratchRoot();
  try {
    await linkNodeModules(root.path);
    await synthesizePages({
      scratchRoot: root.path,
      srcDir: SRC_DIR,
      packages: [route(["kitware", "cmake"])],
    });
    await generateConfig({ scratchRoot: root.path, srcDir: SRC_DIR, ...options(root.path) });

    await withTempDir(outPrefix, async (outDir) => {
      await build(root.path, { outDir });
      await assert(await readFile(join(outDir, "kitware", "cmake.html"), "utf8"), outDir);
    });
  } finally {
    await root.dispose();
  }
}

describe("C-002 brand real build — a rebranded deployment", () => {
  it(
    "renders the configured wordmark and logo",
    async () => {
      await withTempDir("catalog-brand-src-", async (fixtureDir) => {
        const logoSource = await writeLogoFixture(fixtureDir, "acme-logo.svg");
        await buildWith(
          "catalog-brand-out-",
          () => ({
            brand: { title: "Acme Packages", wordmark: "packages.acme.example", logo: "brand-assets/acme-logo.svg" },
            brandLogoSource: logoSource,
            nav: [],
          }),
          async (html, outDir) => {
            // Header wordmark is `brand.wordmark`, NOT `brand.title` — the
            // two are deliberately different values here.
            expect(wordmark(html)).toBe("packages.acme.example");
            expect(html).not.toContain("index.ocx.sh");

            // Logo: the consumer's asset replaces the built-in mark, and the
            // file it points at is really served from the site root.
            expect(brandBlock(html)).toContain('src="/acme-logo.svg"');
            expect(brandBlock(html)).not.toMatch(BUILT_IN_MARK);
            expect(await readFile(join(outDir, "acme-logo.svg"), "utf8")).toBe(LOGO_BYTES);

            // `brand.title` still owns `og:site_name` unconditionally, and
            // still suffixes `<title>` via VitePress's own titleTemplate —
            // but C-301 gives this DETAIL page its own leading title
            // segment (the page's key, no descLookup configured here) so
            // the whole `<title>` is no longer just the bare site title.
            expect(html).toContain("<title>kitware/cmake | Acme Packages</title>");
            expect(html).toContain('<meta property="og:site_name" content="Acme Packages">');
          },
        );
      });
    },
    60_000,
  );
});

describe("C-002 brand real build — a config setting none of the new keys", () => {
  it(
    "falls back to brand.title in the header, and the built-in mark",
    async () => {
      await buildWith(
        "catalog-brand-default-out-",
        () => ({
          // No wordmark, no logo — exactly what a config written before this
          // WP looks like.
          brand: { title: "Plain Catalog" },
          nav: [],
        }),
        async (html) => {
          expect(wordmark(html)).toBe("Plain Catalog");
          // C-606: the built-in mark is now ALSO an <img> (emitted once as
          // a real asset, not inlined raw SVG DOM) — BUILT_IN_MARK is what
          // distinguishes it from a consumer-configured logo, not the
          // element type.
          expect(brandBlock(html)).toMatch(BUILT_IN_MARK);
          expect(brandBlock(html)).not.toContain("<svg");
        },
      );
    },
    60_000,
  );
});

describe("C-002 brand real build — the index's own identity surface", () => {
  it(
    "reproduces the index.ocx.sh header: wordmark distinct from the OCX Index page title, built-in mark",
    async () => {
      await buildWith(
        "catalog-brand-index-out-",
        () => ({
          brand: { title: "OCX Index", wordmark: "index.ocx.sh" },
          nav: [],
        }),
        async (html) => {
          expect(wordmark(html)).toBe("index.ocx.sh");
          // C-301: this DETAIL page's own title segment leads, the site
          // title trails via VitePress's own titleTemplate — see the
          // sibling assertion above for the same fix on a different brand.
          expect(html).toContain("<title>kitware/cmake | OCX Index</title>");
          expect(html).toContain('<meta property="og:site_name" content="OCX Index">');
          expect(brandBlock(html)).toMatch(BUILT_IN_MARK);
        },
      );
    },
    60_000,
  );
});
