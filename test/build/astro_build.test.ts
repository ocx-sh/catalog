import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "./helpers.js";

/*
 * The shipped entrypoint, end to end: the compiled `ocx-catalog` CLI -> `buildCatalog` ->
 * a real Astro child over the packaged route entrypoints (`dist/site/pages/*.astro`).
 * Everything else in `engine.test.ts` injects the child; this is the proof that the
 * injected-route paths, the generated `astro.config.mjs`, the single `site.json`, the
 * staging dir and the promotion work against real Astro (C-007, C-038, C-045, S-001).
 *
 * The working directory is a fresh dir under `node_modules/.cache/` so the scratch root's
 * ancestry reaches this checkout's `node_modules` the way a consumer's does, whatever
 * the vitest cwd is.
 */

const FIXTURES = join(repoRoot, "test", "fixtures", "site");
const CLI = join(repoRoot, "dist", "cli", "index.js");

let cwd: string;
let outDir: string;
let run: { status: number | null; stdout: string; stderr: string };

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  const cache = join(repoRoot, "node_modules", ".cache", "ocx-catalog-tests");
  await mkdir(cache, { recursive: true });
  cwd = await mkdtemp(join(cache, "astro-build-"));
  await cp(FIXTURES, join(cwd, "site"), { recursive: true });
  outDir = join(cwd, "dist");
  await mkdir(outDir);
  await writeFile(join(outDir, "stale.txt"), "from the previous build");
  const result = spawnSync(process.execPath, [CLI, "build", "--config", join(cwd, "site", "root.config.json"), "--out", outDir], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  run = { status: result.status, stdout: result.stdout, stderr: result.stderr };
}, 180_000);

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("ocx-catalog build against real Astro", () => {
  it("exits 0 and relays the child's output on stderr with the ocx-catalog prefix", () => {
    expect(run.status, run.stderr).toBe(0);
    // C-046: the relay goes to stderr so stdout stays clean for callers.
    // Astro colours its log under CI/GITHUB_ACTIONS; the relay forwards that faithfully, so compare plain text.
    const stderr = stripVTControlCharacters(run.stderr);
    expect(stderr).toContain("ocx-catalog: ");
    expect(stderr).toMatch(/ocx-catalog: .*\[build\] Complete!/);
  });

  it("writes the pages, the sitemap and the consumer's static layer into outDir", async () => {
    for (const file of ["index.html", "404.html", "sitemap-index.xml", "_headers", "favicon.svg", join("data", "catalog", "catalog.json")]) {
      expect(await exists(join(outDir, file)), file).toBe(true);
    }
    expect(await exists(join(outDir, "tools", "modern", "index.html"))).toBe(true);
  });

  it("lets the consumer's robots.txt win over the generated default", async () => {
    expect(await readFile(join(outDir, "robots.txt"), "utf8")).toBe(
      await readFile(join(FIXTURES, "public-fixture", "robots.txt"), "utf8"),
    );
  });

  it("replaced the previous output and left no staging, retired, prerender or scratch residue", async () => {
    expect(await exists(join(outDir, "stale.txt"))).toBe(false);
    expect(await exists(join(outDir, ".prerender"))).toBe(false);
    // `.ocx-catalog` is the scratch base (no node_modules in this cwd); it must hold no root.
    expect((await readdir(cwd)).sort()).toEqual([".ocx-catalog", "dist", "site"]);
    expect(await readdir(join(cwd, ".ocx-catalog"))).toEqual([]);
    expect(await exists(join(cwd, ".astro"))).toBe(false);
  });
});
