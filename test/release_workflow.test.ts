/**
 * Static invariants on this repo's OWN release lane
 * (`.github/workflows/release.yml`) — not on the CI files `src/ci` renders
 * for consumers, which `test/ci/*` already covers.
 *
 * Security panel (2026-08-22, W6): the `publish` job is the only job holding
 * `id-token: write`, so `ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN` are in its
 * environment. A plain `npm ci` there runs every transitive dependency's
 * install script with those variables present — one compromised dependency
 * mints the npm publish credential itself. `--ignore-scripts` is therefore
 * required in that job, and deliberately NOT in `gate` (no id-token there;
 * a dependency that genuinely needs its install script must fail loudly in
 * gate rather than be silently tolerated).
 *
 * Text-level assertions on purpose: no YAML parser is a dependency of this
 * package, and the invariant ("this exact job installs with this exact
 * flag") is a line-shape invariant anyway.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);

/** The `<name>:` job block at two-space indentation, up to the next one. */
function jobBlock(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `job "${name}" not found in release.yml`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("release.yml — install-script exposure in the credentialed job (W6)", () => {
  const publish = jobBlock("publish");
  const gate = jobBlock("gate");

  it("the publish job is the one holding id-token: write", () => {
    expect(publish).toContain("id-token: write");
    expect(gate).not.toContain("id-token");
  });

  it("the publish job installs with --ignore-scripts", () => {
    expect(publish).toContain("run: npm ci --ignore-scripts");
    expect(publish).not.toMatch(/run: npm ci$/m);
  });

  it("the gate job keeps full install scripts, so a script-needing dependency still fails loudly", () => {
    expect(gate).toMatch(/run: npm ci$/m);
    expect(gate).not.toContain("--ignore-scripts");
  });
});
