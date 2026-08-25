import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig } from "../../src/build/config_gen.js";
import { linkNodeModules, withTempDir, writeDocsFixture, writeNestedDocsFixture } from "./helpers.js";

/*
 * S-006 (docs mount + nav wiring, WP-10) — real end-to-end builds proving
 * `SiteHeader.vue` no longer hardcodes its nav: the docs link only appears
 * when `docsPresent` is true, and every `nav[]` entry from a consumer's
 * `catalog.config.json` renders, with the external-link affordance
 * (icon + `target="_blank" rel="noopener noreferrer"`) reserved for
 * absolute-URL entries — same convention VitePress's own DefaultTheme nav
 * uses. Same "no mocks, real vitepress build()" posture as
 * `engine_real_build.test.ts`/`css_order.test.ts`; see those files' own doc
 * comments for the shared "./theme" subpath-export caveat.
 */

const SRC_DIR = "src";

/** A root:true source's route: namespace/package read straight back off segments. */
function route(segments: readonly string[]): PackageRoute {
  return {
    segments,
    namespace: segments[0]!,
    package: segments.slice(1).join("/"),
    wireBase: "",
  };
}

/** Extracts the `<nav class="site-nav">...</nav>` block from a rendered
 * page's HTML — every page carries one (`Layout.vue`: "SiteHeader always
 * renders, including on the 404 page"). */
function siteNavBlock(html: string): string {
  // `[^>]*` tolerates the scoped-CSS `data-v-xxxxxxxx` attribute Vue's SFC
  // compiler appends after the literal `class="site-nav"` written in the
  // template — an implementation detail of `<style scoped>`, not part of
  // this test's contract.
  const match = html.match(/<nav class="site-nav"[^>]*>[\s\S]*?<\/nav>/);
  if (!match) throw new Error("no <nav class=\"site-nav\"> block found in rendered HTML");
  return match[0];
}

/** Finds the full opening `<a ...>` tag carrying `href="<href>"` inside a
 * `siteNavBlock()` result. Matches the WHOLE tag (same `<a\b[^>]*>` shape
 * S-007's identity test already uses below) rather than slicing from the
 * `href` attribute forward, so a `class`/`:class` attribute landing BEFORE
 * `href` in Vue's SSR-merged output (attribute order is an implementation
 * detail, not this test's contract) is never missed. */
function anchorTag(navBlock: string, href: string): string {
  const tag = [...navBlock.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`href="${href}"`));
  if (!tag) throw new Error(`no anchor with href="${href}" in nav block: ${navBlock}`);
  return tag;
}

/** The FULL `<a ...>...</a>` element (opening tag through its own closing
 * tag) for the anchor carrying `href="<href>"` — `anchorTag()` alone only
 * covers the opening tag, which has no visible text to assert a label
 * against. */
function fullAnchor(navBlock: string, href: string): string {
  const openTag = anchorTag(navBlock, href);
  const start = navBlock.indexOf(openTag);
  const end = navBlock.indexOf("</a>", start) + "</a>".length;
  return navBlock.slice(start, end);
}

