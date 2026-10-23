import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// `.astro` templates are outside coverage and `tsc`; the README card's layout is
// pinned here against the template's own `<style>` block.
const PANE = readFileSync(fileURLToPath(new URL("../../../src/site/components/ReadmePane.astro", import.meta.url)), "utf8");

const styleOf = (source: string): string => /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "";

/** The declarations of the first rule whose selector contains `selector`, or `null`. */
function declarationsOf(css: string, selector: string): string | null {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.includes(selector)) return body;
  }
  return null;
}

describe("D-086 the first README block sits flush to the card top", () => {
  test("D-086 the first child loses its top margin; a leading heading also loses its rule and padding", () => {
    const css = styleOf(PANE);
    expect(declarationsOf(css, ".readme-content > :global(:first-child)")).toMatch(/margin-block-start:\s*0/);
    const heading = declarationsOf(css, ":global(:is(h1, h2, h3, h4):first-child)");
    expect(heading).toMatch(/padding-block-start:\s*0/);
    expect(heading).toMatch(/border-block-start:\s*0/);
  });

  test("D-086 the check can fail: the real style block minus the reset reports none", () => {
    const mutated = styleOf(PANE.replaceAll(":first-child", ":last-child"));
    expect(declarationsOf(mutated, ".readme-content > :global(:first-child)")).toBeNull();
    expect(declarationsOf(mutated, ":global(:is(h1, h2, h3, h4):first-child)")).toBeNull();
  });
});

describe("D-087 README images render at natural size", () => {
  test("D-087 an image only shrinks to fit; no rule forces a fixed box on a lone image", () => {
    const css = styleOf(PANE);
    expect(declarationsOf(css, ".readme-content :global(img)")).toMatch(/max-inline-size:\s*100%[\s\S]*block-size:\s*auto/);
    expect(css).not.toMatch(/aspect-ratio|object-fit|only-child/);
  });

  test("D-087 the check can fail: the real template plus the old letterbox rule is caught", () => {
    const old = ".readme-content :global(p > img:only-child) { display: block; aspect-ratio: 16 / 9; }";
    const mutated = styleOf(PANE.replace("</style>", `${old}\n</style>`));
    expect(mutated).toMatch(/aspect-ratio|object-fit|only-child/);
  });
});
