import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("C-009/S-005 pack verification gate", () => {
  /**
   * scripts/pack-smoke.mjs is the pre-publish gate. It must, in order:
   *   1. `npm pack` the package into a tarball.
   *   2. Run `publint` against the tarball (export map / bin / types shape).
   *   3. Run `@arethetypeswrong/cli --pack` against the tarball (type
   *      resolution across module systems).
   *   4. Install the tarball into a fresh `mkdtemp` sandbox with npm scripts
   *      disabled (`--ignore-scripts`), then run the installed
   *      `ocx-catalog --version` bin and confirm it prints the version
   *      from this repo's package.json.
   *   5. Fail the whole run if any npm pack/publish output contains the
   *      string "auto-corrected" (npm silently rewriting the manifest, e.g.
   *      dropping `bin`, is a hard failure, not a warning).
   *   6. Assert the npm major version the script itself is running under
   *      EQUALS the pinned `EXPECTED_NPM_MAJOR` and FAIL otherwise, so a
   *      future npm major's pack-format change can't silently pass. (Before
   *      the 2026-08-22 security panel this step only parsed and printed the
   *      major — the docblock claimed a check that did not exist.)
   *
   * This test is the gate that keeps the script honest against the
   * contract above.
   */
  it(
    "node scripts/pack-smoke.mjs exits 0",
    () => {
      const result = spawnSync("node", ["scripts/pack-smoke.mjs"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(result.status, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
    },
    120_000,
  );

  it(
    "fails fast under an unexpected npm major instead of silently passing",
    () => {
      // A stub `npm` earlier on PATH, reporting a major nobody has verified
      // this script's pack-format assertions against. The version check is
      // the first thing main() does, so nothing is packed or installed here.
      const binDir = mkdtempSync(join(tmpdir(), "ocx-catalog-npm-stub-"));
      try {
        const stub = join(binDir, "npm");
        writeFileSync(stub, '#!/bin/sh\necho "99.0.0"\n');
        chmodSync(stub, 0o755);
        const result = spawnSync("node", ["scripts/pack-smoke.mjs"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("npm 99.0.0");
        expect(result.stderr).toContain("EXPECTED_NPM_MAJOR");
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
