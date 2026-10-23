/**
 * Head and SEO (C-022, S-015), asserted on built sites: per-page title,
 * description and OpenGraph tags; canonical, `og:url` and an absolute
 * `og:image` only with a `siteUrl`; the favicon, the site-wide logo image and
 * the consumer stylesheet. Ports the head half of `seo_real_build`.
 *
 * Not ported here: the detail page's own `<title>` segment and its wire-root
 * `preload` link (they follow the detail view, P-detail T.4), and
 * `robots.txt`/`sitemap` (C-004, `layout.test.ts`).
 *
 * Needs `root` (base `/`) and `catalog` (base `/catalog/`), both with a
 * `siteUrl`; two own builds cover the `siteUrl`-less and logo cases.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, FIXTURE_DIR, readHtml, runBuild, site, type Project } from "./helpers.js";

const meta = (doc: Document, key: string): string | null =>
  doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content") ?? null;
const canonical = (doc: Document): string | null => doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;

describe("C-022 head of the fixture sites (siteUrl set)", () => {
  it.each([
    { name: "root" as const, path: "/", url: "https://fixture.ocx.test/", site: "Site Fixture Catalog" },
    { name: "catalog" as const, path: "/", url: "https://fixture.ocx.test/catalog/", site: "ocx.sh" },
  ])("$name $path: canonical and og:url are the siteUrl joined with the page path; og:site_name is $site", async (c) => {
    const doc = await readHtml(site(c.name), c.path);

    expect(canonical(doc)).toBe(c.url);
    expect(meta(doc, "og:url")).toBe(c.url);
    expect(meta(doc, "og:site_name")).toBe(c.site);
    expect(meta(doc, "og:type")).toBe("website");
    expect(meta(doc, "twitter:card")).toBe("summary");
  });

  it("D-145 the <title> joins the site name with a pipe, and og:title with an em dash", async () => {
    const doc = await readHtml(site("root"), "/404.html");

    expect(doc.title).toBe("Page not found | Site Fixture Catalog");
    expect(meta(doc, "og:title")).toBe("Page not found — Site Fixture Catalog");
  });

  it("every page of the root fixture carries a non-empty description and a title ending in the site name", async () => {
    for (const path of ["/", "/docs/guide/getting-started/"]) {
      const doc = await readHtml(site("root"), path);
      expect(meta(doc, "description"), path).toBeTruthy();
      expect(doc.title.endsWith("Site Fixture Catalog"), path).toBe(true);
    }
  });

  it("D-146 a page with no description configured carries no description tag, the 404 page included", async () => {
    for (const path of ["/", "/404.html"]) {
      const doc = await readHtml(site("catalog"), path);
      expect(meta(doc, "description"), path).toBeNull();
      expect(meta(doc, "og:description"), path).toBeNull();
    }
  });

  it("D-146 a configured site description is the 404 page's description, as before the port", async () => {
    const doc = await readHtml(site("root"), "/404.html");

    expect(meta(doc, "description")).toBe("A committed fixture site for the ocx-catalog build tests.");
    expect(meta(doc, "og:description")).toBe(meta(doc, "description"));
  });

  it("D-147 the 404 page declares no canonical and no og:url, with or without a siteUrl", async () => {
    for (const name of ["root", "catalog"] as const) {
      const doc = await readHtml(site(name), "/404.html");
      expect(canonical(doc), name).toBeNull();
      expect(meta(doc, "og:url"), name).toBeNull();
    }
  });

  it("D-148 every page declares color-scheme light dark", async () => {
    for (const [name, path] of [
      ["root", "/"],
      ["root", "/404.html"],
      ["root", "/docs/guide/getting-started/"],
      ["catalog", "/"],
    ] as const) {
      const doc = await readHtml(site(name), path);
      expect(meta(doc, "color-scheme"), `${name} ${path}`).toBe("light dark");
    }
  });

  it("D-158 the favicon is the one base-joined icon link, the configured one", async () => {
    const root = await readHtml(site("root"), "/");
    expect([...root.querySelectorAll('link[rel="icon"]')].map((el) => el.getAttribute("href"))).toEqual(["/favicon.svg"]);
  });
});

describe("C-022 head of own builds", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  async function build(extra: Record<string, unknown>, files: Record<string, string>): Promise<string> {
    const project = await createProject(extra, files);
    projects.push(project);
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);
    return project.out;
  }

  const logo = () => readFile(join(FIXTURE_DIR, "../quality-index/brand/logo.svg"), "utf8");

  it("with a siteUrl and a brand logo: og:image and twitter:image are the absolute logo URL", async () => {
    const out = await build(
      { siteUrl: "https://mirror.example.test", brand: { title: "Mirror", logo: "./brand/logo.svg" } },
      { "brand/logo.svg": await logo() },
    );
    const doc = await readHtml(out, "/404.html");

    expect(meta(doc, "og:image")).toBe("https://mirror.example.test/logo.svg");
    expect(meta(doc, "twitter:image")).toBe("https://mirror.example.test/logo.svg");
    expect(canonical(doc)).toBeNull();
  });

  it("without a siteUrl: no canonical, no og:url; og:image is the base-joined logo path", async () => {
    const out = await build(
      { base: "/catalog/", brand: { title: "Mirror", logo: "./brand/logo.svg" }, favicon: "/logo.svg" },
      { "brand/logo.svg": await logo() },
    );
    const doc = await readHtml(out, "/404.html");

    expect(canonical(doc)).toBeNull();
    expect(meta(doc, "og:url")).toBeNull();
    expect(meta(doc, "og:image")).toBe("/catalog/logo.svg");
    expect(meta(doc, "twitter:image")).toBe("/catalog/logo.svg");
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/catalog/logo.svg");
  });

  /** The consumer fixture of the D-144 tests: a relative `@import`, a relative `url()` and a marker rule. */
  const consumerFiles = {
    "theme/site.css": '@import "./base.css";\n.consumer-marker { color: red; background: url("./dot.svg") }\n',
    "theme/base.css": ".imported-marker { margin: 0 }\n",
    "theme/dot.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><circle cx="2" cy="2" r="1"/></svg>',
  };

  /** Every `/_astro/*.css` sheet linked from the page, as `href -> text`. */
  async function astroSheets(out: string, doc: Document): Promise<Map<string, string>> {
    const hrefs = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")!);
    const sheets = new Map<string, string>();
    for (const href of hrefs.filter((href) => href.includes("/_astro/"))) {
      sheets.set(href, await readFile(join(out, href.replace(/^\/catalog\//, "")), "utf8"));
    }
    return sheets;
  }

  it("D-144 the consumer css is bundled: relative @import and url() resolved, minified, hashed, never copied by name", async () => {
    const out = await build({ base: "/catalog/", css: "./theme/site.css" }, consumerFiles);
    const doc = await readHtml(out, "/404.html");
    const sheets = [...(await astroSheets(out, doc))];
    const bundled = sheets.find(([, css]) => css.includes(".consumer-marker"));

    expect(await readdir(out)).not.toContain("site.css");
    expect(bundled, "the consumer rule is in a linked, hashed /_astro/ sheet").toBeDefined();
    const [href, css] = bundled!;
    expect(href).toMatch(/^\/catalog\/_astro\/[\w.-]+\.[\w-]{8}\.css$/);
    expect(css).toContain(".imported-marker{margin:0}");
    expect(css).not.toMatch(/@import|\.\/dot\.svg|\.\/base\.css/);
    expect(css).toMatch(/background:url\("(?:data:image\/svg\+xml|\/catalog\/_astro\/dot\.[\w-]+\.svg)/);
  });

  it("D-144 a configured css file that does not exist fails the build with exit 65 naming it", async () => {
    const project = await createProject({ css: "./theme/missing.css" }, {});
    projects.push(project);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("theme/missing.css");
  });

  it("consumer css wins whatever the link order: every rule of the theme's stylesheets sits in an @layer", async () => {
    // The consumer rule is bundled with the theme's sheets, in no fixed position. It does not need
    // one: an unlayered consumer rule beats any layered rule, so the consumer's marker must be the
    // only unlayered rule among the linked `/_astro/` sheets.
    const out = await build({ css: "./theme/site.css" }, consumerFiles);
    const doc = await readHtml(out, "/404.html");
    const sheets = await astroSheets(out, doc);

    expect(sheets.size).toBeGreaterThan(0);
    const unlayered = [...sheets.values()].flatMap(unlayeredStyleRules);
    expect(unlayered).toEqual([".imported-marker", ".consumer-marker"]);
  });

  it("the unlayered-rule scan is able to fail: it reports an unlayered rule and a wrapped one", () => {
    const css = "@layer a;\n@layer a { .x { color: red } }\n/* .c {} */ @font-face { font-family: f; src: url(f.woff2) }\n.y { color: blue }\n@media (min-width: 1px) { .z { color: blue } }";

    expect(unlayeredStyleRules(css)).toEqual([".y", "@media (min-width: 1px)"]);
  });
});

/** Preludes of the top-level style rules (and `@media`/`@supports`/`@container` wrappers) outside any `@layer`. */
function unlayeredStyleRules(css: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let prelude = "";
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      if (depth === 0) {
        const text = prelude.trim();
        if (!/^@(layer|font-face|keyframes|property)\b/.test(text)) found.push(text);
        prelude = "";
      }
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (depth === 0) {
      prelude = char === ";" ? "" : prelude + char;
    }
  }
  return found;
}
