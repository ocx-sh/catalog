import { afterEach, describe, it, expect } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { ConfigError } from "../src/config/errors.js";
import type { CatalogConfig, LoadedConfig } from "../src/config/types.js";
import { assertOutDirOutsideInputs, assertOutDirSafe, resolveReal } from "../src/cli/out_dir.js";

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

describe("C-036 resolveReal", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const tmp = async (): Promise<string> => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "out-dir-")));
    dirs.push(dir);
    return dir;
  };

  it("follows a symlink to its target", async () => {
    const dir = await tmp();
    await mkdir(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "link"));
    expect(await resolveReal(join(dir, "link"))).toBe(join(dir, "real"));
  });

  it("resolves the deepest existing ancestor and re-appends a missing tail", async () => {
    const dir = await tmp();
    await mkdir(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "link"));
    expect(await resolveReal(join(dir, "link", "not", "yet"))).toBe(join(dir, "real", "not", "yet"));
  });

  it("treats a path below a regular file as missing rather than failing", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "afile"), "x");
    expect(await resolveReal(join(dir, "afile", "dist"))).toBe(join(dir, "afile", "dist"));
  });

  it("rethrows an error that is not about a missing path", async () => {
    const dir = await tmp();
    await symlink("loop-b", join(dir, "loop-a"));
    await symlink("loop-a", join(dir, "loop-b"));
    await expect(resolveReal(join(dir, "loop-a"))).rejects.toMatchObject({ code: "ELOOP" });
  });
});

describe("C-036 assertOutDirOutsideInputs", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** A real config tree: sources, docs, css, publicDir and a logo, all present on disk. */
  async function tree(config: Partial<CatalogConfig> = {}): Promise<{ dir: string; loaded: LoadedConfig }> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "out-dir-inputs-")));
    dirs.push(dir);
    for (const sub of ["index-a", "index-b", "docs", "public", "assets"]) await mkdir(join(dir, sub));
    await writeFile(join(dir, "site.css"), "");
    await writeFile(join(dir, "assets", "logo.svg"), "<svg/>");
    const loaded: LoadedConfig = {
      configDir: dir,
      sources: [
        { entry: { path: "index-a", root: true }, label: null },
        { entry: { url: "https://index.example" }, label: "remote" },
        { entry: { path: "index-b" }, label: null },
      ],
      config: {
        sources: [],
        base: "/",
        brand: { title: "T", logo: "assets/logo.svg" },
        docs: "docs",
        css: "site.css",
        publicDir: "public",
        ...config,
      },
    };
    return { dir, loaded };
  }

  const refused = async (out: string, loaded: LoadedConfig): Promise<ConfigError> => {
    const err = await assertOutDirOutsideInputs(out, loaded).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
    return err as ConfigError;
  };

  it.each([
    ["equals the config directory", (d: string) => d, "the config directory"],
    ["contains the config directory", (d: string) => dirname(d), "the config directory"],
    ["equals a path source root", (d: string) => join(d, "index-a"), "sources[0]"],
    ["equals the second path source root", (d: string) => join(d, "index-b"), "sources[2]"],
    ["equals docs", (d: string) => join(d, "docs"), "docs"],
    ["lies inside docs", (d: string) => join(d, "docs", "build", "x"), "docs"],
    ["equals publicDir", (d: string) => join(d, "public"), "publicDir"],
    ["lies inside publicDir", (d: string) => join(d, "public", "dist"), "publicDir"],
    ["equals the css file", (d: string) => join(d, "site.css"), "css"],
    ["equals the logo file", (d: string) => join(d, "assets", "logo.svg"), "brand.logo"],
  ])("refuses an output that %s", async (_name, outOf, named) => {
    const { dir, loaded } = await tree();
    const err = await refused(outOf(dir), loaded);
    expect(err.message).toContain(named);
  });

  it("refuses an output that is a symlink to an input (compared by real path)", async () => {
    const { dir, loaded } = await tree();
    await mkdir(join(dir, "dist-parent"));
    await symlink(join(dir, "docs"), join(dir, "dist-parent", "out"));
    const real = await resolveReal(join(dir, "dist-parent", "out"));
    await refused(real, loaded);
  });

  it("refuses when the input is reached through a symlink but the output spells the real path", async () => {
    const { dir, loaded } = await tree({ docs: "docs-link" });
    await symlink(join(dir, "docs"), join(dir, "docs-link"));
    await refused(join(dir, "docs"), loaded);
  });

  it.each([
    ["a fresh dist inside the config directory", (d: string) => join(d, "dist")],
    ["a sibling of the config directory", (d: string) => join(dirname(d), "elsewhere-out")],
    ["a path that only shares a name prefix with docs", (d: string) => join(d, "docs-out")],
    ["a path that only shares a name prefix with publicDir", (d: string) => join(d, "public2")],
  ])("accepts %s", async (_name, outOf) => {
    const { dir, loaded } = await tree();
    await expect(assertOutDirOutsideInputs(outOf(dir), loaded)).resolves.toBeUndefined();
  });

  it("skips optional inputs that are not configured and inputs that do not exist yet", async () => {
    const { dir, loaded } = await tree({ docs: undefined, css: undefined, publicDir: undefined, brand: { title: "T" } });
    await expect(assertOutDirOutsideInputs(join(dir, "dist"), loaded)).resolves.toBeUndefined();
    const missing = { ...loaded, config: { ...loaded.config, docs: "not-there" } };
    await expect(assertOutDirOutsideInputs(join(dir, "dist"), missing)).resolves.toBeUndefined();
    await refused(join(dir, "not-there"), missing);
  });

  it("treats a config without brand as having no logo input", async () => {
    const { dir, loaded } = await tree({ brand: undefined });
    await expect(assertOutDirOutsideInputs(join(dir, "dist"), loaded)).resolves.toBeUndefined();
  });
});

describe("S-001 the scratch-root refusal is an OUT_DIR_OVERLAPS_INPUT ConfigError (exit 65)", () => {
  it("throws a ConfigError carrying the code", () => {
    const root = join(sep, "tmp", "scratch");
    let error: unknown;
    try {
      assertOutDirSafe(root, root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
  });
});
