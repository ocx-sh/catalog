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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, FIXTURE_DIR, readHtml, runBuild, site, type Project } from "./helpers.js";

const meta = (doc: Document, key: string): string | null =>
  doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content") ?? null;
const canonical = (doc: Document): string | null => doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;

describe("C-022 head of the fixture sites (siteUrl set)", () => {
  it.each([
    { name: "root" as const, path: "/", url: "https://fixture.ocx.test/", site: "Site Fixture Catalog" },
    { name: "root" as const, path: "/404.html", url: "https://fixture.ocx.test/404/", site: "Site Fixture Catalog" },
    { name: "catalog" as const, path: "/", url: "https://fixture.ocx.test/catalog/", site: "ocx.sh" },
    { name: "catalog" as const, path: "/404.html", url: "https://fixture.ocx.test/catalog/404/", site: "ocx.sh" },
  ])("$name $path: canonical and og:url are the siteUrl joined with the page path; og:site_name is $site", async (c) => {
    const doc = await readHtml(site(c.name), c.path);

    expect(canonical(doc)).toBe(c.url);
    expect(meta(doc, "og:url")).toBe(c.url);
    expect(meta(doc, "og:site_name")).toBe(c.site);
    expect(meta(doc, "og:type")).toBe("website");
    expect(meta(doc, "twitter:card")).toBe("summary");
  });

  it("the title, og:title, description and og:description of a page agree", async () => {
    const doc = await readHtml(site("root"), "/404.html");

    expect(doc.title).toBe("Page not found | Site Fixture Catalog");
    expect(meta(doc, "og:title")).toBe(doc.title);
    expect(meta(doc, "description")).toBe("The page you asked for does not exist.");
    expect(meta(doc, "og:description")).toBe(meta(doc, "description"));
  });

  it("every page carries a non-empty description and a title ending in the site name", async () => {
    for (const path of ["/", "/404.html", "/docs/guide/getting-started/"]) {
      const doc = await readHtml(site("root"), path);
      expect(meta(doc, "description"), path).toBeTruthy();
      expect(doc.title.endsWith("Site Fixture Catalog"), path).toBe(true);
    }
  });

  it("the favicon is a base-joined icon link with its MIME type", async () => {
    const root = await readHtml(site("root"), "/");
    expect(root.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.svg");
    expect(root.querySelector('link[rel="icon"]')?.getAttribute("type")).toBe("image/svg+xml");
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
    expect(canonical(doc)).toBe("https://mirror.example.test/404/");
  });

  it("without a siteUrl: no canonical, no og:url; og:image is the base-joined logo path; the css link is base-joined", async () => {
    const out = await build(
      {
        base: "/catalog/",
        brand: { title: "Mirror", logo: "./brand/logo.svg" },
        css: "./theme/site.css",
        favicon: "/logo.svg",
      },
      { "brand/logo.svg": await logo(), "theme/site.css": "body { color: red; }\n" },
    );
    const doc = await readHtml(out, "/404.html");

    expect(canonical(doc)).toBeNull();
    expect(meta(doc, "og:url")).toBeNull();
    expect(meta(doc, "og:image")).toBe("/catalog/logo.svg");
    expect(meta(doc, "twitter:image")).toBe("/catalog/logo.svg");
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/catalog/logo.svg");

    expect(await readFile(join(out, "site.css"), "utf8")).toBe("body { color: red; }\n");
    expect([...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"))).toContain("/catalog/site.css");
  });

  it("consumer css wins whatever the link order: every rule of the theme's stylesheets sits in an @layer", async () => {
    // Astro appends its bundled stylesheet links after the page's `head` slot, so
    // the consumer link is NOT last in the document. It does not need to be: an
    // unlayered consumer rule beats any layered rule, in either order.
    const out = await build({ css: "./site.css" }, { "site.css": "body { color: red; }\n" });
    const doc = await readHtml(out, "/404.html");
    const hrefs = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")!);
    const themeSheets = hrefs.filter((href) => href.startsWith("/_astro/"));

    expect(hrefs).toContain("/site.css");
    expect(themeSheets.length).toBeGreaterThan(0);
    for (const href of themeSheets) {
      expect(unlayeredStyleRules(await readFile(join(out, href), "utf8")), href).toEqual([]);
    }
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
