/**
 * D-165: no literal colour in `src/site/**`. `quality-design-tokens.md` calls a hex, an `rgb()` or a named colour in a
 * template or stylesheet Block-tier: a value a consumer's `css` cannot override and dark mode ignores. Before the port
 * `test/theme/no_literal_color.test.ts` gated it; this is that gate over the Astro site. The detector is shown red on
 * a planted source first, so a green scan means "none found", not "nothing scanned".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Named CSS colours a developer actually reaches for; the 148 names are not worth enumerating. */
const NAMED = ["white", "black", "red", "green", "blue", "yellow", "orange", "purple", "coral", "teal", "navy", "gray", "grey", "pink", "brown", "silver", "gold", "cyan", "magenta", "lime", "olive", "maroon", "aqua", "fuchsia"];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

/** Comments and the contents of `url(...)` blanked to spaces, so indices and line numbers stay true. */
function stripNoise(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) => lead + blank(match.slice(lead.length)))
    .replace(/url\(([\s\S]*?)\)/g, (match) => `url(${blank(match.slice(4, -1))})`);
}

function literalColors(source: string): string[] {
  const clean = stripNoise(source);
  const line = (index: number): number => clean.slice(0, index).split("\n").length;
  const hex = [...clean.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g)];
  const functional = [...clean.matchAll(/\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\s*\(/g)];
  // A name counts as a VALUE only: after `:` or `,` and before `;`, `}`, `!` or `,`; `white-space` is a property.
  const named = [...clean.matchAll(new RegExp(String.raw`[:,]\s*(?:${NAMED.join("|")})\s*(?=[;}!,\n])`, "gi"))];
  return [...hex, ...functional, ...named].map((m) => `${line(m.index)}: ${m[0].replace(/^[:,]\s*/, "").trim()}`);
}

describe("D-165 no literal colour in the Astro site", () => {
  it("D-165 finds a hex, an rgba() and a named colour in a planted template", () => {
    const planted = `<style>
.card { color: #ff6047; background: rgba(0, 0, 0, 0.5); border-color: red; }
.ok { white-space: nowrap; background: none; color: var(--ocx-color-fg); }
</style>`;

    expect(literalColors(planted)).toEqual(["2: #ff6047", "2: rgba(", "2: red"]);
  });

  it("D-165 ignores a colour in a comment and one inside a url() data URI", () => {
    const noisy = `/* the mock's coral #ff6047 */
.icon { mask: url("data:image/svg+xml,%3Csvg stroke='black'%3E%3C/svg%3E") center; }
.x { color: var(--ocx-color-fg); } // a note about red`;

    expect(literalColors(noisy)).toEqual([]);
  });

  it("D-165 finds none in src/site (templates, stylesheets, islands and view-models)", () => {
    const files = walk(join(ROOT, "src/site")).filter((path) => /\.(astro|css|ts)$/.test(path) && !path.endsWith(".d.ts"));
    const violations = files.flatMap((path) => literalColors(readFileSync(path, "utf8")).map((hit) => `${relative(ROOT, path)}:${hit}`));

    expect(files.length).toBeGreaterThan(40);
    expect(violations).toEqual([]);
  });
});
