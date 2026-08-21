// WP-08 integration pin: ReadmePane must route markdown-it's output through
// the sanitizer before it reaches `v-html`. The sanitizer itself is covered
// exhaustively in `test/theme/utils/sanitize.test.ts`; this test exists so a
// future refactor cannot quietly unwire the chokepoint — the failure mode
// that made the module dead code for its first three rounds of review.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/theme/components/detail/ReadmePane.vue"),
  "utf8",
);

describe("ReadmePane sanitizer wiring", () => {
  test("imports the sanitizer chokepoint", () => {
    expect(SOURCE).toMatch(/import\s*\{\s*sanitizeReadmeHtml\s*\}\s*from/);
  });

  test("every markdown render is wrapped in sanitizeReadmeHtml before assignment", () => {
    const renders = SOURCE.match(/md\.render\([^)]*\)/g) ?? [];
    expect(renders.length).toBeGreaterThan(0);
    for (const call of renders) {
      const index = SOURCE.indexOf(call);
      const preceding = SOURCE.slice(Math.max(0, index - 60), index);
      expect(preceding).toContain("sanitizeReadmeHtml(");
    }
  });

  test("markdown-it stays configured with html:false (defence in depth, not replaced by the sanitizer)", () => {
    expect(SOURCE).toMatch(/html:\s*false/);
  });
});
