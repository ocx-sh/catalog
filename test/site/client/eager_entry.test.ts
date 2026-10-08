/**
 * Grep test for the pre-input JavaScript budget (C-017: 11 KiB gz before any
 * input, measured for real by `scripts/quality-budget.mjs`). The grid and the
 * palette entries run on every landing page load, so they may import only what
 * wiring listeners needs; the rendering, the search and the catalog fetch live
 * in `grid_session.ts` / `palette_session.ts` (and `filterPackages`, which
 * carries MiniSearch), reached by a dynamic `import()` inside `LazyMount.load`.
 * A static import of any of them puts the whole chunk in front of every first
 * paint, and nothing but the browser probe would notice.
 *
 * The detector runs against a planted static import first, which must come out
 * red, then against the real entries.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT = fileURLToPath(new URL("../../../src/site/client", import.meta.url));

/** Modules an entry may only reach lazily. */
const LAZY = /\/(grid_session|palette_session|filterPackages|catalogFetch)\.js"/;

/** The runtime imports (not `import type`) of `source` that name a lazy module. */
function eagerImports(source: string): string[] {
  return source.split("\n").filter((line) => /^import (?!type )/.test(line) && LAZY.test(line));
}

describe("the detector (red)", () => {
  it("flags a static import of a lazy module", () => {
    expect(eagerImports('import { startSession } from "./grid_session.js";')).toHaveLength(1);
    expect(eagerImports('import { filterPackages } from "../lib/filterPackages.js";')).toHaveLength(1);
  });

  it("lets a type import and a dynamic import through", () => {
    expect(eagerImports('import type { Session } from "./grid_session.js";')).toEqual([]);
    expect(eagerImports('const { startSession } = await import("./grid_session.js");')).toEqual([]);
  });
});

describe("the island entries reach their lazy half only by dynamic import", () => {
  it.each([
    ["grid.ts", "./grid_session.js"],
    ["palette.ts", "./palette_session.js"],
  ])("%s", (file, session) => {
    const source = readFileSync(join(CLIENT, file), "utf8");

    expect(eagerImports(source)).toEqual([]);
    expect(source).toContain(`await import("${session}")`);
  });
});
