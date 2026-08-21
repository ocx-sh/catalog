import { describe, it, expect } from "vitest";
import { join, sep } from "node:path";
import { assertOutDirSafe } from "../src/cli/out_dir.js";

describe("C-001/C-005 assertOutDirSafe", () => {
  it("throws when outDir equals scratchRoot exactly", () => {
    const root = join(sep, "tmp", "scratch");
    expect(() => assertOutDirSafe(root, root)).toThrow();
  });

  it("throws when outDir equals scratchRoot but for a trailing slash", () => {
    const root = join(sep, "tmp", "scratch");
    expect(() => assertOutDirSafe(root, `${root}${sep}`)).toThrow();
  });

  it("throws when outDir names the same path as scratchRoot but relatively", () => {
    // scratchRoot given absolute, outDir given as a relative spelling that
    // resolves (against process.cwd()) to the identical directory.
    const root = process.cwd();
    expect(() => assertOutDirSafe(root, ".")).toThrow();
  });

  it("throws when outDir is the direct parent of scratchRoot", () => {
    const root = join(sep, "tmp", "scratch", "nested");
    const outDir = join(sep, "tmp", "scratch");
    expect(() => assertOutDirSafe(root, outDir)).toThrow();
  });

  it("throws when outDir is a distant ancestor of scratchRoot", () => {
    const root = join(sep, "tmp", "scratch", "nested", "deep");
    const outDir = join(sep, "tmp");
    expect(() => assertOutDirSafe(root, outDir)).toThrow();
  });

  it("throws when outDir is a descendant of scratchRoot", () => {
    // The scratch root is a self-sweeping mkdtemp: output written inside it
    // would be deleted at cleanup, so descendants are unsafe too, not just
    // ancestors/equal.
    const root = join(sep, "tmp", "scratch");
    const outDir = join(sep, "tmp", "scratch", "build");
    let error: unknown;
    try {
      assertOutDirSafe(root, outDir);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(root);
    expect((error as Error).message).toContain(outDir);
  });

  it("does not throw for a sibling directory", () => {
    const root = join(sep, "tmp", "scratch");
    const outDir = join(sep, "tmp", "other");
    expect(() => assertOutDirSafe(root, outDir)).not.toThrow();
  });

  it("does not throw for a descendant of an unrelated tree", () => {
    const root = join(sep, "tmp", "scratch");
    const outDir = join(sep, "tmp", "other", "nested", "deep");
    expect(() => assertOutDirSafe(root, outDir)).not.toThrow();
  });

  it("does not throw for a path that only shares a string prefix, not a path segment", () => {
    const root = join(sep, "tmp", "scratch");
    const outDir = join(sep, "tmp", "scratch2");
    expect(() => assertOutDirSafe(root, outDir)).not.toThrow();
  });

  it("does not throw for the reverse string-prefix case", () => {
    const root = join(sep, "tmp", "scratch2");
    const outDir = join(sep, "tmp", "scratch");
    expect(() => assertOutDirSafe(root, outDir)).not.toThrow();
  });

  it("names both paths in the error message", () => {
    const root = join(sep, "tmp", "scratch", "nested");
    const outDir = join(sep, "tmp", "scratch");
    let error: unknown;
    try {
      assertOutDirSafe(root, outDir);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(root);
    expect((error as Error).message).toContain(outDir);
  });
});
