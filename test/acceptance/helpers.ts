/**
 * Acceptance harness contract (plan step E.8).
 *
 * Acceptance suites assert on REAL builds: the shipped CLI
 * (`node dist/cli/index.js build …`, an `astro build` child inside) run as a
 * subprocess over the committed fixture configs. They never import `src/**`
 * build code to render anything.
 *
 * ## Two vitest projects (`vitest.config.ts`)
 *
 *  - `unit`        — everything except `test/acceptance/**`. Astro-free, fast.
 *                    Its `globalSetup` (`test/global-setup.ts`) builds `dist/`.
 *  - `acceptance`  — `test/acceptance/**\/*.test.ts`. Its `globalSetup`
 *                    (`test/acceptance/global-setup.ts`) builds `dist/` (the
 *                    same once-per-run step), then renders the fixture sites.
 *
 * Vitest runs a project's `globalSetup` only when the run selects at least one
 * of its files, so `npx vitest run test/foo.test.ts` never starts an Astro
 * build, while `npx vitest run test/acceptance/<file>` and `npm test` both do.
 *
 * ## Which sites get built
 *
 * Three fixture configs in `test/fixtures/site/`: `root` (base `/`),
 * `rootbase` (the same inputs at base `/catalog/`) and `catalog`
 * (multi-index, `chrome: "ocx"`, base `/catalog/`). `ACCEPT_CONFIG=root`,
 * `ACCEPT_CONFIG=root,catalog`, … restricts the setup to those, so a step
 * builds only what it asserts. Unset builds all three.
 *
 * ## What a suite sees
 *
 *  - `site("root")`     — absolute path of that site's output directory.
 *  - `siteLog("root")`  — `{ code, stdout, stderr }` of the CLI run that made it
 *                         (C-046: the relayed Astro output).
 *  Asking for a site the run did not build THROWS (the suite goes red, with
 *  the `ACCEPT_CONFIG` hint) — a missing build is never a skip.
 *
 * Suites that need their own builds (read-only, out-guard, staging, parity)
 * call `runCli([...])` directly.
 *
 * ## CLI working directory (worktree-safe)
 *
 * `cacheBaseDir()` (src/build/cache_dir.ts) puts the Astro scratch root under
 * `<cwd>/node_modules/.cache/ocx-catalog/`, and the Astro child can only
 * resolve `astro` from a root nested inside a REAL `node_modules` tree (a cwd
 * without one falls back to `<cwd>/.ocx-catalog/` and the build dies with
 * `Cannot resolve entry module astro/entrypoints/prerender`). A pipeline
 * worktree's `node_modules` is a symlink into the main checkout, so
 * `cliCwd()` is `dirname(realpath(<repo>/node_modules))`: the directory that
 * owns the real tree, in the main checkout and in a worktree alike. Nothing is
 * hardcoded; outputs go to temp dirs, never into the repo.
 *
 * ## Tree hashing
 *
 * `treeHash(dir, {exclude})` is the plan's `TREE_HASH`:
 * `(cd dir && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum) | sha256sum`.
 * `normalizeAssetPath` maps `_astro/<name>.<hash>.<ext>` to `_astro/<name>.<ext>`
 * so path sets compare across builds whose content hashes legitimately differ
 * (base `/` vs `/catalog/`).
 */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { JSDOM } from "jsdom";
import { inject } from "vitest";
import { FIXTURE_DIR, REPO_ROOT, scratchBase, type CliResult, type SiteName } from "./cli.js";

export * from "./cli.js";

declare module "vitest" {
  export interface ProvidedContext {
    acceptanceSites: Partial<Record<SiteName, string>>;
    acceptanceLogs: Partial<Record<SiteName, CliResult>>;
  }
}

/** Output directory of a built fixture site; throws when the run did not build it. */
export function site(name: SiteName): string {
  const dir = inject("acceptanceSites")[name];
  if (dir === undefined) {
    throw new Error(
      `acceptance site "${name}" was not built (ACCEPT_CONFIG=${process.env.ACCEPT_CONFIG ?? "<unset>"}); ` +
        `include "${name}" in ACCEPT_CONFIG or unset it`,
    );
  }
  return dir;
}

/** The CLI run that produced `site(name)`. */
export function siteLog(name: SiteName): CliResult {
  site(name);
  return inject("acceptanceLogs")[name]!;
}

/** Parses `<site>/<urlPath>` (`/`, `/a/b/`, or a literal `/404.html`) with jsdom. Scripts never run. */
export async function readHtml(siteDir: string, urlPath: string): Promise<Document> {
  const file = urlPath.endsWith(".html") ? urlPath : posix.join(urlPath, "index.html");
  return new JSDOM(await readFile(join(siteDir, file), "utf8")).window.document;
}

/**
 * C-011: the page's external module scripts as built, each with its JS and that of the chunks it
 * imports statically, plus what the HTML itself hands the browser of the
 * islands: `modulepreload` links and any `catalog.json` reference. The lazy chunks sit behind a
 * dynamic `import()`, so they appear in neither.
 */
