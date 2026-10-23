/**
 * D-144 security: `catalog.config.json` may come from a fork PR, and `css` is
 * bundled with whatever its `@import`/`url()` graph reaches. A real build must
 * refuse (exit 65, naming the file, no output) any file of that graph that
 * does not realpath inside the config directory, and a `css` that is not a
 * regular file.
 */
import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, runBuild, type Project } from "./helpers.js";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

/** A project whose `theme/site.css` is `css`; `project.root` (outside the config directory) holds `outside.png` and `outside.css`. */
async function withCss(css: string): Promise<Project> {
  const project = await createProject({ css: "./theme/site.css" }, { "theme/site.css": css, "theme/inside.png": "x" });
  projects.push(project);
  await writeFile(join(project.root, "outside.png"), "secret");
  await writeFile(join(project.root, "outside.css"), ".outside{color:red}");
  return project;
}

/** `<root>/node_modules/pkg/x.css`: a package hoisted above the config directory (`<root>/proj`), as a monorepo install does. */
async function hoistedPackage(root: string): Promise<void> {
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "pkg", "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" }));
  await writeFile(join(root, "node_modules", "pkg", "x.css"), ".from-pkg{color:red}");
}

/** Every bundled stylesheet of a built site, concatenated. */
async function bundledCss(out: string): Promise<string> {
  const files = (await readdir(join(out, "_astro"))).filter((name) => name.endsWith(".css"));
  return (await Promise.all(files.map((name) => readFile(join(out, "_astro", name), "utf8")))).join("\n");
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("D-144 the consumer stylesheet's graph stays inside the config directory", () => {
  it.each([
    ["url() climbing out", ".a{background:url(../../outside.png)}", "outside.png"],
    ["@import climbing out", '@import "../../outside.css";\n.a{color:red}', "outside.css"],
    ["@import url() climbing out", '@import url("../../outside.css");', "outside.css"],
    ["image-set() climbing out", '.a{background:image-set("../../outside.png" 1x)}', "outside.png"],
  ])("D-144 %s is refused with exit 65, naming the file, and nothing is published", async (_name, css, file) => {
    const project = await withCss(css);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.root, file));
    expect(result.stderr).toContain("outside the config directory");
    expect(await exists(project.out)).toBe(false);
  });

  it("D-144 a symlink inside the config directory that points out is refused, as a url() target", async () => {
    const project = await withCss(".a{background:url(./link.png)}");
    await symlink(join(project.root, "outside.png"), join(project.dir, "theme", "link.png"));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.dir, "theme", "link.png"));
    expect(result.stderr).toContain(join(project.root, "outside.png"));
  });

  it("D-144 a symlink inside the config directory that points out is refused, as an @import", async () => {
    const project = await withCss('@import "./linked.css";');
    await symlink(join(project.root, "outside.css"), join(project.dir, "theme", "linked.css"));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.root, "outside.css"));
  });

  it("D-144 the stylesheet itself being a symlink that points out is refused", async () => {
    const project = await withCss("");
    await symlink(join(project.root, "outside.css"), join(project.dir, "theme", "escape.css"));
    await writeFile(project.config, JSON.stringify({ sources: [{ path: "./index", root: true }], brand: { title: "Accept" }, css: "./theme/escape.css" }));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.root, "outside.css"));
  });

  it("D-144 a graph that stays inside the config directory, @import chain and url() included, builds", async () => {
    const project = await withCss('@import "./nested/more.css";\n.a{background:url(./inside.png)}');
    await mkdir(join(project.dir, "theme", "nested"), { recursive: true });
    await writeFile(join(project.dir, "theme", "nested", "more.css"), ".b{background:url(../inside.png)}");

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
  });

  it.each([
    ["an absolute url()", (root: string) => `.a{background:url(${root}/outside.png)}`],
    ["a /@fs url()", (root: string) => `.a{background:url(/@fs${root}/outside.png)}`],
    ["a CSS-escaped url() climbing out", () => String.raw`.a{background:url(..\/..\/outside.png)}`],
    ["a url() climbing out in escaped dots", () => String.raw`.a{background:url(.\./.\./outside.png)}`],
  ])("D-144 %s that Vite reads off the filesystem is refused with exit 65, and nothing is published", async (_name, css) => {
    const project = await withCss("");
    await writeFile(join(project.dir, "theme", "site.css"), css(project.root));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.root, "outside.png"));
    expect(await exists(project.out)).toBe(false);
  });

  it("D-144 a root-relative url() naming a file of the build's own scratch root is refused with exit 65", async () => {
    const project = await withCss(".a{background:url(/site.json)}");

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("site.json");
    expect(result.stderr).toContain("outside the config directory");
  });

  it("D-144 a root-relative url() naming a publicDir file builds, and stays a URL", async () => {
    const project = await createProject(
      { css: "./theme/site.css", publicDir: "./public" },
      { "theme/site.css": ".a{background:url(/fonts/x.woff2)}", "public/fonts/x.woff2": "font" },
    );
    projects.push(project);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
    expect(await bundledCss(project.out)).toContain("url(/fonts/x.woff2)");
  });

  it("D-144 a bare @import of a package hoisted above the config directory builds, as 0.5.3 did", async () => {
    const project = await withCss('@import "pkg/x.css";');
    await hoistedPackage(project.root);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
    expect(await bundledCss(project.out)).toContain(".from-pkg");
  });

  it("D-144 a relative @import into that same hoisted node_modules is refused with exit 65", async () => {
    const project = await withCss('@import "../../node_modules/pkg/x.css";');
    await hoistedPackage(project.root);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.root, "node_modules", "pkg", "x.css"));
  });

  it("D-144 a bare @import of a node_modules package that is a symlink pointing outside every node_modules is refused with exit 65", async () => {
    const project = await withCss('@import "pkg/x.css";');
    await mkdir(join(project.root, "elsewhere", "pkg"), { recursive: true });
    await writeFile(join(project.root, "elsewhere", "pkg", "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" }));
    await writeFile(join(project.root, "elsewhere", "pkg", "x.css"), ".from-pkg{color:red}");
    await mkdir(join(project.root, "node_modules"));
    await symlink(join(project.root, "elsewhere", "pkg"), join(project.root, "node_modules", "pkg"));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(`(resolves to "${join(project.root, "elsewhere", "pkg")}")`);
  });

  it.each(["pkg/../../../tmp/x.css", "pkg/../.cache/x.css"])(
    "D-144 a bare @import of %s, which climbs out of the package it names, is refused with exit 65, not a render failure",
    async (spec) => {
      const project = await withCss(`@import "${spec}";`);
      await hoistedPackage(project.root);

      const result = await runBuild(project.config, project.out);

      expect(result.code, result.stderr).toBe(65);
      expect(result.stderr).toContain(`css "${spec}"`);
      expect(result.stderr).toContain("climbs out of the package it names");
    },
  );

  it("D-144 a url() that cannot be resolved (a symlink loop) is a data error naming the file, not a render failure", async () => {
    const project = await withCss(".a{background:url(./loop-a)}");
    await symlink(join(project.dir, "theme", "loop-b"), join(project.dir, "theme", "loop-a"));
    await symlink(join(project.dir, "theme", "loop-a"), join(project.dir, "theme", "loop-b"));

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain(join(project.dir, "theme", "loop-a"));
  });

  it("D-144 a css that is a directory is refused with exit 65", async () => {
    const project = await createProject({ css: "./theme" }, { "theme/site.css": "" });
    projects.push(project);

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain('css "./theme" is not a regular file');
  });
});
