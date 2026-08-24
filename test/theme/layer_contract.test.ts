import { describe, it, expect } from "vitest";
import { collectFiles, read, stripNoise, lineOf, layerRanges, TOKEN_DIR } from "./css_contract_helpers.js";

/*
 * `quality-css-overrides.md` §1. Two source-level invariants behind the
 * cascade-layer contract.
 *
 * 1. Every `<style>` block and every stylesheet wraps its rules in
 *    `@layer ocx`. An unwrapped block outranks a consumer's stylesheet
 *    silently — the rules still apply, they just cannot be overridden, and
 *    nothing about the rendered page looks wrong.
 *
 * 2. No `!important` inside the layer, except an accessibility lock. Layer
 *    order REVERSES for `!important`, so a layered `!important` beats a
 *    consumer's own `!important` and locks them out with no escape at all.
 *    That is the one thing in this contract a consumer cannot work around, so
 *    it is deliberate or it is a bug.
 *
 * Whether the layer survives the real production build is a different
 * question, answered by `test/build/css_layer_real_build.test.ts`.
 */

/** A comment on the same rule or just above it, marking a deliberate lock. */
const A11Y_MARKERS = /prefers-reduced-motion|accessibility lock/;

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g;

export function findUnwrapped(file: string, source: string): string[] {
  const problems: string[] = [];
  const check = (body: string, label: string): void => {
    // A block with no declarations at all (whitespace/comments only) has
    // nothing to wrap.
    if (!/[a-z-]+\s*:/i.test(stripNoise(body))) return;
    if (!/@layer ocx\s*\{/.test(body)) problems.push(`${file}${label}: rules outside @layer ocx`);
  };
  if (file.endsWith(".vue")) {
    let i = 0;
    for (const m of source.matchAll(STYLE_BLOCK)) check(m[1], ` <style> #${++i}`);
  } else {
    check(source, "");
  }
  return problems;
}

export function findLayeredImportant(file: string, source: string): string[] {
  const clean = stripNoise(source);
  const out: string[] = [];
  for (const [start, end] of layerRanges(clean)) {
    const inside = clean.slice(start, end);
    for (const m of inside.matchAll(/!important/g)) {
      // Look back over the enclosing rule for a marker naming the exception.
      const context = source.slice(Math.max(0, start + m.index - 600), start + m.index);
      if (A11Y_MARKERS.test(context)) continue;
      out.push(`${file}:${lineOf(clean, start + m.index)}: !important inside @layer ocx`);
    }
  }
  return out;
}

const THEME_FILES = collectFiles("src/theme", /\.(vue|css)$/);

describe("cascade layer contract", () => {
  it("reports an unwrapped style block and an unjustified layered !important", () => {
    expect(findUnwrapped("fixture.vue", "<style scoped>\n.a { color: red; }\n</style>")).toEqual([
      "fixture.vue <style> #1: rules outside @layer ocx",
    ]);
    expect(findLayeredImportant("fixture.css", "@layer ocx {\n.a { color: red !important; }\n}")).toEqual([
      "fixture.css:2: !important inside @layer ocx",
    ]);
  });

  it("accepts a wrapped block and an accessibility-locked !important", () => {
    expect(findUnwrapped("fixture.vue", "<style scoped>\n@layer ocx {\n.a { color: red; }\n}\n</style>")).toEqual([]);
    const locked = `@layer ocx {
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; }
      }
    }`;
    expect(findLayeredImportant("fixture.css", locked)).toEqual([]);
  });

  it("ignores a style block that declares nothing", () => {
    expect(findUnwrapped("fixture.vue", "<style scoped>\n/* nothing yet */\n</style>")).toEqual([]);
  });

  it("every shipped style block is wrapped", () => {
    expect(THEME_FILES.flatMap((f) => findUnwrapped(f, read(f))).join("\n")).toBe("");
  });

  it("no shipped !important sits inside the layer unjustified", () => {
    expect(THEME_FILES.flatMap((f) => findLayeredImportant(f, read(f))).join("\n")).toBe("");
  });

  it("the token files are wrapped too, so a consumer can override a token by selector", () => {
    for (const f of collectFiles(TOKEN_DIR, /\.css$/)) {
      expect(read(f), `${f} is not wrapped`).toContain("@layer ocx {");
    }
  });
});
