import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared source-scanning primitives for the CSS-contract gates
 * (`no_literal_color.test.ts`, `dark_parity.test.ts`, `layer_contract.test.ts`).
 *
 * These live in one module rather than being re-typed per test because they are
 * *machinery*, not assertions — the DAMP rule in `subsystem-tests.md` is about
 * keeping each test's own intent readable, and a hand-copied file walker in four
 * places is the kind of duplication that drifts silently. Every actual
 * assertion still lives in its own test file, spelled out.
 */

export const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

/** The token files are the ONE place a literal colour is allowed to live. */
export const TOKEN_DIR = "src/theme/styles/tokens";

/** Recursively collect files under `dir` (repo-relative) matching `ext`. */
export function collectFiles(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(REPO_ROOT, rel);
    if (!statSync(abs).isDirectory()) {
      if (ext.test(rel)) out.push(rel);
      return;
    }
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      walk(join(rel, entry.name));
    }
  };
  walk(dir);
  return out.sort();
}

export function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/**
 * Remove block and line comments, then blank out the *contents* of every
 * `url(...)`.
 *
 * Both are required, and both were found the hard way against the real tree:
 * - `src/viewmodel/catalog.ts` cites GitHub issue `#716`, which a bare hex
 *   regex reads as a 3-digit colour, and `monogram.ts`'s docblock quotes the
 *   very hex values the gate is meant to eliminate.
 * - `docs-prose.css` embeds `url("data:image/svg+xml,...stroke='black'...")`
 *   for an icon mask. The mask only uses the alpha channel, so that `black` is
 *   not a themeable colour — but it reads as one.
 *
 * Replacing with same-length whitespace keeps every subsequent match's index
 * aligned with the original source, so reported line numbers stay true.
 */
export function stripNoise(source: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)))
    .replace(/url\(([\s\S]*?)\)/g, (m) => "url(" + blank(m.slice(4, -1)) + ")");
}

export function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Byte ranges of every `@layer ocx { ... }` block, matched by brace depth.
 * Throws on an unbalanced block — a silently truncated range would make every
 * "inside the layer" check pass vacuously.
 */
export function layerRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /@layer ocx\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) throw new Error(`unbalanced "@layer ocx" block at offset ${match.index}`);
    ranges.push([match.index, end]);
  }
  return ranges;
}
