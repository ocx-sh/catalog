import { describe, it, expect } from "vitest";
import { DEFAULT_PINS, scrapePins } from "../../src/ci/pins.js";

/** Two arbitrary but VALID 40-hex commit SHAs. Fixture refs have to be real
 * SHA shapes since the W4 fix (security panel 2026-08-22): a carried-forward
 * ref that isn't one is dropped by design, so a placeholder like "newsha"
 * would exercise the mutable-ref path instead of the carry-forward path
 * these cases are about. */
const SHA_A = "34e114876b0b11c390a56381ad16ebd13914f8d5";
const SHA_B = "820762786026740c76f36085b0efc47a31fe5020";

describe("C-007 scrapePins", () => {
  it("carries forward a pin consistent across every discovered file", () => {
    const { pins, conflicts, mutableRefs } = scrapePins([
      { content: `      - uses: actions/checkout@${SHA_A}  # v4.4.0\n` },
      { content: `      - uses: actions/checkout@${SHA_A}  # v4.4.0\n` },
    ]);
    expect(pins.get("actions/checkout")).toBe(`${SHA_A}  # v4.4.0`);
    expect(conflicts).toEqual([]);
    expect(mutableRefs).toEqual([]);
  });

  it("flags a conflict when the same action is pinned to two distinct values", () => {
    const { pins, conflicts } = scrapePins([
      { content: `      - uses: actions/checkout@${SHA_A}  # v4.3.0\n` },
      { content: `      - uses: actions/checkout@${SHA_B}  # v4.3.1\n` },
    ]);
    expect(pins.has("actions/checkout")).toBe(false);
    expect(conflicts).toEqual(["actions/checkout"]);
  });

  it("carries a pin with no trailing comment (ref only)", () => {
    const { pins, conflicts } = scrapePins([{ content: `      - uses: actions/checkout@${SHA_A}\n` }]);
    expect(pins.get("actions/checkout")).toBe(SHA_A);
    expect(conflicts).toEqual([]);
  });

  it("returns an empty map for content with no uses: lines (e.g. a rendered GitLab file)", () => {
    const { pins, conflicts, mutableRefs } = scrapePins([
      { content: "catalog:build:\n  image: node:22-alpine\n" },
    ]);
    expect(pins.size).toBe(0);
    expect(conflicts).toEqual([]);
    expect(mutableRefs).toEqual([]);
  });

  it("tracks each action independently", () => {
    const { pins, conflicts } = scrapePins([
      {
        content:
          `      - uses: actions/checkout@${SHA_A}  # v4.3.1\n` +
          `      - uses: actions/setup-node@${SHA_B}  # v7.0.0\n`,
      },
    ]);
    expect(pins.get("actions/checkout")).toBe(`${SHA_A}  # v4.3.1`);
    expect(pins.get("actions/setup-node")).toBe(`${SHA_B}  # v7.0.0`);
    expect(conflicts).toEqual([]);
  });

  it("DEFAULT_PINS carries a pin for every action the templates reference", () => {
    expect(DEFAULT_PINS["actions/checkout"]).toMatch(/^[0-9a-f]{40} {2}# v\d+\.\d+\.\d+$/);
    expect(DEFAULT_PINS["actions/setup-node"]).toMatch(/^[0-9a-f]{40} {2}# v\d+\.\d+\.\d+$/);
    // packageManager: "bun" swaps this in for actions/setup-node (render.ts
    // githubSetupSteps) — same shape requirement.
    expect(DEFAULT_PINS["oven-sh/setup-bun"]).toMatch(/^[0-9a-f]{40} {2}# v\d+\.\d+\.\d+$/);
  });
});

/** Security panel WARN (2026-08-22, W4): a hand-edit from `@<sha>` to
 * `@main` is invisible to the generated `verify-catalog-ci` drift job
 * (`normalizeForDrift` strips `@ref` before comparing), so if the scraper
 * carried it forward the next render would adopt the mutable ref as the new
 * pin — in the very package that generates the workflows the "SHA-pinned
 * actions" invariant governs. */
describe("C-007 scrapePins — mutable refs are never carried forward", () => {
  it.each([
    ["a branch", "main"],
    ["a major-version tag", "v4"],
    ["a full semver tag", "v4.3.1"],
    ["a short SHA", "34e1148"],
    ["a 40-char non-hex ref", "z".repeat(40)],
  ])("drops %s and reports it as a mutable ref", (_case, ref) => {
    const { pins, conflicts, mutableRefs } = scrapePins([
      { content: `      - uses: actions/checkout@${ref}  # hand-edited\n` },
    ]);
    expect(pins.has("actions/checkout")).toBe(false);
    expect(conflicts).toEqual([]);
    expect(mutableRefs).toEqual(["actions/checkout"]);
  });

  it("drops the action entirely when one file pins a SHA and another a branch", () => {
    const { pins, conflicts, mutableRefs } = scrapePins([
      { content: `      - uses: actions/checkout@${SHA_A}  # v4.3.1\n` },
      { content: "      - uses: actions/checkout@main\n" },
    ]);
    expect(pins.has("actions/checkout")).toBe(false);
    expect(conflicts).toEqual([]);
    expect(mutableRefs).toEqual(["actions/checkout"]);
  });

  it("leaves other actions' SHA pins alone and sorts the reported names", () => {
    const { pins, mutableRefs } = scrapePins([
      {
        content:
          `      - uses: actions/setup-node@${SHA_B}  # v7.0.0\n` +
          "      - uses: actions/upload-artifact@main\n" +
          "      - uses: actions/checkout@v4\n",
      },
    ]);
    expect(pins.get("actions/setup-node")).toBe(`${SHA_B}  # v7.0.0`);
    expect(mutableRefs).toEqual(["actions/checkout", "actions/upload-artifact"]);
  });
});
