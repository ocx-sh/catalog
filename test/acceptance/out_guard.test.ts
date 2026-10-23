/**
 * C-036 / S-001 output guard through the CLI: `--out` (after `realpath`) that
 * equals or contains the config dir, a source root, `docs`, `css`, `publicDir`
 * or the `brand.logo` file, or lies inside `docs`/`publicDir`, is refused with
 * `OUT_DIR_OVERLAPS_INPUT` (exit 65) before anything is written — a symlinked
 * `--out` included. The control build proves the same project builds elsewhere.
 */
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, listEntries, listTree, runBuild, treeHash, type Project } from "./helpers.js";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

async function guardedProject(): Promise<Project> {
  const project = await createProject(
    {
      docs: "./docs",
      css: "./site.css",
      publicDir: "./public",
      brand: { title: "Guard", wordmark: "guard.ocx.test", logo: "./brand/logo.svg" },
    },
    {
      "docs/start.md": "---\ntitle: Start\n---\nhello\n",
      "site.css": "body{}\n",
      "public/favicon.svg": "<svg/>",
      "brand/logo.svg": "<svg/>",
    },
  );
  projects.push(project);
  return project;
}

describe("C-036 --out overlapping an input", () => {
  it.each([
    ["the config directory", (p: Project) => p.dir],
    ["a directory containing the config directory", (p: Project) => p.root],
    ["a path source root", (p: Project) => join(p.dir, "index")],
    ["docs", (p: Project) => join(p.dir, "docs")],
    ["a directory inside docs", (p: Project) => join(p.dir, "docs/out")],
    ["the css file", (p: Project) => join(p.dir, "site.css")],
    ["publicDir", (p: Project) => join(p.dir, "public")],
    ["a directory inside publicDir", (p: Project) => join(p.dir, "public/out")],
    ["the brand.logo file", (p: Project) => join(p.dir, "brand/logo.svg")],
    ["a directory containing the brand.logo file", (p: Project) => join(p.dir, "brand")],
  ])("%s is refused with exit 65 and nothing is written", async (_name, outFor) => {
    const project = await guardedProject();
    const before = { entries: await listEntries(project.root), hash: await treeHash(project.root) };

    const result = await runBuild(project.config, outFor(project));

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("overlaps");
    expect(await listEntries(project.root)).toEqual(before.entries);
    expect(await treeHash(project.root)).toBe(before.hash);
  });

  it("a symlinked --out that resolves onto the config directory is refused", async () => {
    const project = await guardedProject();
    const link = join(project.root, "link-to-proj");
    await symlink(project.dir, link);
    const before = await treeHash(project.root);

    const result = await runBuild(project.config, link);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("overlaps");
    expect(await treeHash(project.root)).toBe(before);
  });

  it("control: the same project builds into a directory beside it", async () => {
    const project = await guardedProject();

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
    expect(await listTree(project.out)).toContain("index.html");
  });
});
