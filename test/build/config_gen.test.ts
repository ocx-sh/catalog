import { describe, it, expect } from "vitest";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig, type GeneratedConfigOptions } from "../../src/build/config_gen.js";
import type { Brand } from "../../src/config/types.js";
import { writeDocsFixture, writePublicDirFixture } from "./helpers.js";

const SRC_DIR = "src";
const LOGO_BYTES = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><!-- fixture logo --></svg>\n';
const CONFIG_PATH_SEGMENTS = [".vitepress", "config.mts"];
const THEME_SHIM_PATH_SEGMENTS = [".vitepress", "theme", "index.ts"];

const BASE_BRAND: Brand = { title: "My Catalog" };

/** A root:true source's route: namespace/package read straight back off segments. */
function route(segments: readonly string[]): PackageRoute {
  return {
    segments,
    namespace: segments[0]!,
    package: segments.slice(1).join("/"),
    wireBase: "",
  };
}

/** Runs `fn` against a real scratch root, disposing it afterward. */
async function withScratch<T>(fn: (scratchRoot: string) => Promise<T>): Promise<T> {
  const root = await createScratchRoot();
  try {
    return await fn(root.path);
  } finally {
    await root.dispose();
  }
}

function baseOptions(scratchRoot: string, overrides: Partial<GeneratedConfigOptions> = {}): GeneratedConfigOptions {
  return {
    scratchRoot,
    srcDir: SRC_DIR,
    brand: BASE_BRAND,
    nav: [],
    ...overrides,
  };
}

async function readGenerated(scratchRoot: string) {
  const [config, shim] = await Promise.all([
    readFile(join(scratchRoot, ...CONFIG_PATH_SEGMENTS), "utf8"),
    readFile(join(scratchRoot, ...THEME_SHIM_PATH_SEGMENTS), "utf8"),
  ]);
  return { config, shim };
}

