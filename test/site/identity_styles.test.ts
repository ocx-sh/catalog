// The detail page's identity logo (D-037): a logo that fails to load keeps its box, so the title, description
// and everything after it do not move. The probe (`scripts/quality-budget.mjs`, images blocked) measures it in
// Chrome; this pins the rule in the template, which neither `tsc` nor the coverage gate reads.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("../../src/site/components/IdentityBlock.astro", import.meta.url), "utf8");
const style = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const RULE = /\[data-identity\] \.ocx-logo-tile\[data-state="fallback"\] \.ocx-logo-tile__image\[hidden\]\s*\{([^}]*)\}/;

describe("the identity logo keeps its box when it fails (D-037)", () => {
  test("D-037 a failed logo is display:block and visibility:hidden over the monogram, not display:none", () => {
    const rule = RULE.exec(style)?.[1] ?? "";
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/visibility:\s*hidden/);
  });

  test("D-037 the rule is global and in the theme's layer, so it outranks the theme's [hidden] rule on the child component's image", () => {
    const global = /<style is:global>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "";
    expect(global).toMatch(/@layer ocx\s*\{[\s\S]*\[data-identity\]/);
  });

  test("D-037 the check can fail: a rule that removes the image from layout is not the rule", () => {
    expect(RULE.exec('[data-identity] .ocx-logo-tile[data-state="fallback"] .ocx-logo-tile__image[hidden] { display: none; }')?.[1]).not.toMatch(/visibility:\s*hidden/);
    expect(RULE.exec(".identity { gap: 1px; }")).toBeNull();
  });
});
