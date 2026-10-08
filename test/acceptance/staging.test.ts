/**
 * C-038 no partial output, through the CLI: a failure in assembly, render or
 * promotion leaves the previous `outDir` byte-unchanged (or absent, when there
 * was none), removes the staging/retired siblings, and leaves no scratch root
 * behind; a successful build replaces the previous tree whole.
 *
 * The render and promotion failures are planted into the real CLI run through a
 * `NODE_OPTIONS=--require` preload (`plantedFailure`), so the code under test
 * is the shipped engine, not a double.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLI_ENTRY,
  cliCwd,
  createProject,
  leftoverScratch,
  listEntries,
  listTree,
  plantedFailure,
  runBuild,
  treeHash,
  type CliResult,
  type Project,
} from "./helpers.js";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

async function stage(extra: Record<string, unknown> = {}): Promise<Project> {
  const project = await createProject(extra);
  projects.push(project);
  return project;
}

/** Puts a recognisable "previous build" at `out`. */
async function plantPreviousBuild(out: string): Promise<void> {
  await mkdir(join(out, "nested"), { recursive: true });
  await writeFile(join(out, "PREVIOUS.txt"), "previous build\n");
  await writeFile(join(out, "nested/page.html"), "<p>previous</p>\n");
}

/** Everything next to `out` other than `out` itself and the project: staging/retired leftovers. */
async function siblingsOf(project: Project): Promise<string[]> {
  return (await readdir(project.root)).filter((name) => name !== "proj" && name !== "out").sort();
}

const failures: readonly [name: string, exit: number, run: (project: Project) => Promise<CliResult>, message: string][] = [
  [
    "assembly (a favicon that resolves to no file)",
    65,
    async (project) => {
      await writeFile(project.config, JSON.stringify({ sources: [{ path: "./index", root: true }], brand: { title: "T", wordmark: "t" }, favicon: "/missing.svg" }));
      return runBuild(project.config, project.out);
    },
    "favicon",
  ],
  ["render (the astro child exits non-zero)", 1, (project) => runBuild(project.config, project.out, { env: plantedFailure("render", project.out) }), "planted astro failure"],
  ["promotion (the staging -> outDir rename throws)", 1, (project) => runBuild(project.config, project.out, { env: plantedFailure("promotion", project.out) }), "planted promotion failure"],
];

describe("C-038 a failed build leaves the previous output alone", () => {
  it.each(failures)("%s: previous outDir byte-unchanged, no staging, no scratch", async (_name, exit, run, message) => {
    const project = await stage();
    await plantPreviousBuild(project.out);
    const before = await treeHash(project.out);

    const result = await run(project);

    expect(result.code, result.stderr).toBe(exit);
    expect(result.stderr).toContain(message);
    expect(await treeHash(project.out)).toBe(before);
    expect(await listEntries(project.out)).toEqual(["PREVIOUS.txt", "nested", "nested/page.html"]);
    expect(await siblingsOf(project)).toEqual([]);
    expect(await leftoverScratch(result.pid)).toEqual([]);
  });

  it.each(failures)("%s, with no previous build: outDir is never created", async (_name, exit, run, message) => {
    const project = await stage();

    const result = await run(project);

    expect(result.code, result.stderr).toBe(exit);
    expect(result.stderr).toContain(message);
    expect(await readdir(project.root)).toEqual(["proj"]);
    expect(await leftoverScratch(result.pid)).toEqual([]);
  });
});

describe("C-038 a successful build replaces the previous output whole", () => {
  it("drops the old files, promotes the new tree, leaves no sibling", async () => {
    const project = await stage();
    await plantPreviousBuild(project.out);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
    const files = await listTree(project.out);
    expect(files).toContain("index.html");
    expect(files).not.toContain("PREVIOUS.txt");
    expect(files).not.toContain("nested/page.html");
    expect(await readFile(join(project.out, "index.html"), "utf8")).toContain("<html");
    expect(await siblingsOf(project)).toEqual([]);
    expect(await leftoverScratch(result.pid)).toEqual([]);
  });
});

describe("C-046 a signal mid-build", () => {
  it("SIGINT once the scratch root exists: the CLI dies by SIGINT, the previous output is intact and no scratch root or sibling is left", async () => {
    const project = await stage();
    await plantPreviousBuild(project.out);
    const before = await treeHash(project.out);

    const child = spawn(process.execPath, [CLI_ENTRY, "build", "--config", project.config, "--out", project.out], {
      cwd: cliCwd(),
      stdio: "ignore",
    });
    const pid = child.pid as number;
    const ended = new Promise<[number | null, NodeJS.Signals | null]>((done) => child.once("close", (code, signal) => done([code, signal])));
    while ((await leftoverScratch(pid)).length === 0) await new Promise((tick) => setTimeout(tick, 10));
    child.kill("SIGINT");

    expect(await ended).toEqual([null, "SIGINT"]);
    expect(await treeHash(project.out)).toBe(before);
    expect(await siblingsOf(project)).toEqual([]);
    expect(await leftoverScratch(pid)).toEqual([]);
  });
});