describe("C-005 generateConfig — settings carried from site/.vitepress/config.mts (S-007)", () => {
  it("carries srcDir verbatim", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { srcDir: "packages-src" }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/srcDir:\s*['"]packages-src['"]/);
    });
  });

  it("sets cleanUrls: true, fixed regardless of input", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/cleanUrls:\s*true/);
    });
  });

  // VitePress globs `srcDir/**/*.md` for pages and does NOT exclude
  // `publicDir`. `dev` writes the live wire tree into `public/`, README CAS
  // blobs included, so without this every one of them compiles as a page at a
  // bogus `/p/.../o/sha256/<hex>` route and runs through Shiki. Observed as a
  // stream of "language is not loaded, falling back to txt" warnings against
  // the real index, whose Hugo README carries `go-html-template` fences.
  it("excludes public/** from page discovery", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/srcExclude:\s*\["public\/\*\*"\]/);
    });
  });

  it("sources title from brand.title", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { brand: { title: "Widget Index" } }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain("Widget Index");
    });
  });

  it("emits description when given", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { description: "A test catalog." }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/description:\s*"A test catalog\."/);
    });
  });

  it("omits description entirely when absent", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      // Exactly 2 leading spaces: the top-level `defineConfig({...})` field
      // indent — NOT a bare `/^\s*description:/m`, which also matches the
      // UNRELATED `description:` key inside `detailPageMeta`'s (C-301)
      // returned object literal, itself indented 4 spaces.
      expect(config).not.toMatch(/^ {2}description:/m);
    });
  });

  /*
   * S-007 identity: the pre-extraction site carried
   * `['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]`
   * as its first `head` entry, and the extracted package silently dropped
   * it (regression found by byte-diffing both dist trees). The value is
   * config-owned — this package bundles no default icon.
   */
  it("favicon given -> a rel=icon head entry with the type its extension implies", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { favicon: "/favicon.svg" }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('["link", {"rel":"icon","type":"image/svg+xml","href":"/favicon.svg"}]');
    });
  });

  it("favicon with an extension outside the known set -> the link, with no type attribute", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { favicon: "/brand/icon.webp" }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('["link", {"rel":"icon","href":"/brand/icon.webp"}]');
    });
  });

  it("favicon absent -> no icon link at all (this package ships no default)", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).not.toContain('"rel":"icon"');
    });
  });

  it("the per-package fallback template is always the fixed, brand-titled default", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { brand: { title: "Widget Index" } }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('const PKG_DESCRIPTION = "Install {name} from Widget Index.";');
      expect(config).not.toContain("ocx.sh/");
    });
  });

  it("writes a two-line theme shim re-exporting @ocx-sh/catalog/theme", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { shim } = await readGenerated(scratchRoot);
      expect(shim).toMatch(/from\s+["']@ocx-sh\/catalog\/theme["']/);
      expect(shim).toMatch(/export\s+default/);
    });
  });

  it("carries ignoreDeadLinks: [/^\\/p\\//] verbatim", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/ignoreDeadLinks/);
      expect(config).toContain("^\\/p\\/");
    });
  });

  it("carries markdown.headers: { level: [2, 3] } verbatim", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/headers/);
      expect(config).toMatch(/\[\s*2\s*,\s*3\s*\]/);
    });
  });

  it("carries themeConfig.search.provider: 'local' verbatim", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/provider:\s*['"]local['"]/);
    });
  });

  it("drives the Shiki theme from --ocx-color-code-* tokens, never hardcoded hex", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);

      // Assert the MECHANISM, not a sample value. The old form spot-checked
      // two hex literals, which asserts nothing about whether a consumer can
      // reach the colour — and a palette change silently invalidated it.
      expect(config).toContain("var(--ocx-color-code-");
      for (const role of ["comment", "string", "keyword", "number", "function", "variable", "deleted"]) {
        expect(config).toContain(`v('${role}')`);
      }

      // ONE theme registration, not a light/dark pair: the tokens already swap
      // on `.dark`, so a second registration would duplicate that mechanism.
      expect(config).toContain("theme: ocxCodeTheme(),");
      expect(config).not.toContain("ocxCodeTheme(\"light\")");

      // No colour literal may survive into the generated config — this is the
      // whole point of the change, and the reason `--shiki-light`/`-dark` and
      // their docs-prose switch rules could be retired.
      const withoutComments = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    });
  });

  it("cacheDir defaults to <scratchRoot>/.vitepress/cache, never Vite's own node_modules/.vite default", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/vite:\s*\{\s*cacheDir:/);
      expect(config).toContain(JSON.stringify(join(scratchRoot, ".vitepress", "cache")));
    });
  });

  it("an explicit cacheDir override is carried verbatim", async () => {
    await withScratch(async (scratchRoot) => {
      const cacheDir = join(scratchRoot, "custom-cache");
      await generateConfig(baseOptions(scratchRoot, { cacheDir }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain(JSON.stringify(cacheDir));
    });
  });
});

describe("C-005 generateConfig — deployment-origin-dependent fields (siteUrl)", () => {
  it("siteUrl given -> sitemap.hostname is set to it", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { siteUrl: "https://example.test" }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/sitemap/);
      expect(config).toContain("https://example.test");
    });
  });

  it("siteUrl absent -> generateConfig still succeeds (degrades, never fails the build)", async () => {
    await withScratch(async (scratchRoot) => {
      await expect(generateConfig(baseOptions(scratchRoot))).resolves.not.toThrow();
      const { config } = await readGenerated(scratchRoot);
      expect(config).not.toMatch(/sitemap/);
    });
  });
});

/*
 * C-005/C-008 themeConfig — the injection channel every consumer-config
 * value the theme needs travels through, baked as static JSON at generate
 * time (config_gen.ts's own doc "Injection channel" section). These
 * REPLACE the earlier smoke-level ("resolves.not.toThrow()") coverage for
 * nav/descLookup with structural assertions against the actual
 * baked values.
 */
/** Extracts and JSON-unescapes the string value of a `"<key>": "..."` JSON
 * field from generated config text — used to prove a hostile payload
 * round-trips as inert DATA, not as live code, regardless of what
 * characters it contains. */
