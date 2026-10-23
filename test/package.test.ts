import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCheckableBareSpecifier } from "../scripts/pack-smoke.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("C-026 engines floor", () => {
  it("declares engines.node >=22.13 (jsdom ^29 floor; Astro 7 floor is 22.12)", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      engines: { node: string };
    };
    expect(manifest.engines.node).toBe(">=22.13");
  });
});

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
      // FORCE_COLOR reproduces CI, where publint colours its output.
      const result = spawnSync("node", ["scripts/pack-smoke.mjs"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "1" },
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

describe("pack-smoke dependency-completeness specifier rule", () => {
  it("skips Astro framework virtual modules (astro:content) but nothing that merely starts with astro", () => {
    expect(isCheckableBareSpecifier("astro:content")).toBe(false);
    expect(isCheckableBareSpecifier("astro:assets")).toBe(false);
    expect(isCheckableBareSpecifier("astro")).toBe(true);
    expect(isCheckableBareSpecifier("astro/config")).toBe(true);
    expect(isCheckableBareSpecifier("astro-evil")).toBe(true);
    expect(isCheckableBareSpecifier("astro:Content")).toBe(true);
    expect(isCheckableBareSpecifier("astro:content/../x")).toBe(true);
  });

  it("still checks real packages and skips relative, node: and own-name specifiers", () => {
    expect(isCheckableBareSpecifier("jsdom")).toBe(true);
    expect(isCheckableBareSpecifier("@ocx-sh/theme/lazy")).toBe(true);
    expect(isCheckableBareSpecifier("./x.js")).toBe(false);
    expect(isCheckableBareSpecifier("node:fs")).toBe(false);
    expect(isCheckableBareSpecifier("@ocx-sh/catalog/x")).toBe(false);
  });
});

describe("C-026 renovate: astro + @astrojs/* move as one gated PR", () => {
  const renovate = JSON.parse(readFileSync(join(repoRoot, "renovate.json"), "utf8")) as {
    packageRules: {
      matchPackageNames?: string[];
      excludePackageNames?: string[];
      matchFileNames?: string[];
      groupName?: string;
      rangeStrategy?: string;
      automerge?: boolean;
      prBodyNotes?: string[];
    }[];
  };

  it("groups root astro and @astrojs/* together, keeping each range as written", () => {
    const rule = renovate.packageRules.find(
      (r) => r.matchFileNames?.includes("package.json") && r.matchPackageNames?.includes("astro"),
    );
    expect(rule, "no astro grouping rule for the root package.json").toBeDefined();
    expect(rule?.matchPackageNames).toContain("/^@astrojs\\//");
    expect(rule?.groupName).toBe("astro + @astrojs/*");
    expect(rule?.rangeStrategy).toBe("replace");
    expect(rule?.automerge).toBe(false);
    expect(rule?.prBodyNotes?.join(" ")).toContain("acceptance build");
  });

  it("keeps astro out of the routine minor/patch group so that rule can win", () => {
    const routine = renovate.packageRules.find((r) => r.groupName === "npm minor/patch");
    expect(routine?.excludePackageNames).toEqual(["astro", "/^@astrojs\\//"]);
  });

  it("mentions no removed VitePress/Vue dependency", () => {
    expect(JSON.stringify(renovate)).not.toMatch(/vitepress|"vue"/);
  });
});
