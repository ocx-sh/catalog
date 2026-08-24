import { describe, it, expect } from "vitest";
import { read } from "./css_contract_helpers.js";

/*
 * The monogram hues moved out of `utils/monogram.ts` (16 hardcoded literals
 * applied as inline styles, unreachable from a consumer stylesheet) into
 * `--ocx-color-monogram-{0..3}` in palette.css, applied by an `.mg-<index>`
 * class.
 *
 * That move is only correct if every value survived byte-for-byte AND the
 * index mapping did not shift. A wrong hue renders a *different but still
 * plausible* colour — it looks fine, so no reviewer catches it and no
 * rendering test notices. This pins all 16 against the values the arrays held.
 *
 * Tokens are indexed 0-3 rather than 1-4 precisely so there is no arithmetic
 * between `monogramHue()`'s return value and the token name for an off-by-one
 * to hide in.
 */

const LIGHT: ReadonlyArray<readonly [string, string]> = [
  ["#d84a34", "rgba(255, 96, 71, 0.1)"],
  ["#0a7652", "rgba(14, 159, 110, 0.1)"],
  ["#6f5bd0", "rgba(111, 91, 208, 0.1)"],
  ["#9a6b13", "rgba(250, 184, 51, 0.16)"],
];

const DARK: ReadonlyArray<readonly [string, string]> = [
  ["#ff8570", "rgba(255, 96, 71, 0.14)"],
  ["#3edea6", "rgba(62, 222, 166, 0.12)"],
  ["#c0b3ff", "rgba(192, 179, 255, 0.12)"],
  ["#fab833", "rgba(250, 184, 51, 0.12)"],
];

/** The `:root { … }` and `.dark { … }` bodies, by brace depth. */
function blocks(css: string): { root: string; dark: string } {
  const body = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`no ${selector} block`);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) return css.slice(start, i);
      }
    }
    throw new Error(`unbalanced ${selector} block`);
  };
  return { root: body(":root"), dark: body(".dark") };
}

describe("monogram hue tokens", () => {
  const { root, dark } = blocks(read("src/theme/styles/tokens/palette.css"));

  it.each([0, 1, 2, 3])("light hue %i keeps its original fg and tint", (i) => {
    const [fg, tint] = LIGHT[i];
    expect(root).toContain(`--ocx-color-monogram-${i}: ${fg};`);
    expect(root).toContain(`--ocx-color-monogram-${i}-tint: ${tint};`);
  });

  it.each([0, 1, 2, 3])("dark hue %i keeps its original fg and tint", (i) => {
    const [fg, tint] = DARK[i];
    expect(dark).toContain(`--ocx-color-monogram-${i}: ${fg};`);
    expect(dark).toContain(`--ocx-color-monogram-${i}-tint: ${tint};`);
  });

  it("no longer carries any colour in utils/monogram.ts", () => {
    // The module must stay pure index arithmetic. A colour reappearing here
    // means an inline style came back, which is unreachable for a consumer.
    const source = read("src/theme/utils/monogram.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
    expect(source).not.toContain("MONOGRAM_HUES");
  });
});