function extractJsonStringField(text: string, key: string): string {
  const match = text.match(new RegExp(`"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) throw new Error(`field "${key}" not found in generated config`);
  return JSON.parse(`"${match[1]}"`) as string;
}

describe("C-005/C-008 generateConfig — themeConfig static-JSON injection", () => {
  it("bakes brand into themeConfig.brand", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(
        baseOptions(scratchRoot, { brand: { title: "My Catalog", wordmark: "my.catalog.example" } }),
      );
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('"title": "My Catalog"');
      expect(config).toContain('"wordmark": "my.catalog.example"');
    });
  });

  it("brand.wordmark absent -> no wordmark key at all (SiteHeader.vue owns the `?? title` fallback)", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).not.toContain('"wordmark"');
    });
  });

  it("brandLogoSource -> the file is copied into the public mount and baked as its site-root href", async () => {
    await withScratch(async (scratchRoot) => {
      const source = join(scratchRoot, "acme-logo.svg");
      await writeFile(source, LOGO_BYTES, "utf8");
      // The raw `brand.logo` config value (a config-relative PATH) must never
      // be what the theme sees — only the href of the copy.
      await generateConfig(
        baseOptions(scratchRoot, {
          brand: { title: "My Catalog", logo: "assets/acme-logo.svg" },
          brandLogoSource: source,
        }),
      );
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('"logo": "/acme-logo.svg"');
      expect(config).not.toContain("assets/acme-logo.svg");
      expect(await readFile(join(scratchRoot, SRC_DIR, "public", "acme-logo.svg"), "utf8")).toBe(LOGO_BYTES);
    });
  });

  it("brandLogoSource absent -> no logo key, nothing copied", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { brand: { title: "My Catalog", logo: "assets/x.svg" } }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).not.toContain('"logo"');
      await expect(readdir(join(scratchRoot, SRC_DIR, "public"))).rejects.toThrow();
    });
  });

  it("a logo copy lands in the same public mount synthesizePages already wrote, overwriting a same-named asset", async () => {
    await withScratch(async (scratchRoot) => {
      const publicDirSource = await writePublicDirFixture(scratchRoot);
      const source = join(scratchRoot, "favicon.svg");
      await writeFile(source, LOGO_BYTES, "utf8");
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["standalone"])], publicDirSource });
      await generateConfig(baseOptions(scratchRoot, { brandLogoSource: source }));
      // The publicDir fixture ships its own favicon.svg; the explicitly
      // configured logo is copied after it, so the logo wins.
      expect(await readFile(join(scratchRoot, SRC_DIR, "public", "favicon.svg"), "utf8")).toBe(LOGO_BYTES);
    });
  });

  it("bakes a non-empty nav[] into themeConfig.nav", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { nav: [{ text: "Docs", link: "/docs/" }] }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('"text": "Docs"');
      expect(config).toContain('"link": "/docs/"');
    });
  });

  it("footer absent -> themeConfig.footer bakes to the literal undefined, no key survives dropped", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/footer:\s*undefined,/);
    });
  });

  it("bakes a configured footer.links[] into themeConfig.footer", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { footer: { links: [{ text: "Status", link: "/status" }] } }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/footer:\s*\{/);
      expect(config).toContain('"text": "Status"');
      expect(config).toContain('"link": "/status"');
    });
  });

  it("docsNav absent -> themeConfig.docsNav bakes to the literal undefined", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/docsNav:\s*undefined,/);
    });
  });

  it("bakes a configured docsNav[] into themeConfig.docsNav", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { docsNav: [{ text: "Setup", link: "/docs/setup/" }] }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/docsNav:\s*\[/);
      expect(config).toContain('"text": "Setup"');
      expect(config).toContain('"link": "/docs/setup/"');
    });
  });

  it("themeConfig.docsPresent is false when no docs were mounted", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["standalone"])] });
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('docsPresent: false');
    });
  });

  it("themeConfig.docsPresent is true once synthesizePages mounted a docs dir", async () => {
    await withScratch(async (scratchRoot) => {
      const docsSourceDir = await writeDocsFixture(scratchRoot);
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])], docsSourceDir });
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('docsPresent: true');
    });
  });

  it("bakes descLookup's per-package result into themeConfig.descLookup, keyed by full logical name", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({
        scratchRoot,
        srcDir: SRC_DIR,
        packages: [route(["kitware", "cmake"]), route(["standalone"])],
      });
      const descLookup = (segments: readonly string[]) =>
        segments.join("/") === "kitware/cmake"
          ? { title: "CMake", description: "Cross-platform build system generator." }
          : null;
      await generateConfig(baseOptions(scratchRoot, { descLookup }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('"kitware/cmake"');
      expect(config).toContain('"title": "CMake"');
      // The null result (standalone) never appears as a baked entry.
      expect(config).not.toContain('"standalone":');
    });
  });

  it("descLookup unset -> themeConfig.descLookup bakes to an empty table, never throws", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["standalone"])] });
      await expect(generateConfig(baseOptions(scratchRoot))).resolves.not.toThrow();
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/DESC_LOOKUP = \{\}/);
    });
  });

  it("descLookup given but called before any package was synthesized -> empty table, never throws", async () => {
    await withScratch(async (scratchRoot) => {
      const descLookup = () => ({ title: "CMake", description: "Cross-platform build system generator." });
      await expect(generateConfig(baseOptions(scratchRoot, { descLookup }))).resolves.not.toThrow();
      const { config } = await readGenerated(scratchRoot);
      expect(config).toMatch(/DESC_LOOKUP = \{\}/);
    });
  });

  it("accepts a css path — the theme shim imports it, after the theme's own default import", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { css: "/tmp/does-not-need-to-exist-for-this-check.css" }));
      const { shim } = await readGenerated(scratchRoot);
      const themeImportIdx = shim.indexOf("@ocx-sh/catalog/theme");
      const cssImportIdx = shim.indexOf("does-not-need-to-exist-for-this-check.css");
      expect(themeImportIdx).toBeGreaterThan(-1);
      expect(cssImportIdx).toBeGreaterThan(themeImportIdx);
    });
  });

  it("css absent -> the theme shim never emits a second import line", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { shim } = await readGenerated(scratchRoot);
      expect(shim.trim().split("\n")).toHaveLength(2);
    });
  });

  // Pins JSON.stringify escaping against a future regression to
  // template-literal splicing (e.g. `brand: {title: \`${...}\`}`), which
  // WOULD let a value like this execute instead of staying inert data.
  it("brand/nav values containing a quote, a backtick, and ${...} round-trip as inert data", async () => {
    await withScratch(async (scratchRoot) => {
      const hostile = 'He said "hi", used a `backtick`, and ${globalThis.PWNED = true} inline.';
      await generateConfig(
        baseOptions(scratchRoot, {
          brand: { title: hostile },
          nav: [{ text: hostile, link: "/x" }],
        }),
      );
      const { config } = await readGenerated(scratchRoot);
      expect(extractJsonStringField(config, "title")).toBe(hostile);
      expect(extractJsonStringField(config, "text")).toBe(hostile);
    });
  });
});

describe("C-302 generateConfig — dead descLookup themeConfig entry removed", () => {
  it("themeConfig carries no descLookup key at all, even when descLookup resolves real package metadata", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
      const descLookup = () => ({ title: "CMake", description: "Cross-platform build system generator." });
      await generateConfig(baseOptions(scratchRoot, { descLookup }));
      const { config } = await readGenerated(scratchRoot);
      // The module-level DESC_LOOKUP const (transformHead/transformPageData's
      // own lookup table) still carries the baked data — only the
      // themeConfig.descLookup PROJECTION of it is gone.
      expect(config).toContain('"title": "CMake"');
      expect(config).not.toMatch(/descLookup:\s*DESC_LOOKUP/);
      expect(config).not.toContain("themeConfig.descLookup");
    });
  });
});

