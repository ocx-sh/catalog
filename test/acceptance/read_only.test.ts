/**
 * C-007 read-only build, through the CLI: a build writes only its `outDir` (its
 * staging/retired siblings and the scratch root being gone by exit), the temp
 * dir the process was given stays empty (the git clone's `mkdtemp` directory is
 * removed), the working directory gains nothing, and the source trees are
 * byte-identical afterwards. A `path` source and a `file://` `git` source are
 * both exercised, each with a fresh `TMPDIR`.
 *
 * No `url` source here: the url fetch cache (`<cache>/url/…`) is the one thing
 * a build may leave behind, and a `url` source needs an HTTP index server this
 * harness does not run. The cache lives under the real `node_modules/.cache`
 * (see helpers.ts), so a "fresh cache dir" is not available for it either.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliCwd, FIXTURE_DIR, fixtureConfig, leftoverScratch, listTree, runBuild, treeHash } from "./helpers.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

/**
 * Node's own module compile cache (`$TMPDIR/node-compile-cache`, enabled by the
 * astro/vite toolchain) is the one write outside C-007's list; the runtime, not
 * this package, decides it. It is switched off here so the "TMPDIR stays empty"
 * assertion covers everything else.
 */
const NO_COMPILE_CACHE = { NODE_DISABLE_COMPILE_CACHE: "1" };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=A", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });

describe("C-007 a build writes only outDir", () => {
  it("path source (root fixture): sources untouched, TMPDIR empty, cwd unchanged, only out remains", async () => {
    const work = await tempDir("accept-ro-path-");
    const tmp = await tempDir("accept-ro-tmp-");
    const out = join(work, "out");
    const trees = ["index-a", "docs-fixture", "public-fixture"].map((name) => join(FIXTURE_DIR, name));
    const before = await Promise.all([...trees.map((tree) => treeHash(tree)), readFile(fixtureConfig("root"), "utf8")]);
    const cwdBefore = await readdir(cliCwd());

    const result = await runBuild(fixtureConfig("root"), out, { env: { TMPDIR: tmp, ...NO_COMPILE_CACHE } });

    expect(result.code, result.stderr).toBe(0);
    expect(await readdir(work)).toEqual(["out"]);
    expect(await readdir(tmp)).toEqual([]);
    expect(await readdir(cliCwd())).toEqual(cwdBefore);
    expect(await leftoverScratch(result.pid)).toEqual([]);
    expect(await Promise.all([...trees.map((tree) => treeHash(tree)), readFile(fixtureConfig("root"), "utf8")])).toEqual(before);
  });

  it("file:// git source: the clone directory is gone, the repository is byte-identical, only out remains", async () => {
    const work = await tempDir("accept-ro-git-");
    const tmp = await tempDir("accept-ro-gittmp-");
    const repo = join(work, "repo");
    await cp(join(FIXTURE_DIR, "index-a"), repo, { recursive: true });
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "wire tree");
    const project = join(work, "proj");
    await mkdir(project);
    const config = join(project, "catalog.config.json");
    await writeFile(
      config,
      JSON.stringify({ sources: [{ git: `file://${repo}`, root: true }], brand: { title: "Git", wordmark: "git.ocx.test" } }),
    );
    const out = join(project, "out");
    const repoBefore = await treeHash(repo);
    const cwdBefore = await readdir(cliCwd());

    const result = await runBuild(config, out, { env: { TMPDIR: tmp, ...NO_COMPILE_CACHE } });

    expect(result.code, result.stderr).toBe(0);
    expect((await listTree(out)).filter((path) => path.endsWith("/index.html")).length).toBeGreaterThanOrEqual(24);
    expect((await readdir(project)).sort()).toEqual(["catalog.config.json", "out"]);
    expect(await readdir(tmp)).toEqual([]);
    expect(await readdir(cliCwd())).toEqual(cwdBefore);
    expect(await leftoverScratch(result.pid)).toEqual([]);
    expect(await treeHash(repo)).toBe(repoBefore);
  });
});
