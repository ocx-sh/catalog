import { describe, it, expect } from "vitest";
import { read } from "./css_contract_helpers.js";

/*
 * `quality-design-tokens.md`, Block-tier: "a colour token missing from `.dark`
 * without an allowlist entry."
 *
 * A `:root`-only declaration is mode-agnostic — it applies in dark mode too,
 * silently pinning that token to its light value. This is the same trap
 * consumers fall into, and the theme must not model it.
 *
 * Two legitimate exceptions:
 *
 * - An ALIAS (`--ocx-color-code-keyword: var(--ocx-color-keyword)`) inherits
 *   its source's swap. Declaring it twice would be duplication, not safety.
 * - A small allowlist of tokens that genuinely read correctly over either
 *   scheme, each with a stated reason.
 */

/** Colour tokens deliberately declared once. Each needs a reason. */
const ALLOWLIST: Readonly<Record<string, string>> = {
  "--ocx-color-overlay": "one dim scrim that reads correctly over either scheme",
};

function blockBody(css: string, selector: string): string {
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
}

function declared(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--ocx-[a-z0-9-]+)\s*:\s*([^;]+);/gm)) out.set(m[1], m[2].trim());
  return out;
}

const isAlias = (value: string): boolean => /^var\(--ocx-[a-z0-9-]+\)$/.test(value);

export function findParityGaps(css: string): string[] {
  const light = declared(blockBody(css, ":root"));
  const dark = declared(blockBody(css, ".dark"));
  const gaps: string[] = [];
  for (const [name, value] of light) {
    if (!name.startsWith("--ocx-color-")) continue;
    if (dark.has(name) || isAlias(value) || name in ALLOWLIST) continue;
    gaps.push(name);
  }
  return gaps;
}

describe("colour tokens declare a dark value", () => {
  const palette = read("src/theme/styles/tokens/palette.css");

  it("reports a literal colour token that has no .dark entry", () => {
    // RED. Deleting a real `.dark` line would mean shipping a broken palette,
    // so the gap is demonstrated on a fixture instead.
    const broken = `
      :root {
        --ocx-color-bg: #fff;
        --ocx-color-fg: #000;
      }
      .dark {
        --ocx-color-bg: #000;
      }`;
    expect(findParityGaps(broken)).toEqual(["--ocx-color-fg"]);
  });

  it("accepts an alias, which inherits its source's swap", () => {
    const aliased = `
      :root {
        --ocx-color-bg: #fff;
        --ocx-color-code-bg: var(--ocx-color-bg);
      }
      .dark {
        --ocx-color-bg: #000;
      }`;
    expect(findParityGaps(aliased)).toEqual([]);
  });

  it("finds no gap in the shipped palette", () => {
    expect(findParityGaps(palette)).toEqual([]);
  });

  it("keeps every allowlist entry real", () => {
    // An allowlist that names a token which no longer exists is a rule nobody
    // is enforcing any more.
    const light = declared(blockBody(palette, ":root"));
    for (const name of Object.keys(ALLOWLIST)) {
      expect(light.has(name), `${name} is allowlisted but not declared`).toBe(true);
    }
  });
});