describe("C-301 generateConfig — site-wide og:image/twitter:image from the brand logo", () => {
  it("logo configured, no siteUrl -> both metas use the site-root-relative href", async () => {
    await withScratch(async (scratchRoot) => {
      const source = join(scratchRoot, "acme-logo.svg");
      await writeFile(source, LOGO_BYTES, "utf8");
      await generateConfig(baseOptions(scratchRoot, { brandLogoSource: source }));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('["meta", {"property":"og:image","content":"/acme-logo.svg"}]');
      expect(config).toContain('["meta", {"name":"twitter:image","content":"/acme-logo.svg"}]');
    });
  });

  it("logo configured WITH siteUrl -> both metas use the absolute URL", async () => {
    await withScratch(async (scratchRoot) => {
      const source = join(scratchRoot, "acme-logo.svg");
      await writeFile(source, LOGO_BYTES, "utf8");
      await generateConfig(
        baseOptions(scratchRoot, { brandLogoSource: source, siteUrl: "https://mirror.example.test" }),
      );
      const { config } = await readGenerated(scratchRoot);
      const absolute = "https://mirror.example.test/acme-logo.svg";
      expect(config).toContain(`["meta", {"property":"og:image","content":${JSON.stringify(absolute)}}]`);
      expect(config).toContain(`["meta", {"name":"twitter:image","content":${JSON.stringify(absolute)}}]`);
    });
  });

  it("no logo configured -> neither meta is emitted", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).not.toContain("og:image");
      expect(config).not.toContain("twitter:image");
    });
  });
});

