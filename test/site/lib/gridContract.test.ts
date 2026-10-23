import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { SCOPE_INLINE_MAX, SKELETON_COUNT } from "../../../src/site/lib/gridContract.js";

describe("the grid's shared constants", () => {
  test("D-034 'all' and six indexes are tabs; the seventh index starts the +N popover, and the toolbar slices by exactly this constant", () => {
    expect(SCOPE_INLINE_MAX).toBe(6);
    const toolbar = readFileSync(resolve(process.cwd(), "src/site/components/Toolbar.astro"), "utf8");
    // `scopes` leads with "all", so the tabs are the first SCOPE_INLINE_MAX + 1 entries and the rest overflow.
    expect(toolbar).toContain("scopes.slice(0, SCOPE_INLINE_MAX + 1)");
    expect(toolbar).toContain("scopes.slice(SCOPE_INLINE_MAX + 1)");
  });

  test("D-024 the loading skeleton stamps nine card-shaped placeholders", () => {
    expect(SKELETON_COUNT).toBe(9);
  });
});
