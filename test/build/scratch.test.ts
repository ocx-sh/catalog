import { describe, it, expect, vi } from "vitest";
import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep, join } from "node:path";
import { createScratchRoot, sweepScratchRoots } from "../../src/build/scratch.js";
import { withTempDir } from "./helpers.js";

/*
 * C-005 location contract (Specify-spike correction, see scratch.ts's own
 * doc "Location" section): a scratch root lives under the CONSUMER project's
 * own `node_modules/.cache/ocx-catalog/` (or `.ocx-catalog/` when
 * `node_modules` doesn't exist yet), never `os.tmpdir()` — a bare mkdtemp
 * root under the OS temp dir has no `node_modules` chain of its own, so bare
 * imports in the generated config/theme shim (`vitepress`,
 * `@ocx-sh/catalog/theme`) can't resolve from it.
 */

/** True once `path` no longer exists on disk. */
async function isRemoved(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
}

describe("C-005 createScratchRoot", () => {
  it("creates a real directory under <cwd>/node_modules/.cache/ocx-catalog, prefixed ocx-catalog-<pid>-", async () => {
    // This repo's own cwd (where vitest runs from) has a real node_modules,
    // so the default (non-fallback) branch is exercised here.
    const root = await createScratchRoot();
    try {
      const expectedBase = resolve(process.cwd(), "node_modules", ".cache", "ocx-catalog");
      expect(dirname(resolve(root.path))).toBe(expectedBase);
      expect(basename(root.path).startsWith(`ocx-catalog-${process.pid}-`)).toBe(true);
      const stats = await stat(root.path);
      expect(stats.isDirectory()).toBe(true);
    } finally {
      await root.dispose();
    }
  });

  it("is unique per call — two roots in the same process never collide", async () => {
    const a = await createScratchRoot();
    const b = await createScratchRoot();
    try {
      expect(a.path).not.toBe(b.path);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  it("dispose() removes the directory tree", async () => {
    const root = await createScratchRoot();
    await root.dispose();
    expect(await isRemoved(root.path)).toBe(true);
  });

  it("dispose() is idempotent — calling it twice never throws", async () => {
    const root = await createScratchRoot();
    await root.dispose();
    await expect(root.dispose()).resolves.not.toThrow();
    expect(await isRemoved(root.path)).toBe(true);
  });

  it("cleanup survives an exception in the caller (finally-based dispose still runs)", async () => {
    const root = await createScratchRoot();
    let caught: unknown;
    try {
      try {
        throw new Error("caller boom");
      } finally {
        await root.dispose();
      }
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe("caller boom");
    expect(await isRemoved(root.path)).toBe(true);
  });

  it("a scratch root's path uses the platform path separator, not a stray slash", async () => {
    const root = await createScratchRoot();
    try {
      expect(root.path.endsWith(sep)).toBe(false);
    } finally {
      await root.dispose();
    }
  });
});

describe("C-005 sweepScratchRoots — the process-exit backstop's own sweep logic", () => {
  it("removes every given path from disk", async () => {
    const root = await createScratchRoot();
    // Deliberately never call root.dispose() — simulates the leaked-root
    // scenario the process-exit backstop exists for (this module's own
    // `registerCleanupHook` calls exactly this function with its tracked
    // registry, at real process exit).
    sweepScratchRoots([root.path]);
    expect(await isRemoved(root.path)).toBe(true);
  });

  it("a path that's already gone is a no-op, never throws", () => {
    expect(() => sweepScratchRoots(["/nonexistent/definitely-not-a-real-path"])).not.toThrow();
  });

  it("an empty iterable is a no-op", () => {
    expect(() => sweepScratchRoots([])).not.toThrow();
  });
});

describe("C-005 createScratchRoot — base directory resolution", () => {
  /** Runs `fn` with `process.cwd()` mocked to `dir` for its duration. */
  async function withMockedCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      return await fn();
    } finally {
      cwdSpy.mockRestore();
    }
  }

  it("cwd with its own node_modules -> base is <cwd>/node_modules/.cache/ocx-catalog", async () => {
    await withTempDir("catalog-scratch-cwd-", async (dir) => {
      await mkdir(join(dir, "node_modules"), { recursive: true });
      await withMockedCwd(dir, async () => {
        const root = await createScratchRoot();
        try {
          expect(dirname(root.path)).toBe(join(dir, "node_modules", ".cache", "ocx-catalog"));
        } finally {
          await root.dispose();
        }
      });
    });
  });

  it("cwd with no node_modules -> base falls back to <cwd>/.ocx-catalog", async () => {
    await withTempDir("catalog-scratch-cwd-", async (dir) => {
      await withMockedCwd(dir, async () => {
        const root = await createScratchRoot();
        try {
          expect(dirname(root.path)).toBe(join(dir, ".ocx-catalog"));
        } finally {
          await root.dispose();
        }
      });
    });
  });
});
