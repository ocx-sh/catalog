import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cacheBaseDir } from "../../src/build/cache_dir.js";
import { withTempDir } from "./helpers.js";

/** Runs `fn` with `process.cwd()` mocked to `dir` for its duration. */
async function withMockedCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    return await fn();
  } finally {
    cwdSpy.mockRestore();
  }
}

describe("cacheBaseDir", () => {
  it("cwd with its own node_modules -> <cwd>/node_modules/.cache/ocx-catalog", async () => {
    await withTempDir("catalog-cache-dir-", async (dir) => {
      await mkdir(join(dir, "node_modules"), { recursive: true });
      const base = await withMockedCwd(dir, cacheBaseDir);
      expect(base).toBe(join(dir, "node_modules", ".cache", "ocx-catalog"));
    });
  });

  it("cwd with no node_modules -> falls back to <cwd>/.ocx-catalog", async () => {
    await withTempDir("catalog-cache-dir-", async (dir) => {
      const base = await withMockedCwd(dir, cacheBaseDir);
      expect(base).toBe(join(dir, ".ocx-catalog"));
    });
  });
});
