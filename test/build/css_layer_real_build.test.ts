import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vitepress";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { generateConfig } from "../../src/build/config_gen.js";
import { linkNodeModules } from "./helpers.js";

/*
 * `quality-css-overrides.md`'s evidence gate: "@layer survives the build".
 *
 * The source-level check (`test/theme/layer_contract.test.ts`) proves every
 * style block is wrapped. It cannot prove the wrapper survives Vite, esbuild
 * minification and CSS chunk concatenation — and if it did not, every consumer
 * override would silently stop working while the site still rendered fine.
 *
 * This must be a REAL build. happy-dom drops `@layer` blocks at parse time and
 * jsdom parses them but never applies layered declarations, so a cascade-layer
 * assertion in either engine passes whether or not the mechanism works. There
 * is no cheaper honest version of this check.
 *
 * Note on `@layer a, b;` ordering statements: the production minifier drops one
 * when block order already implies the same precedence, which is correct CSS
 * per Vite's maintainers. This theme uses ONE flat layer specifically so no
 * ordering statement is load-bearing.
 */

const SRC_DIR = "src";

function route(segments: readonly string[]): PackageRoute {
  return { segments, wireBase: "" };
}

/** Every stylesheet the built page links, concatenated in document order. */
async function builtCss(outDir: string, page: string): Promise<string> {
  const html = await readFile(join(outDir, page), "utf8");
  const hrefs: string[] = [];
  const re = /<link[^>]*rel=["'][^"']*\bstylesheet\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/g;
  for (const m of html.matchAll(re)) hrefs.push(m[1]);
  expect(hrefs.length).toBeGreaterThan(0);
  const chunks = await Promise.all(hrefs.map((h) => readFile(join(outDir, h.replace(/^\//, "")), "utf8")));
  return chunks.join("\n");
}

/** The `@layer ocx{…}` body and everything outside it, by brace depth. */
function splitLayer(css: string): { layered: string; unlayered: string } {
  const start = css.indexOf("@layer ocx{");
  expect(start, "no @layer ocx in the built CSS").toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, "unbalanced @layer ocx in the built CSS").toBeGreaterThan(-1);
  return { layered: css.slice(start, end), unlayered: css.slice(0, start) + css.slice(end + 1) };
}

describe("@layer ocx survives a real production build", () => {
  it(
    "wraps the theme's scoped rules and leaves the reduced-motion lock inside",
    async () => {
      const root = await createScratchRoot();
      try {
        await linkNodeModules(root.path);
        await synthesizePages({ scratchRoot: root.path, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
        await generateConfig({
          scratchRoot: root.path,
          srcDir: SRC_DIR,
          brand: { title: "Layer Contract" },
          nav: [],
        });

        const outDir = join(root.path, "layer-out");
        await build(root.path, { outDir });
        const css = await builtCss(outDir, join("kitware", "cmake.html"));
        const { layered, unlayered } = splitLayer(css);

        // The theme's own rules, including the scoped `[data-v-…]` selectors
        // that are the whole reason the layer exists, must be INSIDE it.
        expect(layered).toMatch(/\[data-v-[0-9a-f]+\]/);
        expect(layered).toContain(".package-card");

        // The accessibility lock is deliberately unbeatable, so it belongs
        // inside the layer where `!important` outranks a consumer's own.
        expect(layered).toContain("prefers-reduced-motion");

        // The Shiki fence background is deliberately OUTSIDE: layered, its
        // `!important` would beat a consumer's `!important` permanently, and
        // it is not an accessibility lock.
        expect(unlayered).toMatch(/shiki[^}]*background[^}]*important/);
        expect(layered).not.toMatch(/shiki\)\{background:[^}]*important/);
      } finally {
        await root.dispose();
      }
    },
    60_000,
  );
});
