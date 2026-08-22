/**
 * Spec tests for `src/sources/path.ts` (C-003a) — written from the plan's
 * C-003 contract and the stub's own doc comments (`readPathSource`,
 * `readDirectoryTree`, `resolveContainedRealPath`). MUST fail against the
 * `throw new Error("not implemented")` stubs.
 */
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceError } from "../../src/sources/types.js";
import { readDirectoryTree, readPathSource, resolveContainedRealPath } from "../../src/sources/path.js";
import { bytesEqual, utf8 } from "./helpers.js";

const cleanupDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Writes `text` at `dir/relPath`, creating parent directories. */
async function put(dir: string, relPath: string, text: string): Promise<void> {
  const full = join(dir, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, text, "utf8");
}

describe("readDirectoryTree — wire-shape filtering", () => {
  it("keeps only config.json, c/index.json, and everything under p/, dropping repo clutter", async () => {
    const root = await tempDir("catalog-path-filter-");
    await put(root, "config.json", '{"format_version":1}');
    await put(root, "c/index.json", '{"format_version":1,"packages":{}}');
    await put(root, "p/kitware/cmake.json", '{"name":"ocx.sh/kitware/cmake"}');
    await put(root, "p/kitware/cmake/o/sha256/aaaa.json", "{}");
    // Clutter that a blind directory mirror would otherwise leak.
    await put(root, ".git/config", "[core]\n");
    await put(root, ".github/workflows/ci.yml", "name: ci\n");
    await put(root, "node_modules/dep/index.js", "module.exports = {};\n");
    await put(root, "README.md", "# hello\n");

    const files = await readDirectoryTree(root);

    expect(new Set(files.keys())).toEqual(
      new Set(["config.json", "c/index.json", "p/kitware/cmake.json", "p/kitware/cmake/o/sha256/aaaa.json"]),
    );
  });

  it("silently skips config.json when that path names a directory, not a file", async () => {
    const root = await tempDir("catalog-path-configdir-");
    // A directory literally named "config.json" — not the wire shape, but
    // real filesystem input this reader must never crash on nor include.
    await mkdir(join(root, "config.json", "nested"), { recursive: true });
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');

    const files = await readDirectoryTree(root);

    expect(files.has("config.json")).toBe(false);
    expect(files.has("p/ns/pkg.json")).toBe(true);
  });

  it("rethrows a non-ENOENT error reading config.json (e.g. ENOTDIR), never treats it as merely absent", async () => {
    const root = await tempDir("catalog-path-config-enotdir-");
    // A plain FILE named "c" — "c/index.json" then can't be traversed at
    // all (ENOTDIR, not ENOENT: the parent segment exists, just isn't a
    // directory), the same failure class a real permission error would be.
    await put(root, "c", "not a directory");

    await expect(readDirectoryTree(root)).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("rethrows a non-ENOENT error walking p/ (e.g. ENOTDIR), never treats it as merely absent", async () => {
    const root = await tempDir("catalog-path-p-enotdir-");
    await put(root, "p", "not a directory");

    await expect(readDirectoryTree(root)).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("returns file bytes verbatim, never re-serialized", async () => {
    const root = await tempDir("catalog-path-bytes-");
    const oddlySpaced = '{ "format_version":   1 , "packages" :{} }';
    await put(root, "c/index.json", oddlySpaced);

    const files = await readDirectoryTree(root);
    const bytes = files.get("c/index.json");

    expect(bytes).toBeDefined();
    expect(bytesEqual(bytes!, utf8(oddlySpaced))).toBe(true);
  });

  it("includes a symlinked file that stays inside the source root", async () => {
    const root = await tempDir("catalog-path-inside-link-");
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    await symlink(join(root, "p/ns/pkg.json"), join(root, "p/ns/alias.json"));

    const files = await readDirectoryTree(root);

    expect(files.has("p/ns/alias.json")).toBe(true);
    expect(bytesEqual(files.get("p/ns/alias.json")!, utf8('{"name":"ocx.sh/ns/pkg"}'))).toBe(true);
  });

  it("rejects a symlinked FILE that escapes the source root (PATH_ESCAPE)", async () => {
    const base = await tempDir("catalog-path-escape-base-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await put(outside, "secret.json", '{"leaked":true}');
    await mkdir(join(root, "p"), { recursive: true });
    await symlink(join(outside, "secret.json"), join(root, "p", "escaped.json"));

    await expect(readDirectoryTree(root)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });

  it("rejects a symlinked SUBDIRECTORY that escapes the source root (PATH_ESCAPE)", async () => {
    const base = await tempDir("catalog-path-escape-dir-base-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(join(outside, "nested"), { recursive: true });
    await put(outside, "nested/leaked.json", '{"leaked":true}');
    await mkdir(join(root, "p"), { recursive: true });
    await symlink(join(outside, "nested"), join(root, "p", "escaped-dir"));

    await expect(readDirectoryTree(root)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });

  it("PATH_ESCAPE error names the offending file and its escaping real path", async () => {
    const base = await tempDir("catalog-path-escape-msg-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await put(outside, "secret.json", "{}");
    await mkdir(join(root, "p"), { recursive: true });
    await symlink(join(outside, "secret.json"), join(root, "p", "escaped.json"));

    let error: SourceError | undefined;
    try {
      await readDirectoryTree(root);
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.message).toContain("p/escaped.json");
  });
});

describe("readDirectoryTree — symlink cycle/DAG termination (C-401)", () => {
  it("terminates on a symlink cycle instead of recursing until ELOOP, and does not walk into the alias", async () => {
    const root = await tempDir("catalog-path-cycle-");
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    // `p/ns/cycle` points back at its own parent `p/ns` — walking it naively
    // recurses p/ns/cycle/cycle/... until the OS returns ELOOP.
    await symlink(join(root, "p/ns"), join(root, "p/ns/cycle"));

    const files = await readDirectoryTree(root);

    expect(files.has("p/ns/pkg.json")).toBe(true);
    // The already-visited real directory is skipped, never re-descended.
    expect([...files.keys()].some((key) => key.includes("cycle"))).toBe(false);
  });

  it("emits a real file reachable through several symlink aliases exactly once (DAG dedup)", async () => {
    const root = await tempDir("catalog-path-dag-");
    const pkgBytes = utf8('{"name":"ocx.sh/ns/pkg"}');
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    // Two aliases to the same real subtree: a naive walk emits pkg.json three
    // times (p/ns, p/alias1, p/alias2); the visited-set walk emits it once.
    await symlink(join(root, "p/ns"), join(root, "p/alias1"));
    await symlink(join(root, "p/ns"), join(root, "p/alias2"));

    const files = await readDirectoryTree(root);

    const copies = [...files.values()].filter((bytes) => bytesEqual(bytes, pkgBytes));
    expect(copies).toHaveLength(1);
  });
});

describe("readDirectoryTree — dangling symlink tolerance (C-402)", () => {
  it("skips a dangling symlink under p/ and still reads the rest of the tree", async () => {
    const root = await tempDir("catalog-path-dangling-");
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    // A symlink whose target does not exist — realpath throws ENOENT.
    await symlink(join(root, "p/ns/does-not-exist"), join(root, "p/ns/dangling.json"));

    const files = await readDirectoryTree(root);

    expect(files.has("p/ns/pkg.json")).toBe(true);
    expect(files.has("p/ns/dangling.json")).toBe(false);
  });

  it("rethrows a non-ENOENT realpath error walking p/ (ELOOP from a mutual symlink loop), never swallows it like a dangling link", async () => {
    const root = await tempDir("catalog-path-eloop-");
    await mkdir(join(root, "p"), { recursive: true });
    // Two symlinks pointing at each other — realpath resolution never
    // terminates and the OS returns ELOOP, a non-ENOENT error the walk must
    // propagate rather than treat as an absent entry.
    await symlink("b", join(root, "p", "a"));
    await symlink("a", join(root, "p", "b"));

    await expect(readDirectoryTree(root)).rejects.toMatchObject({ code: "ELOOP" });
  });
});

describe("readDirectoryTree — p/ extension allowlist (C-403)", () => {
  it("keeps every wire asset extension (json/md/svg/png) and drops anything else under p/", async () => {
    const root = await tempDir("catalog-path-ext-");
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    await put(root, "p/ns/pkg/o/sha256/aaaa.json", "{}");
    await put(root, "p/ns/pkg/o/sha256/bbbb.md", "# readme");
    await put(root, "p/ns/pkg/o/sha256/cccc.svg", "<svg/>");
    await put(root, "p/ns/pkg/o/sha256/dddd.png", "PNG");
    // Hostile/irrelevant content a full-checkout source could carry under p/.
    await put(root, "p/ns/pkg/o/sha256/evil.html", "<script>alert(1)</script>");
    await put(root, "p/ns/evil.js", "alert(1)");

    const files = await readDirectoryTree(root);

    expect(new Set(files.keys())).toEqual(
      new Set([
        "p/ns/pkg.json",
        "p/ns/pkg/o/sha256/aaaa.json",
        "p/ns/pkg/o/sha256/bbbb.md",
        "p/ns/pkg/o/sha256/cccc.svg",
        "p/ns/pkg/o/sha256/dddd.png",
      ]),
    );
  });

  it("drops an extensionless file under p/ (no wire extension at all)", async () => {
    const root = await tempDir("catalog-path-noext-");
    await put(root, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    await put(root, "p/ns/LICENSE", "MIT");

    const files = await readDirectoryTree(root);

    expect(files.has("p/ns/pkg.json")).toBe(true);
    expect(files.has("p/ns/LICENSE")).toBe(false);
  });
});

describe("resolveContainedRealPath", () => {
  it("returns the verified absolute path when relativeValue stays inside root", async () => {
    const root = await tempDir("catalog-path-contained-");
    await mkdir(join(root, "sub"), { recursive: true });

    const resolved = await resolveContainedRealPath(root, "sub");

    expect(resolved).toBe(join(root, "sub"));
  });

  it("throws PATH_ESCAPE when relativeValue's realpath resolves outside root", async () => {
    const base = await tempDir("catalog-path-contained-escape-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(root, "escaped"));

    await expect(resolveContainedRealPath(root, "escaped")).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });
});

describe("readPathSource — end-to-end via a PathSourceEntry", () => {
  it("resolves entry.path against configDir and reads it as a filtered wire tree", async () => {
    const configDir = await tempDir("catalog-path-entry-");
    await put(configDir, "packages/config.json", '{"format_version":1}');
    await put(configDir, "packages/p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    await put(configDir, "packages/.git/HEAD", "ref: refs/heads/main\n");

    const files = await readPathSource({ path: "packages" }, configDir);

    expect(new Set(files.keys())).toEqual(new Set(["config.json", "p/ns/pkg.json"]));
  });

  it("throws PATH_ESCAPE naming entry.path when the resolved directory is a symlink escaping configDir", async () => {
    const configDir = await tempDir("catalog-path-entry-escape-");
    const outside = await tempDir("catalog-path-entry-escape-outside-");
    await put(outside, "config.json", '{"format_version":1}');
    await symlink(outside, join(configDir, "escaped"));

    let error: SourceError | undefined;
    try {
      await readPathSource({ path: "escaped" }, configDir);
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("PATH_ESCAPE");
    expect(error?.message).toContain("escaped");
  });
});
