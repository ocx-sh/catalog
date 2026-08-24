import { describe, it, expect } from "vitest";
import { collectFiles, read, stripNoise, lineOf, TOKEN_DIR } from "./css_contract_helpers.js";

/*
 * `quality-css-overrides.md` §3 and `quality-design-tokens.md`'s component
 * tier. A component hook is `--ocx-<component>-<property>`, and it is
 * override-ONLY: the theme reads it with a `var()` fallback to the semantic
 * tier and never declares it.
 *
 * Two failure modes this guards, both of which look fine in review:
 *
 * 1. A hook with no component segment. `--ocx-radius` reads naturally but,
 *    without shadow DOM to contain it, it applies to every component that
 *    happens to read that name. Ionic gets away with bare `--background`
 *    only because its shadow roots isolate each one; this theme has none.
 *
 * 2. A hook with a literal fallback — `var(--ocx-card-radius, 8px)`. It works,
 *    so nothing fails, but the component has quietly stopped tracking the
 *    global token: a mirror that rebrands `--ocx-radius-lg` now finds one
 *    component ignoring it. That is the "independent second source of truth"
 *    the two-tier rule actually bans.
 */

/** Semantic tokens a hook is allowed to fall back to. */
function semanticTokenNames(): Set<string> {
  const names = new Set<string>();
  for (const file of collectFiles(TOKEN_DIR, /\.css$/)) {
    for (const m of read(file).matchAll(/^\s*(--ocx-[a-z0-9-]+)\s*:/gm)) names.add(m[1]);
  }
  return names;
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export function findHookViolations(file: string, source: string, semantic: ReadonlySet<string>): Violation[] {
  const clean = stripNoise(source);
  const out: Violation[] = [];

  for (const m of clean.matchAll(/var\(\s*(--ocx-[a-z0-9-]+)\s*(?:,\s*([^;]+?))?\s*\)\s*[;,)]/g)) {
    const [, name, fallback] = m;
    if (semantic.has(name)) continue; // a plain semantic token, not a hook
    const line = lineOf(clean, m.index);

    // `--ocx-<component>-<property>` needs at least two segments after the
    // namespace, or there is no component segment to isolate it.
    if (name.split("-").length < 5) {
      out.push({ file, line, reason: `${name} has no component segment` });
      continue;
    }
    if (fallback === undefined) {
      out.push({ file, line, reason: `${name} has no fallback to a semantic token` });
      continue;
    }
    if (!fallback.includes("var(--ocx-")) {
      out.push({ file, line, reason: `${name} falls back to a literal (${fallback.trim()}), not a token` });
    }
  }

  // The theme must never DECLARE a hook — that would make it a stored value
  // rather than an override point.
  for (const m of clean.matchAll(/^\s*(--ocx-[a-z0-9-]+)\s*:/gm)) {
    if (!semantic.has(m[1])) {
      out.push({ file, line: lineOf(clean, m.index), reason: `${m[1]} is declared by the theme; hooks are override-only` });
    }
  }

  return out;
}

const SCANNED = collectFiles("src/theme", /\.(vue|css)$/).filter((f) => !f.startsWith(TOKEN_DIR));

describe("component hook contract", () => {
  const semantic = semanticTokenNames();

  it("rejects a bare hook, a literal fallback, a missing fallback and a declaration", () => {
    const broken = `
      .a { border-radius: var(--ocx-radius, var(--ocx-radius-lg)); }
      .b { border-radius: var(--ocx-card-radius, 8px); }
      .c { color: var(--ocx-card-color); }
      .d {
        --ocx-card-radius: 8px;
      }`;
    const reasons = findHookViolations("fixture.css", broken, semantic).map((v) => v.reason);
    expect(reasons).toEqual([
      "--ocx-radius has no component segment",
      "--ocx-card-radius falls back to a literal (8px), not a token",
      "--ocx-card-color has no fallback to a semantic token",
      "--ocx-card-radius is declared by the theme; hooks are override-only",
    ]);
  });

  it("accepts a well-formed hook", () => {
    const good = `.a { border-radius: var(--ocx-package-card-radius, var(--ocx-radius-lg)); }`;
    expect(findHookViolations("fixture.css", good, semantic)).toEqual([]);
  });

  it("finds none in the shipped theme", () => {
    const violations = SCANNED.flatMap((f) => findHookViolations(f, read(f), semantic));
    expect(violations.map((v) => `${v.file}:${v.line} ${v.reason}`).join("\n")).toBe("");
  });

  it("every published hook is actually reachable from a data-slot element", () => {
    // A hook on an element a consumer cannot select is not an API. Every
    // component carrying hooks must also carry a data-slot identity.
    const withHooks = SCANNED.filter((f) => /var\(\s*--ocx-[a-z0-9-]+\s*,\s*var\(/.test(stripNoise(read(f))));
    expect(withHooks.length).toBeGreaterThan(0);
    for (const file of withHooks) {
      expect(read(file), `${file} publishes hooks but has no data-slot`).toContain("data-slot=");
    }
  });
});
