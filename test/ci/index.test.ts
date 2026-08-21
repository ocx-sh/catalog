import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CiError, runCi } from "../../src/ci/index.js";
import { withTempDir, writeGenerated } from "./helpers.js";

describe("C-007 runCi orchestration", () => {
  it("throws MISSING_CI_CONFIG when the loaded config has no ci block", async () => {
    await withTempDir(async (dir) => {
      const error = await runCi(undefined, dir, false).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(CiError);
      expect((error as CiError).code).toBe("MISSING_CI_CONFIG");
    });
  });

  it("a plain run writes the rendered set and returns the written paths", async () => {
    await withTempDir(async (dir) => {
      const result = await runCi({ forge: "github" }, dir, false);
      expect(result.files).toEqual([".github/workflows/catalog-ci.yml"]);
      const written = await readFile(join(dir, ".github/workflows/catalog-ci.yml"), "utf8");
      expect(written).toContain("name: catalog-ci");
    });
  });

  it("--check on a clean tree resolves without writing", async () => {
    await withTempDir(async (dir) => {
      await runCi({ forge: "gitlab" }, dir, false);
      const result = await runCi({ forge: "gitlab" }, dir, true);
      expect(result.files).toEqual([".gitlab-ci/catalog.yml"]);
    });
  });

  it("--check on drift throws CiError(DRIFT) naming the file", async () => {
    await withTempDir(async (dir) => {
      await writeGenerated(dir, ".github/workflows/catalog-ci.yml", "hand-edited, no header\n");
      const error = await runCi({ forge: "github" }, dir, true).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(CiError);
      expect((error as CiError).code).toBe("DRIFT");
      expect((error as CiError).message).toContain(".github/workflows/catalog-ci.yml");
    });
  });
});
