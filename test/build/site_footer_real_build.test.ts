import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig } from "../../src/build/config_gen.js";
import { linkNodeModules, withTempDir } from "./helpers.js";

/*
 * WP-1 (C-602 follow-up) — a real end-to-end build proving `themeConfig.footer`
 * actually reaches `SiteFooter.vue`'s real `useData()` read at runtime, not
 * just that `generateConfig()` writes the right TEXT (`config_gen.test.ts`
 * already covers that) or that the component reads a hand-mocked theme
 * object (`public_org_links_wiring.test.ts` already covers that too). This
 * is the third leg: config -> generated file -> real vitepress build() ->
 * real rendered HTML — the same posture `site_header_real_build.test.ts`
 * already uses for `nav[]`/`docsNav[]`. Without it, a `footer` baked into
 * `themeConfig` with zero real component actually reading it back would be
 * fully covered and fully invisible to every other gate — this repo has
 * shipped exactly that failure mode before (`themeConfig.brand`, pre-WP6).
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

/** Extracts the `<span class="footer-links">...</span>` block from a
 * rendered page's HTML — every page carries one (`Layout.vue`: `SiteFooter`
 * always renders, same as `SiteHeader`). */
function footerLinksBlock(html: string): string {
  const match = html.match(/<span class="footer-links"[^>]*>[\s\S]*?<\/span>/);
  if (!match) throw new Error('no <span class="footer-links"> block found in rendered HTML');
  return match[0];
}

describe("WP-1 SiteFooter real build — footer.links[] wiring", () => {
  it(
    "footer absent -> the rendered footer shows only the catalog json link, no link[] anchors",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        await synthesizePages({ scratchRoot: root.path, srcDir: SRC_DIR, packages: [route(["standalone"])] });
        await generateConfig({ scratchRoot: root.path, srcDir: SRC_DIR, brand: { title: "Footer Absent Test" }, nav: [] });

        await withTempDir("catalog-footer-absent-out-", async (outDir) => {
          await build(root.path, { outDir });
          const html = await readFile(join(outDir, "standalone.html"), "utf8");
          const footer = footerLinksBlock(html);
          expect(footer).toContain("catalog json");
          expect(footer).not.toContain("<a href=\"/status\"");
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );

  it(
    "a configured footer.links[] entry renders in the real footer, alongside the catalog json link, with the external affordance for an absolute link",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        await synthesizePages({ scratchRoot: root.path, srcDir: SRC_DIR, packages: [route(["standalone"])] });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Footer Links Test" },
          nav: [],
          footer: { links: [{ text: "Status", link: "https://status.example.com" }] },
        });

        await withTempDir("catalog-footer-links-out-", async (outDir) => {
          await build(root.path, { outDir });
          const html = await readFile(join(outDir, "standalone.html"), "utf8");
          const footer = footerLinksBlock(html);

          expect(footer).toContain("catalog json");
          const linkIdx = footer.indexOf('href="https://status.example.com"');
          expect(linkIdx).toBeGreaterThan(-1);
          const anchor = footer.slice(linkIdx, footer.indexOf("</a>", linkIdx));
          expect(anchor).toContain("Status");
          expect(anchor).toContain('target="_blank"');
          expect(anchor).toContain('rel="noopener noreferrer"');
        });
      } finally {
        await root.dispose();
      }
    },
    30_000,
  );
});
