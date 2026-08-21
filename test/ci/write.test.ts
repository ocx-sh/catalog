import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkCi, writeCi } from "../../src/ci/write.js";
import { withTempDir, writeGenerated } from "./helpers.js";

const FILE = { path: ".github/workflows/catalog-ci.yml", content: "line one\nline two\n" };

describe("C-007 writeCi", () => {
  it("writes files, creating parent directories", async () => {
    await withTempDir(async (dir) => {
      await writeCi(dir, [FILE]);
      const written = await readFile(join(dir, FILE.path), "utf8");
      expect(written).toBe(FILE.content);
    });
  });

  it("overwrites an existing file", async () => {
    await withTempDir(async (dir) => {
      await writeGenerated(dir, FILE.path, "stale content\n");
      await writeCi(dir, [FILE]);
      const written = await readFile(join(dir, FILE.path), "utf8");
      expect(written).toBe(FILE.content);
    });
  });
});

describe("C-007 checkCi", () => {
  it("reports drift when the file is missing entirely", async () => {
    await withTempDir(async (dir) => {
      const results = await checkCi(dir, [FILE]);
      expect(results).toEqual([{ path: FILE.path, drift: true }]);
    });
  });

  it("reports no drift for a byte-identical committed file", async () => {
    await withTempDir(async (dir) => {
      await writeGenerated(dir, FILE.path, FILE.content);
      const results = await checkCi(dir, [FILE]);
      expect(results).toEqual([{ path: FILE.path, drift: false }]);
    });
  });

  it("reports drift for a hand-edited committed file", async () => {
    await withTempDir(async (dir) => {
      await writeGenerated(dir, FILE.path, "line one\nhand-edited line\n");
      const results = await checkCi(dir, [FILE]);
      expect(results).toEqual([{ path: FILE.path, drift: true }]);
    });
  });

  it("reports no drift when only a uses: pin was Renovate-bumped (S-004)", async () => {
    await withTempDir(async (dir) => {
      const rendered = {
        path: ".github/workflows/catalog-ci.yml",
        content: "      - uses: actions/checkout@aaa  # v4.3.0\n",
      };
      await writeGenerated(dir, rendered.path, "      - uses: actions/checkout@bbb  # v4.3.1\n");
      const results = await checkCi(dir, [rendered]);
      expect(results).toEqual([{ path: rendered.path, drift: false }]);
    });
  });
});
