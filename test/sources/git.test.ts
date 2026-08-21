/**
 * Spec tests for `src/sources/git.ts` (`readGitSource`, C-003c) — real local
 * git repositories in temp dirs, no network. MUST fail against the
 * `throw new Error("not implemented")` stub.
 *
 * ENVIRONMENT FINDING (reported to the swarm lead, not invented away):
 * the assignment's suggested `GIT_SHA_UNSUPPORTED` simulation — "point at a
 * repo with uploadpack.allowReachableSHA1InWant off" — does NOT reproduce
 * the condition for a LOCAL filesystem-path remote. Verified empirically:
 * `git fetch --depth 1 origin <sha>` against a local path remote with
 * `uploadpack.allowReachableSHA1InWant=false` and
 * `uploadpack.allowTipSHA1InWant=false` set on the source repo still
 * succeeds — git's local-transport optimization copies objects directly and
 * never negotiates through upload-pack, so that restriction (a smart-
 * protocol-only guard) never engages. A `git://` daemon transport WOULD
 * engage it, but `git daemon` is not available in this environment ("git:
 * 'daemon' is not a git command"). No test for `GIT_SHA_UNSUPPORTED`
 * follows from this; it needs either a real smart-protocol-capable git
 * server in CI, or unit-level coverage of the stderr-pattern-match at
 * implement time instead of a black-box fixture.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/sources/types.js";
import { fileExists, readGitSource } from "../../src/sources/git.js";
import { bytesEqual, utf8 } from "./helpers.js";

const cleanupDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Writes `text` at `dir/relPath`, creating parent directories. */
async function put(dir: string, relPath: string, text: string): Promise<void> {
  const full = join(dir, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, text, "utf8");
}

async function initRepo(dir: string): Promise<void> {
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
}

function commitAll(dir: string, message: string): string {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD").trim();
}

async function readOptions(): Promise<{ warn: ReturnType<typeof vi.fn>; tmpDir: string }> {
  return { warn: vi.fn(), tmpDir: await tempDir("catalog-git-scratch-") };
}

describe("readGitSource — branch/tag ref (shallow clone path)", () => {
  it("clones a branch ref and reads its wire tree", async () => {
    const srcDir = await tempDir("catalog-git-src-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", '{"format_version":1}');
    await put(srcDir, "p/ns/main-pkg.json", '{"name":"ocx.sh/ns/main-pkg"}');
    commitAll(srcDir, "on main");
    git(srcDir, "checkout", "-qb", "feature");
    await put(srcDir, "p/ns/feature-pkg.json", '{"name":"ocx.sh/ns/feature-pkg"}');
    commitAll(srcDir, "on feature");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, ref: "feature" }, options);

    expect(new Set(files.keys())).toEqual(new Set(["config.json", "p/ns/main-pkg.json", "p/ns/feature-pkg.json"]));
    expect(bytesEqual(files.get("p/ns/feature-pkg.json")!, utf8('{"name":"ocx.sh/ns/feature-pkg"}'))).toBe(true);
  });

  it("clones a tag ref and reads its wire tree", async () => {
    const srcDir = await tempDir("catalog-git-src-tag-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", '{"format_version":1}');
    await put(srcDir, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    commitAll(srcDir, "tagged commit");
    git(srcDir, "tag", "v1.0.0");
    // A later commit the tag must NOT include.
    await put(srcDir, "p/ns/later.json", '{"name":"ocx.sh/ns/later"}');
    commitAll(srcDir, "later commit");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, ref: "v1.0.0" }, options);

    expect(files.has("p/ns/pkg.json")).toBe(true);
    expect(files.has("p/ns/later.json")).toBe(false);
  });
});

