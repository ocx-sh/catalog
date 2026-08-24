import { describe, it, expect } from "vitest";
import { collectFiles, read, stripNoise, lineOf, TOKEN_DIR } from "./css_contract_helpers.js";

/*
 * `quality-design-tokens.md`, Block-tier: "a hardcoded colour anywhere outside
 * styles/tokens/*.css".
 *
 * A colour that is not a token is a colour a corporate mirror can never
 * rebrand — the `css` field in catalog.config.json cannot reach a hex baked
 * into a .ts constant, an inline style, or a string in generated config. That
 * makes an untokenized colour a defect, not a style choice.
 *
 * Scope deliberately includes `src/build/config_gen.ts`: it bakes the Shiki
 * syntax theme into the generated VitePress config as literal source text, and
 * that used to carry 18 hex values no consumer stylesheet could touch.
 */

/** Named CSS colours worth banning. Not exhaustive — the 148 CSS names are not
 *  worth enumerating; these are the ones a developer actually reaches for. */
const NAMED = [
  "white", "black", "red", "green", "blue", "yellow", "orange", "purple",
  "coral", "teal", "navy", "gray", "grey", "pink", "brown", "silver", "gold",
  "cyan", "magenta", "lime", "olive", "maroon", "aqua", "fuchsia",
];

/** CSS-wide keywords and non-colour values that are never a themeable colour. */
const ALLOWED_KEYWORDS = /^(transparent|currentColor|inherit|initial|unset|revert|none|auto)$/i;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function findLiteralColors(file: string, source: string): Violation[] {
  const clean = stripNoise(source);
  const found: Violation[] = [];

  // #rgb / #rgba / #rrggbb / #rrggbbaa — the `(?![0-9a-fA-F])` stops #ff6047
  // from also reporting a bogus 3-digit match inside itself.
  for (const m of clean.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g)) {
    found.push({ file, line: lineOf(clean, m.index), text: m[0] });
  }

  // rgb()/rgba()/hsl()/hsla() — a literal colour by construction.
  for (const m of clean.matchAll(/\b(?:rgba?|hsla?)\s*\(/g)) {
    found.push({ file, line: lineOf(clean, m.index), text: m[0].trim() });
  }

  // A named colour only counts as a VALUE: preceded by `:` or `,` or a space
  // after one, and terminated by `;`, `}`, `,` or `!`. Without the terminator
  // this reports `white-space: nowrap`, which is a property, not a colour.
  const named = new RegExp(String.raw`[:,]\s*(${NAMED.join("|")})\s*(?=[;}!,\n])`, "gi");
  for (const m of clean.matchAll(named)) {
    if (ALLOWED_KEYWORDS.test(m[1])) continue;
    found.push({ file, line: lineOf(clean, m.index), text: m[1] });
  }

  return found;
}

const SCANNED = [
  ...collectFiles("src/theme", /\.(vue|css|ts|mts)$/).filter((f) => !f.startsWith(TOKEN_DIR)),
  "src/build/config_gen.ts",
];

describe("no literal colour outside the token files", () => {
  it("reports a hex, an rgba() and a named colour in a synthetic source", () => {
    // The RED half of the proof. It cannot be demonstrated against the real
    // tree (that would mean shipping a broken file), so the check is shown
    // failing on a fixture whose violations are known by construction.
    const broken = `
      <style>
      @layer ocx {
      .card { color: #ff6047; background: rgba(0, 0, 0, 0.5); border-color: red; }
      .ok { white-space: nowrap; background: none; color: var(--ocx-color-fg); }
      }
      </style>`;
    const hits = findLiteralColors("fixture.vue", broken);
    expect(hits.map((h) => h.text)).toEqual(["#ff6047", "rgba(", "red"]);
  });

  it("ignores colours inside comments and url() data URIs", () => {
    // Both false-positive classes found against the real tree: a `#716` issue
    // reference in a comment, and `stroke='black'` inside an SVG mask data URI
    // whose alpha channel is all that renders.
    const noisy = `
      /* the mock's coral #ff6047, see #716 */
      .icon { mask: url("data:image/svg+xml,%3Csvg stroke='black'%3E%3C/svg%3E") center; }
      .x { color: var(--ocx-color-fg); } // trailing note about red`;
    expect(findLiteralColors("fixture.css", noisy)).toEqual([]);
  });

  it("finds none in the shipped theme or the generated-config source", () => {
    const violations = SCANNED.flatMap((f) => findLiteralColors(f, read(f)));
    const report = violations.map((v) => `${v.file}:${v.line} ${v.text}`).join("\n");
    expect(report).toBe("");
  });
});