describe("C-301 generateConfig — color-scheme meta, unconditional", () => {
  it("always emits a light-dark color-scheme meta, regardless of brand/siteUrl", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot));
      const { config } = await readGenerated(scratchRoot);
      expect(config).toContain('["meta", { name: "color-scheme", content: "light dark" }]');
    });
  });
});

describe("C-303 generateConfig — robots.txt emission", () => {
  const robotsPath = (scratchRoot: string) => join(scratchRoot, SRC_DIR, "public", "robots.txt");

  it("siteUrl given -> robots.txt is written to the public mount with a Sitemap: line", async () => {
    await withScratch(async (scratchRoot) => {
      await generateConfig(baseOptions(scratchRoot, { siteUrl: "https://mirror.example.test" }));
      const robots = await readFile(robotsPath(scratchRoot), "utf8");
      expect(robots).toContain("User-agent: *");
      expect(robots).toContain("Sitemap: https://mirror.example.test/sitemap.xml");
    });
  });

  it("siteUrl absent -> no robots.txt is written, generateConfig still succeeds", async () => {
    await withScratch(async (scratchRoot) => {
      await expect(generateConfig(baseOptions(scratchRoot))).resolves.not.toThrow();
      await expect(readFile(robotsPath(scratchRoot), "utf8")).rejects.toThrow();
    });
  });

  it("a non-EEXIST failure writing robots.txt propagates, never silently swallowed", async () => {
    await withScratch(async (scratchRoot) => {
      const publicDir = join(scratchRoot, SRC_DIR, "public");
      await mkdir(publicDir, { recursive: true });
      await chmod(publicDir, 0o500); // read+execute, no write -> EACCES creating robots.txt, not EEXIST
      try {
        await expect(
          generateConfig(baseOptions(scratchRoot, { siteUrl: "https://mirror.example.test" })),
        ).rejects.toThrow();
      } finally {
        await chmod(publicDir, 0o700); // restore so the scratch root's own dispose() can clean up
      }
    });
  });

  it("a publicDir-supplied robots.txt wins — this function never overwrites it", async () => {
    await withScratch(async (scratchRoot) => {
      const publicDirSource = join(scratchRoot, "consumer-public");
      await mkdir(publicDirSource, { recursive: true });
      const consumerRobots = "User-agent: *\nDisallow: /private\n";
      await writeFile(join(publicDirSource, "robots.txt"), consumerRobots, "utf8");

      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [], publicDirSource });
      await generateConfig(baseOptions(scratchRoot, { siteUrl: "https://mirror.example.test" }));

      expect(await readFile(robotsPath(scratchRoot), "utf8")).toBe(consumerRobots);
    });
  });
});