describe("readGitSource — commit-SHA ref (init+fetch path)", () => {
  it("fetches and checks out an exact commit SHA, not the branch tip", async () => {
    const srcDir = await tempDir("catalog-git-src-sha-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", '{"format_version":1}');
    await put(srcDir, "p/ns/first.json", '{"name":"ocx.sh/ns/first"}');
    const firstSha = commitAll(srcDir, "first");
    await put(srcDir, "p/ns/second.json", '{"name":"ocx.sh/ns/second"}');
    commitAll(srcDir, "second");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, ref: firstSha }, options);

    expect(files.has("p/ns/first.json")).toBe(true);
    expect(files.has("p/ns/second.json")).toBe(false);
  });

  it("accepts a short (7-char) SHA prefix per the fullmatch 7-40 hex rule", async () => {
    const srcDir = await tempDir("catalog-git-src-shortsha-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", '{"format_version":1}');
    await put(srcDir, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    const sha = commitAll(srcDir, "one");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, ref: sha.slice(0, 7) }, options);

    expect(files.has("p/ns/pkg.json")).toBe(true);
  });
});

describe("readGitSource — dir subpath", () => {
  it("honors entry.dir, reading only that subtree as the wire root", async () => {
    const srcDir = await tempDir("catalog-git-src-dir-");
    await initRepo(srcDir);
    await put(srcDir, "unrelated-top-level.txt", "not part of the index\n");
    await put(srcDir, "sub/config.json", '{"format_version":1}');
    await put(srcDir, "sub/p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    commitAll(srcDir, "one");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, dir: "sub" }, options);

    expect(new Set(files.keys())).toEqual(new Set(["config.json", "p/ns/pkg.json"]));
  });

  it("rejects a dir value that escapes the clone root (PATH_ESCAPE)", async () => {
    const srcDir = await tempDir("catalog-git-src-dir-escape-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    commitAll(srcDir, "one");

    const options = await readOptions();

    await expect(readGitSource({ git: srcDir, dir: "../escape" }, options)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });
});

describe("readGitSource — .gitmodules (submodules are a non-goal)", () => {
  it("warns naming .gitmodules, but still returns the rest of the wire tree", async () => {
    const srcDir = await tempDir("catalog-git-src-submodule-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", '{"format_version":1}');
    await put(srcDir, "p/ns/pkg.json", '{"name":"ocx.sh/ns/pkg"}');
    await put(srcDir, ".gitmodules", '[submodule "vendor"]\n\tpath = vendor\n\turl = https://example.test/x.git\n');
    commitAll(srcDir, "with submodule config");

    const options = await readOptions();
    const files = await readGitSource({ git: srcDir, ref: "HEAD" }, options);

    expect(options.warn).toHaveBeenCalledTimes(1);
    expect(options.warn.mock.calls[0]?.[0]).toContain(".gitmodules");
    // Submodules non-goal: the file itself is excluded from the wire tree
    // (it isn't wire-shaped anyway), but the rest still comes through.
    expect(files.has(".gitmodules")).toBe(false);
    expect(files.has("p/ns/pkg.json")).toBe(true);
  });

  it("never warns when no .gitmodules is present", async () => {
    const srcDir = await tempDir("catalog-git-src-no-submodule-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    commitAll(srcDir, "one");

    const options = await readOptions();
    await readGitSource({ git: srcDir, ref: "HEAD" }, options);

    expect(options.warn).not.toHaveBeenCalled();
  });
});

describe("readGitSource — Git LFS pointer rejection", () => {
  it("throws LFS_POINTER naming the file when a sourced blob is an LFS pointer, not real content", async () => {
    const srcDir = await tempDir("catalog-git-src-lfs-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    const pointer = [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${"a".repeat(64)}`,
      "size 123456",
      "",
    ].join("\n");
    await put(srcDir, `p/ns/pkg/o/sha256/${"b".repeat(64)}.png`, pointer);
    commitAll(srcDir, "lfs pointer committed instead of real object");

    const options = await readOptions();

    let error: SourceError | undefined;
    try {
      await readGitSource({ git: srcDir, ref: "HEAD" }, options);
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("LFS_POINTER");
    expect(error?.message).toContain(`p/ns/pkg/o/sha256/${"b".repeat(64)}.png`);
  });
});

describe("readGitSource — no shell interpolation of ref (array-arg invocation)", () => {
  it("a ref carrying a shell metacharacter injection attempt never executes, and the clone fails safely", async () => {
    const srcDir = await tempDir("catalog-git-src-inject-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    commitAll(srcDir, "one");

    const markerDir = await tempDir("catalog-git-inject-marker-");
    const markerFile = join(markerDir, "pwned");
    const maliciousRef = `main; touch ${markerFile}`;

    const options = await readOptions();

    await expect(readGitSource({ git: srcDir, ref: maliciousRef }, options)).rejects.toBeInstanceOf(Error);
    // If the implementation ever built a shell command string instead of
    // invoking git with array args, the injected `touch` would have run.
    expect(existsSync(markerFile)).toBe(false);
  });
});

describe("readGitSource — argument injection (HIGH C, security panel 2026-08-22)", () => {
  it("rejects a git URL starting with '-' before any git invocation (PATH_ESCAPE)", async () => {
    const options = await readOptions();

    await expect(readGitSource({ git: "--upload-pack=touch /tmp/pwned-git" }, options)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });

  it("rejects a ref starting with '-' before any git invocation (PATH_ESCAPE)", async () => {
    const srcDir = await tempDir("catalog-git-src-refdash-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    commitAll(srcDir, "one");

    const options = await readOptions();

    await expect(
      readGitSource({ git: srcDir, ref: "--upload-pack=touch /tmp/pwned-ref" }, options),
    ).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });

  it("rejects a dir starting with '-' before any git invocation (PATH_ESCAPE)", async () => {
    const srcDir = await tempDir("catalog-git-src-dirdash-");
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    commitAll(srcDir, "one");

    const options = await readOptions();

    await expect(readGitSource({ git: srcDir, dir: "--upload-pack=x" }, options)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
  });

  it("a malicious git URL shaped as an --upload-pack option never reaches git, and no side effect occurs", async () => {
    const markerDir = await tempDir("catalog-git-inject-marker-");
    const markerFile = join(markerDir, "pwned-upload-pack");
    const maliciousGit = `--upload-pack=touch ${markerFile};`;

    const options = await readOptions();

    await expect(readGitSource({ git: maliciousGit }, options)).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });
    expect(existsSync(markerFile)).toBe(false);
  });

  it("clones from a path containing '--' mid-value via the end-of-options separator wired into every runGit call", async () => {
    // Not leading "-", so `assertNotOptionLike` allows it through — this
    // exercises the literal `--` end-of-options separator now inserted
    // before the positional in every `runGit` invocation (clone, remote add,
    // fetch, ls-remote), proving it doesn't break a realistic legitimate
    // value that happens to contain "--".
    const container = await tempDir("catalog-git-container-");
    const srcDir = join(container, "repo--with--dashes");
    await mkdir(srcDir);
    await initRepo(srcDir);
    await put(srcDir, "config.json", "{}");
    const sha = commitAll(srcDir, "one");

    const options = await readOptions();
    expect((await readGitSource({ git: srcDir, ref: "HEAD" }, options)).has("config.json")).toBe(true);
    expect((await readGitSource({ git: srcDir, ref: sha }, options)).has("config.json")).toBe(true);
  });
});

describe("fileExists — non-ENOENT stat failures are never treated as merely absent", () => {
  it("rethrows a permission-denied stat (EACCES), never silently returns false", async () => {
    const base = await tempDir("catalog-git-fileexists-eacces-");
    const sub = join(base, "sub");
    await mkdir(sub);
    await writeFile(join(sub, ".gitmodules"), "x");
    await chmod(sub, 0o000);

    try {
      await expect(fileExists(join(sub, ".gitmodules"))).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      // Restore access so this test's own `afterEach` cleanup (`rm -rf`)
      // can actually remove `sub`.
      await chmod(sub, 0o700);
    }
  });

  it("returns false (never throws) for a genuinely absent file (ENOENT)", async () => {
    const base = await tempDir("catalog-git-fileexists-enoent-");
    await expect(fileExists(join(base, "nope"))).resolves.toBe(false);
  });
});
