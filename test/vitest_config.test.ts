import { describe, expect, it } from "vitest";
import config from "../vitest.config.js";

/*
 * C-028: coverage stays at 100% with exactly the exclusions ADR D4 lists.
 * Adding an entry here silently shrinks what the gate measures, so the list
 * is pinned; widening it is a reviewed change to this test AND the ADR.
 * `astro_runner.ts` and `dev.ts` are deliberately absent: both are unit-tested
 * against an injected fake child.
 */
describe("C-028 coverage exclusions", () => {
  it("excludes exactly the ADR D4 list", () => {
    expect(config.test?.coverage?.exclude).toEqual([
      "src/cli/index.ts",
      "**/*.astro",
      "**/*.d.ts",
      ".lighthouserc.cjs",
      ".lighthouserc.bulk.cjs",
      "test/fixtures/quality-index/**",
      "test/quality/**",
    ]);
  });

  it("keeps the 100% threshold on every metric", () => {
    expect(config.test?.coverage?.thresholds).toEqual({
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    });
  });

  it("keeps the unit and acceptance projects", () => {
    const projects = config.test?.projects as Array<{ test: { name: string } }>;
    expect(projects.map((p) => p.test.name)).toEqual(["unit", "acceptance"]);
  });
});