describe("S-006 SiteHeader real build — docs presence + nav[] wiring", () => {
  it(
    "docs present (NESTED tree) -> pages render at /docs/** including the nested page, and the header shows the docs link plus nav[] entries (external affordance only for absolute links)",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        const docsSourceDir = await writeNestedDocsFixture(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["kitware", "cmake"])],
          docsSourceDir,
        });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Nav Wiring Test" },
          nav: [
            { text: "github", link: "https://github.com/ocx-sh/index" },
            { text: "changelog", link: "/changelog" },
          ],
        });

        await withTempDir("catalog-nav-out-", async (outDir) => {
          await build(root.path, { outDir });

          const [pkgExists, topLevelDocsExists, nestedDocsExists] = await Promise.all([
            stat(join(outDir, "kitware", "cmake.html")).then(() => true),
            stat(join(outDir, "docs", "guide.html")).then(() => true),
            stat(join(outDir, "docs", "guides", "sub.html")).then(() => true),
          ]);
          expect(pkgExists).toBe(true);
          expect(topLevelDocsExists).toBe(true);
          expect(nestedDocsExists).toBe(true);

          // Read the nested docs page itself — proves the header renders
          // identically deep inside the mounted docs tree, not just at its
          // top level.
          const html = await readFile(join(outDir, "docs", "guides", "sub.html"), "utf8");
          const nav = siteNavBlock(html);

          expect(nav).toContain('href="/docs/"');

          const githubIdx = nav.indexOf('href="https://github.com/ocx-sh/index"');
          expect(githubIdx).toBeGreaterThan(-1);
          const githubAnchor = nav.slice(githubIdx, nav.indexOf("</a>", githubIdx));
          expect(githubAnchor).toContain('target="_blank"');
          expect(githubAnchor).toContain('rel="noopener noreferrer"');
          expect(githubAnchor).toContain("<svg");

          const changelogIdx = nav.indexOf('href="/changelog"');
          expect(changelogIdx).toBeGreaterThan(-1);
          const changelogAnchor = nav.slice(changelogIdx, nav.indexOf("</a>", changelogIdx));
          expect(changelogAnchor).not.toContain("target=");
          expect(changelogAnchor).not.toContain("<svg");
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );

  it(
    "docs absent -> no /docs/** output at all, and no docs affordance in the header (nav[] entries still render)",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["kitware", "cmake"])],
          // No docsSourceDir.
        });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "No Docs Test" },
          nav: [{ text: "github", link: "https://github.com/ocx-sh/index" }],
        });

        await withTempDir("catalog-nav-no-docs-out-", async (outDir) => {
          await build(root.path, { outDir });

          await expect(stat(join(outDir, "docs"))).rejects.toThrow();

          const html = await readFile(join(outDir, "kitware", "cmake.html"), "utf8");
          const nav = siteNavBlock(html);
          expect(nav).not.toContain('href="/docs/"');
          expect(nav).not.toContain(">docs<");
          // nav[] entry unrelated to docs still renders.
          expect(nav).toContain('href="https://github.com/ocx-sh/index"');
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );

  it(
    "a config mirroring the index's own identity surface (docs + one external github nav entry) reproduces today's header exactly: catalog, docs, external github",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        const docsSourceDir = await writeDocsFixture(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["kitware", "cmake"])],
          docsSourceDir,
        });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "index.ocx.sh" },
          // S-007's identity surface: themeConfig.githubUrl =
          // https://github.com/ocx-sh/index, no other nav entries.
          nav: [{ text: "github", link: "https://github.com/ocx-sh/index" }],
        });

        await withTempDir("catalog-identity-out-", async (outDir) => {
          await build(root.path, { outDir });

          const html = await readFile(join(outDir, "kitware", "cmake.html"), "utf8");
          const nav = siteNavBlock(html);

          // Exactly three nav-link anchors, in order: catalog, docs, github —
          // the same three links the original site's hardcoded header
          // rendered before this WP. Attribute order within a tag is an
          // implementation detail (Vue SSR's merged `class`/static-attr
          // ordering), so each anchor tag is matched as a whole, then its
          // `href` pulled out independent of where it lands in the tag.
          const hrefs = [...nav.matchAll(/<a\b[^>]*>/g)].map((tag) => {
            const hrefMatch = tag[0].match(/href="([^"]+)"/);
            if (!hrefMatch) throw new Error(`anchor with no href in nav block: ${tag[0]}`);
            return hrefMatch[1];
          });
          expect(hrefs).toEqual(["/", "/docs/", "https://github.com/ocx-sh/index"]);

          const githubIdx = nav.indexOf('href="https://github.com/ocx-sh/index"');
          const githubAnchor = nav.slice(githubIdx, nav.indexOf("</a>", githubIdx));
          expect(githubAnchor).toContain('target="_blank"');
          expect(githubAnchor).toContain('rel="noopener noreferrer"');
          expect(githubAnchor).toContain("<svg");
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );
});

describe("WP-2 SiteHeader real build — docsNav[] labels/splits the docs entry", () => {
  it(
    "docsNav renames the auto docs entry's label -> the header shows the configured label, not 'docs'",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        const docsSourceDir = await writeDocsFixture(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["kitware", "cmake"])],
          docsSourceDir,
        });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Renamed Docs Label Test" },
          nav: [],
          docsNav: [{ text: "setup", link: "/docs/" }],
        });

        await withTempDir("catalog-docsnav-label-out-", async (outDir) => {
          await build(root.path, { outDir });

          const html = await readFile(join(outDir, "docs", "guide.html"), "utf8");
          const nav = siteNavBlock(html);

          expect(nav).not.toContain(">docs<");
          const anchor = fullAnchor(nav, "/docs/");
          expect(anchor).toContain(">setup</a>");
          // Visiting /docs/guide under the sole docsNav entry '/docs/' —
          // that entry's anchor still carries the active class.
          expect(anchor).toContain("active");
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );

  it(
    "multiple docsNav entries all render, and the longest matching prefix — not every matching one — gets the active class",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        const docsSourceDir = await writeNestedDocsFixture(root.path);

        await synthesizePages({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          packages: [route(["kitware", "cmake"])],
          docsSourceDir,
        });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Multiple docsNav Test" },
          nav: [],
          docsNav: [
            { text: "guide", link: "/docs/guide" },
            { text: "guides", link: "/docs/guides/" },
          ],
        });

        await withTempDir("catalog-docsnav-multi-out-", async (outDir) => {
          await build(root.path, { outDir });

          // /docs/guides/sub starts with BOTH '/docs/guide' and
          // '/docs/guides/' — only the longer, more specific one ('guides')
          // may carry the active class.
          const html = await readFile(join(outDir, "docs", "guides", "sub.html"), "utf8");
          const nav = siteNavBlock(html);

          const guideAnchor = fullAnchor(nav, "/docs/guide");
          const guidesAnchor = fullAnchor(nav, "/docs/guides/");
          expect(guideAnchor).toContain(">guide<");
          expect(guidesAnchor).toContain(">guides<");
          expect(guideAnchor).not.toContain("active");
          expect(guidesAnchor).toContain("active");
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );
});