export async function pageScripts(
  siteDir: string,
  doc: Document,
  base: string,
): Promise<{ scripts: { src: string; code: string }[]; preloads: number; mentionsCatalog: boolean }> {
  const file = (src: string) => join(siteDir, src.startsWith(base) ? src.slice(base.length) : src);
  const srcs = [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((el) => el.getAttribute("src")!);
  const scripts = await Promise.all(
    srcs.map(async (src) => {
      const own = await readFile(file(src), "utf8");
      const imports = [...own.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]!);
      const chunks = await Promise.all(imports.map((name) => readFile(join(dirname(file(src)), name), "utf8")));
      return { src, code: [own, ...chunks].join("\n") };
    }),
  );
  return {
    scripts,
    preloads: doc.querySelectorAll('link[rel="modulepreload"]').length,
    mentionsCatalog: doc.documentElement.outerHTML.includes("catalog.json"),
  };
}

/** Every regular file under `dir`, as sorted `/`-separated paths relative to it. */
export async function listTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort(compareBytes);
}

const compareBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

export interface TreeHashOptions {
  /** Relative paths (as `listTree` returns them) left out of the hash. */
  readonly exclude?: readonly string[];
}

/** The plan's `TREE_HASH` of `dir` (see the header). */
export async function treeHash(dir: string, options: TreeHashOptions = {}): Promise<string> {
  const skip = new Set(options.exclude ?? []);
  const lines: string[] = [];
  for (const path of await listTree(dir)) {
    if (skip.has(path)) continue;
    const digest = createHash("sha256").update(await readFile(join(dir, path))).digest("hex");
    lines.push(`${digest}  ./${path}\n`);
  }
  return createHash("sha256").update(lines.join("")).digest("hex");
}

// Vite content hashes are 8 characters of [A-Za-z0-9_-]; `.` never occurs in one.
const ASSET_HASH = /^(_astro\/.+)\.[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/;

/** `_astro/<name>.<hash>.<ext>` -> `_astro/<name>.<ext>`; any other path unchanged. */
export const normalizeAssetPath = (path: string): string => path.replace(ASSET_HASH, "$1$2");

/** The route directories of a built site: `<dir>/index.html` pages, the mirror trees excluded. */
export async function htmlRoutes(siteDir: string): Promise<string[]> {
  return (await listTree(siteDir))
    .filter((path) => path.endsWith("/index.html") && !/^(p|index|_astro)\//.test(path))
    .map((path) => path.slice(0, -"/index.html".length));
}

/** Scratch roots (`ocx-catalog-<pid>-*`) a CLI process left behind. */
export async function leftoverScratch(pid: number): Promise<string[]> {
  const entries = await readdir(scratchBase()).catch(() => [] as string[]);
  return entries.filter((name) => name.startsWith(`ocx-catalog-${pid}-`));
}

/** A throwaway project: `<root>/proj/{catalog.config.json,index/}` and an `out` path beside it. */
export interface Project {
  /** Real path of the temp root holding everything (a symlinked TMPDIR cannot confuse path comparisons). */
  readonly root: string;
  readonly dir: string;
  readonly config: string;
  /** `<root>/out`, not created. */
  readonly out: string;
  dispose(): Promise<void>;
}

/**
 * A small project over the `quality-index` wire tree (7 packages, namespaces
 * `acme`, `contrib`, `oxidize`, `sharkdp`; a `path` source must live inside the
 * config directory, so it is copied to `proj/index`). `extra` is merged into
 * the config over `{ sources, brand }`; `files` are written under `proj/`.
 */
export async function createProject(
  extra: Record<string, unknown> = {},
  files: Record<string, string> = {},
): Promise<Project> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ocx-accept-")));
  const dir = join(root, "proj");
  const quality = join(FIXTURE_DIR, "../quality-index");
  await cp(join(quality, "p"), join(dir, "index/p"), { recursive: true });
  await cp(join(quality, "config.json"), join(dir, "index/config.json"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  const config = join(dir, "catalog.config.json");
  await writeFile(
    config,
    JSON.stringify({ sources: [{ path: "./index", root: true }], brand: { title: "Accept", wordmark: "accept.ocx.test" }, ...extra }),
  );
  return { root, dir, config, out: join(root, "out"), dispose: () => rm(root, { recursive: true, force: true }) };
}

const PLANTED = {
  /** The astro child exits 3 after printing `planted astro failure`. */
  render: join(REPO_ROOT, "test/acceptance/fixtures/fail_astro.cjs"),
  /** The CLI's `staging -> outDir` rename throws (set `OCX_TEST_FAIL_RENAME_TO` to the real out path too). */
  promotion: join(REPO_ROOT, "test/acceptance/fixtures/fail_promotion.cjs"),
} as const;

/** `RunCliOptions.env` that plants a failure into one stage of the build (see `PLANTED`). */
export function plantedFailure(stage: keyof typeof PLANTED, out: string): Record<string, string> {
  const existing = process.env.NODE_OPTIONS ?? "";
  return {
    NODE_OPTIONS: `${existing} --require ${PLANTED[stage]}`.trim(),
    OCX_TEST_FAIL_RENAME_TO: out,
  };
}

/** Every entry (files and directories) under `dir`, sorted — unlike `listTree`, empty directories show. */
export async function listEntries(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map((entry) => entry.split("\\").join("/")).sort();
}
