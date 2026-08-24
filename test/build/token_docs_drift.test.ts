import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — maintainer tooling, plain ESM with no type declarations.
import { renderTokenReference, readTokenSources, OUTPUT } from "../../scripts/gen-token-docs.mjs";

/*
 * `quality-design-tokens.md`: "A token reference page is generated from the
 * token files, never hand-maintained — a hand-written table is the thing that
 * goes stale, and a stale API table is worse than none."
 *
 * This is the gate behind that sentence. Add a token without re-running
 * `node scripts/gen-token-docs.mjs` and the committed page no longer matches
 * what the sources say, so this fails.
 *
 * It borrows `src/ci/`'s render/check shape but not its CLI plumbing: those
 * generated files land in a CONSUMER's repository, so they need
 * `ocx-catalog ci --check` exposed as a command. This page is our own docs
 * checked by our own suite — no downstream caller ever needs a verb for it.
 */

const REPO_ROOT = join(new URL("../../", import.meta.url).pathname);

describe("theme token reference", () => {
  it("matches what the token sources currently say", () => {
    const rendered = renderTokenReference(readTokenSources(REPO_ROOT));
    const committed = readFileSync(join(REPO_ROOT, OUTPUT), "utf8");
    expect(committed.trimEnd()).toBe(rendered.trimEnd());
  });

  it("picks up a new token, so drift is actually detectable", () => {
    // The red half. Renders from a doctored source and asserts the new token
    // appears — without this, the test above could be comparing two things
    // that are both stale in the same way.
    const sources = readTokenSources(REPO_ROOT);
    const doctored = {
      ...sources,
      "palette.css": sources["palette.css"].replace(
        "--ocx-color-bg:",
        "--ocx-color-probe: #abcdef;\n  --ocx-color-bg:",
      ),
    };
    const rendered = renderTokenReference(doctored);
    expect(rendered).toContain("--ocx-color-probe");
    expect(readFileSync(join(REPO_ROOT, OUTPUT), "utf8")).not.toContain("--ocx-color-probe");
  });

  it("never silently drops a token that matches no group", () => {
    // A token that fits no prefix must surface under "Other" rather than
    // vanishing — an undocumented token is an unusable part of the API.
    const sources = readTokenSources(REPO_ROOT);
    const doctored = {
      ...sources,
      "palette.css": sources["palette.css"].replace(
        "--ocx-color-bg:",
        "--ocx-unclassified-thing: 1px;\n  --ocx-color-bg:",
      ),
    };
    const rendered = renderTokenReference(doctored);
    expect(rendered).toContain("## Other");
    expect(rendered).toContain("--ocx-unclassified-thing");
  });

  it("marks aliases so a reader knows they need no .dark entry", () => {
    const rendered = renderTokenReference(readTokenSources(REPO_ROOT));
    expect(rendered).toContain("`var(--ocx-color-keyword)` (alias)");
  });
});
