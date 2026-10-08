import { readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INLINE_SCRIPT_HASHES } from "@ocx-sh/theme/csp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default render path hands the real runner a real `spawn`; the runner is mocked so
// that wiring is observable without starting Astro (the real child is exercised by
// `astro_build.test.ts`).
const runnerFake = vi.hoisted(() => ({ runAstro: vi.fn() }));
vi.mock("../../src/build/astro_runner.js", () => runnerFake);

import { buildCatalog, type BuildCatalogDeps } from "../../src/build/engine.js";
import { BuildError, RenderError } from "../../src/build/errors.js";
import { ConfigError } from "../../src/config/errors.js";
import { scratchBaseDir } from "./helpers.js";

/*
 * `buildCatalog` against a temp copy of the committed site fixtures
 * (`test/fixtures/site/root.config.json`: base "/", root source, docs, publicDir,
 * siteUrl), through the real `loadConfig` -> `resolveCatalog` -> `assemblePublic`
 * -> `writeSiteJson` chain. Only the Astro child (`render`) and, for promotion
 * faults, `rename` are injected.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/site/", import.meta.url));
const cleanup: string[] = [];

interface Project {
  readonly dir: string;
  readonly configPath: string;
  readonly outDir: string;
}

async function project(): Promise<Project> {
  const dir = await mkdtemp(join(tmpdir(), "engine-"));
  cleanup.push(dir);
  await cp(FIXTURE_DIR, dir, { recursive: true });
  return { dir, configPath: join(dir, "root.config.json"), outDir: join(dir, "dist") };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** This process's scratch roots currently on disk (other test files run in other processes). */
const myScratchRoots = async (): Promise<string[]> =>
  (await readdir(scratchBaseDir).catch(() => [])).filter((name) => name.startsWith(`ocx-catalog-${process.pid}-`));

/** Everything under `dir` as `relative path -> bytes`, for byte-for-byte comparison. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    out[relative(dir, file)] = await readFile(file, "utf8");
  }
  return out;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The siblings an interrupted build could leave next to `outDir`. */
const siblings = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((name) => name === "dist" || name.startsWith("dist.")).sort();

/** A stand-in for the Astro child that writes a recognisable page tree into its staging dir. */
const renderOk: NonNullable<BuildCatalogDeps["render"]> = async ({ root }) => {
  const site = JSON.parse(await readFile(join(root, "site.json"), "utf8")) as { astro: { outDir: string } };
  await mkdir(site.astro.outDir, { recursive: true });
  await writeFile(join(site.astro.outDir, "index.html"), "<h1>new</h1>");
};

async function seedPreviousOutput(outDir: string): Promise<void> {
  await mkdir(join(outDir, "nested"), { recursive: true });
  await writeFile(join(outDir, "index.html"), "<h1>old</h1>");
  await writeFile(join(outDir, "nested", "keep.txt"), "previous build");
}

describe("buildCatalog: pipeline", () => {
  it("renders into a staging sibling with the scratch root as Astro root, then promotes it to outDir", async () => {
    const p = await project();
    let seen: { root: string; configFile: string; cwd?: string; tree: string[]; site: Record<string, unknown> } | undefined;
    const result = await buildCatalog(p, {
      render: async (options) => {
        seen = {
          root: options.root,
          configFile: options.configFile,
          cwd: options.cwd,
          tree: await readdir(options.root, { recursive: true }),
          site: JSON.parse(await readFile(join(options.root, "site.json"), "utf8")) as Record<string, unknown>,
        };
        await renderOk(options);
      },
    });

    expect(result).toEqual({ outDir: p.outDir });
    expect(await readFile(join(p.outDir, "index.html"), "utf8")).toBe("<h1>new</h1>");
    if (seen === undefined) throw new Error("render was not called");
    const { root, configFile, cwd, tree, site } = seen;
    expect(configFile).toBe(join(root, "astro.config.mjs"));
    expect(cwd).toBe(p.dir);
    expect(tree).toEqual(expect.arrayContaining(["astro.config.mjs", "site.json", "public"]));
    // C-045: the root holds no page source; `docs` is set, so the content config is its one `src/` file.
    expect(tree).not.toContain(join("src", "fetch.ts"));
    expect(tree.filter((name) => name.startsWith("src"))).toEqual(["src", join("src", "content.config.ts")]);
    // One file, one writer: the model plus the astro SiteInput.
    expect(site.base).toBe("/");
    expect(site.routes).toEqual(expect.any(Array));
    expect(site.astro).toMatchObject({
      base: "/",
      siteUrl: "https://fixture.ocx.test",
      outDir: `${p.outDir}.staging-${process.pid}`,
      publicDir: join(root, "public"),
      sitePath: join(root, "site.json"),
      cspHashes: [...INLINE_SCRIPT_HASHES],
    });
    expect((site.astro as { fsAllow: string[] }).fsAllow).toContain(root);
  });

  it("hands the per-route wire facts to site.json (C-004, C-047)", async () => {
    const p = await project();
    let details: Record<string, { owners: { login: string }[]; tags: string[] }> = {};
    await buildCatalog(
      { ...p, configPath: join(p.dir, "catalog.config.json") },
      {
        render: async (options) => {
          details = (JSON.parse(await readFile(join(options.root, "site.json"), "utf8")) as { details: typeof details }).details;
          await renderOk(options);
        },
      },
    );
    expect(details["index-b/hostile/metadata"]?.owners.map((owner) => owner.login)).toContain("ocx-bot");
    expect(details["index-b/hostile/metadata"]?.tags.length).toBeGreaterThan(0);
  });

  it("pre-renders READMEs in the parent: site.json points at sanitised files that exist while the child runs (C-014, C-047)", async () => {
    const p = await project();
    let readme: Record<string, string | null> = {};
    let rendered = "";
    await buildCatalog(p, {
      render: async (options) => {
        readme = (JSON.parse(await readFile(join(options.root, "site.json"), "utf8")) as { readme: typeof readme }).readme;
        rendered = await readFile(readme["tools/modern"] as string, "utf8");
        await renderOk(options);
      },
    });
    expect(rendered).toContain("<h1>modern</h1>");
    expect(rendered).toContain("<p>The current successor of legacy/oldtool.</p>");
  });

  it("scans `docs` into the model and declares the content collection for Astro", async () => {
    const p = await project();
    let slugs: string[] = [];
    let ids: string[] = [];
    let content = "";
    await buildCatalog(p, {
      render: async (options) => {
        const pages = (JSON.parse(await readFile(join(options.root, "site.json"), "utf8")) as { docs: { pages: { slug: string; id: string }[] } }).docs.pages;
        slugs = pages.map((page) => page.slug);
        ids = pages.map((page) => page.id);
        content = await readFile(join(options.root, "src", "content.config.ts"), "utf8");
        await renderOk(options);
      },
    });
    expect(slugs).toEqual(expect.arrayContaining(["guide/getting-started", "reference/cli"]));
    expect(slugs).not.toContain("reference/notes");
    // An index.md is served at its directory; its collection id stays the file path.
    expect(slugs).toEqual(expect.arrayContaining(["", "guide"]));
    expect(ids).toEqual(expect.arrayContaining(["index", "guide/index"]));
    expect(content).toContain(pathToFileURL(join(p.dir, "docs-fixture")).href);
  });

  it("without `docs` scans nothing and writes no content config", async () => {
    const p = await project();
    let tree: string[] = [];
    let docs: unknown;
    await buildCatalog(
      { ...p, configPath: join(p.dir, "catalog.config.json") },
      {
        render: async (options) => {
          tree = await readdir(options.root, { recursive: true });
          docs = (JSON.parse(await readFile(join(options.root, "site.json"), "utf8")) as { docs: unknown }).docs;
          await renderOk(options);
        },
      },
    );
    expect(tree.filter((name) => name.startsWith("src"))).toEqual([]);
    expect(docs).toEqual({ groups: [], pages: [] });
  });

  it("writes the wire mirror, _headers and merged catalog.json into the scratch public/ the output serves", async () => {
    const p = await project();
    let publicTree: string[] = [];
    await buildCatalog(p, {
      render: async (options) => {
        publicTree = await readdir(join(options.root, "public"), { recursive: true });
        await renderOk(options);
      },
    });
    expect(publicTree).toEqual(
      expect.arrayContaining(["_headers", "robots.txt", "favicon.svg", join("data", "catalog", "catalog.json")]),
    );
  });

  it("replaces a previous outDir and leaves no staging, retired or scratch residue", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const scratchBefore = await myScratchRoots();

    await buildCatalog(p, { render: renderOk });

    expect(await snapshot(p.outDir)).toEqual({ "index.html": "<h1>new</h1>" });
    expect(await siblings(p.dir)).toEqual(["dist"]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("creates the parent of a not-yet-existing outDir", async () => {
    const p = await project();
    const outDir = join(p.dir, "deep", "er", "dist");
    await buildCatalog({ ...p, outDir }, { render: renderOk });
    expect(await exists(join(outDir, "index.html"))).toBe(true);
  });

  it("removes a stale staging directory a killed run left under the same name", async () => {
    const p = await project();
    await mkdir(`${p.outDir}.staging-${process.pid}`);
    await writeFile(join(`${p.outDir}.staging-${process.pid}`, "stale.txt"), "x");
    await buildCatalog(p, { render: renderOk });
    expect(await snapshot(p.outDir)).toEqual({ "index.html": "<h1>new</h1>" });
  });

  it("resolves a relative outDir against the working directory", async () => {
    const p = await project();
    const relOut = relative(process.cwd(), p.outDir);
    const result = await buildCatalog({ ...p, outDir: relOut }, { render: renderOk });
    expect(result.outDir).toBe(p.outDir);
  });

  it("keeps a symlinked outDir a symlink: the real target is replaced, the link is not", async () => {
    const p = await project();
    const target = join(p.dir, "elsewhere");
    await mkdir(target);
    await writeFile(join(target, "old.html"), "old");
    const link = join(p.dir, "link");
    await symlink(target, link);

    const result = await buildCatalog({ ...p, outDir: link }, { render: renderOk });

    expect(result.outDir).toBe(link);
    expect(await snapshot(target)).toEqual({ "index.html": "<h1>new</h1>" });
    expect((await readdir(p.dir)).filter((name) => name.startsWith("elsewhere."))).toEqual([]);
  });
});

describe("buildCatalog: default render (C-025)", () => {
  it("runs `astro build` through the runner with the real spawn and process env, relaying every line to stderr", async () => {
    const p = await project();
    runnerFake.runAstro.mockImplementation((_mode: string, options: { root: string; onLine: (line: string, stream: "stdout" | "stderr") => void }) => {
      options.onLine("ocx-catalog: out line", "stdout");
      options.onLine("ocx-catalog: err line", "stderr");
      return { exit: renderOk(options as never).then(() => 0), stop: () => undefined };
    });
    const written: Record<"stdout" | "stderr", string[]> = { stdout: [], stderr: [] };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => written.stdout.push(String(chunk)) > 0);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => written.stderr.push(String(chunk)) > 0);
    try {
      await buildCatalog(p);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    const [mode, options, deps] = runnerFake.runAstro.mock.calls[0] as [string, { cwd: string }, { spawn: unknown; env: unknown }];
    expect(mode).toBe("build");
    expect(options.cwd).toBe(p.dir);
    expect(deps.env).toBe(process.env);
    expect(deps.spawn).toBeTypeOf("function");
    expect(written.stdout).toEqual([]);
    expect(written.stderr).toEqual(["ocx-catalog: out line\n", "ocx-catalog: err line\n"]);
    expect(await exists(join(p.outDir, "index.html"))).toBe(true);
  });

  it("propagates the runner's RenderError and leaves nothing behind", async () => {
    const p = await project();
    runnerFake.runAstro.mockImplementation(() => ({
      exit: Promise.reject(new RenderError("astro build exited with code 1")),
      stop: () => undefined,
    }));
    await expect(buildCatalog(p)).rejects.toThrow(RenderError);
    expect(await exists(p.outDir)).toBe(false);
    expect(await siblings(p.dir)).toEqual([]);
  });
});

describe("buildCatalog: no partial output (C-038, S-012)", () => {
  let scratchBefore: string[];
  beforeEach(async () => {
    scratchBefore = await myScratchRoots();
  });

  it("render failure: previous outDir byte-unchanged, staging and scratch root gone", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const before = await snapshot(p.outDir);

    await expect(
      buildCatalog(p, {
        render: async (options) => {
          await renderOk(options); // half a build is on disk in staging
          throw new RenderError("astro build exited with code 1");
        },
      }),
    ).rejects.toThrow("astro build exited with code 1");

    expect(await snapshot(p.outDir)).toEqual(before);
    expect(await siblings(p.dir)).toEqual(["dist"]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("assembly failure: render never starts, previous outDir byte-unchanged, scratch root gone", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const before = await snapshot(p.outDir);
    // A favicon that resolves to no file in publicDir is a BuildError DATA from assemblePublic.
    const config = JSON.parse(await readFile(p.configPath, "utf8")) as Record<string, unknown>;
    await writeFile(p.configPath, JSON.stringify({ ...config, favicon: "/missing.svg" }));
    const render = vi.fn();

    await expect(buildCatalog(p, { render })).rejects.toThrow(BuildError);

    expect(render).not.toHaveBeenCalled();
    expect(await snapshot(p.outDir)).toEqual(before);
    expect(await siblings(p.dir)).toEqual(["dist"]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("promotion failure moving staging into place: the previous outDir is restored byte-for-byte", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const before = await snapshot(p.outDir);
    const failing: typeof rename = async (from, to) => {
      if (String(from).includes(".staging-")) throw Object.assign(new Error("EBUSY: promote"), { code: "EBUSY" });
      return rename(from, to);
    };

    await expect(buildCatalog(p, { render: renderOk, rename: failing })).rejects.toThrow("EBUSY: promote");

    expect(await snapshot(p.outDir)).toEqual(before);
    expect(await siblings(p.dir)).toEqual(["dist"]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("promotion failure moving the previous outDir aside: nothing moved, staging gone", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const before = await snapshot(p.outDir);
    const failing: typeof rename = async (from, to) => {
      if (String(to).includes(".retired-")) throw Object.assign(new Error("EBUSY: aside"), { code: "EBUSY" });
      return rename(from, to);
    };

    await expect(buildCatalog(p, { render: renderOk, rename: failing })).rejects.toThrow("EBUSY: aside");

    expect(await snapshot(p.outDir)).toEqual(before);
    expect(await siblings(p.dir)).toEqual(["dist"]);
  });

  it("promotion failure with no previous outDir: no outDir appears, staging gone", async () => {
    const p = await project();
    const failing: typeof rename = async () => {
      throw Object.assign(new Error("EBUSY: promote"), { code: "EBUSY" });
    };

    await expect(buildCatalog(p, { render: renderOk, rename: failing })).rejects.toThrow("EBUSY: promote");

    expect(await exists(p.outDir)).toBe(false);
    expect(await siblings(p.dir)).toEqual([]);
  });

  it("a failed rollback keeps the retired previous build for recovery instead of deleting it", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const failing: typeof rename = async (from, to) => {
      if (String(from).includes(".staging-") || String(from).includes(".retired-")) {
        throw Object.assign(new Error("EBUSY: gone"), { code: "EBUSY" });
      }
      return rename(from, to);
    };

    await expect(buildCatalog(p, { render: renderOk, rename: failing })).rejects.toThrow("EBUSY: gone");

    const retired = (await siblings(p.dir)).filter((name) => name.includes(".retired-"));
    expect(retired).toHaveLength(1);
    expect(await readFile(join(p.dir, retired[0] ?? "", "nested", "keep.txt"), "utf8")).toBe("previous build");
  });

  it("an outDir below a regular file fails loudly and leaves no scratch root", async () => {
    const p = await project();
    // outDir's parent is a file: creating the parent fails, which must surface.
    await writeFile(join(p.dir, "afile"), "x");
    await expect(buildCatalog({ ...p, outDir: join(p.dir, "afile", "dist") }, { render: renderOk })).rejects.toThrow();
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("a source failure leaves no scratch root and no staging", async () => {
    const p = await project();
    await rm(join(p.dir, "index-a"), { recursive: true });
    await expect(buildCatalog(p, { render: renderOk })).rejects.toThrow();
    expect(await siblings(p.dir)).toEqual([]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });
});

describe("buildCatalog: output guard (C-036, S-001)", () => {
  it.each([
    ["the config directory", (p: Project) => p.dir],
    ["a path source root", (p: Project) => join(p.dir, "index-a")],
    ["a directory containing the config", (p: Project) => dirname(p.dir)],
    ["inside docs", (p: Project) => join(p.dir, "docs-fixture", "build")],
    ["inside publicDir", (p: Project) => join(p.dir, "public-fixture", "build")],
  ])("refuses an outDir that is %s with OUT_DIR_OVERLAPS_INPUT before anything is written", async (_name, outOf) => {
    const p = await project();
    const render = vi.fn();
    const scratchBefore = await myScratchRoots();

    const err = await buildCatalog({ ...p, outDir: outOf(p) }, { render }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
    expect(render).not.toHaveBeenCalled();
    expect(await myScratchRoots()).toEqual(scratchBefore);
    expect(await readdir(p.dir)).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.staging-/)]));
  });

  it("refuses an outDir that is a symlink to a config input", async () => {
    const p = await project();
    const link = join(p.dir, "out-link");
    await symlink(join(p.dir, "docs-fixture"), link);
    const err = await buildCatalog({ ...p, outDir: link }, { render: vi.fn() }).catch((e: unknown) => e);
    expect((err as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
  });

  it("refuses the scratch-root base (an ancestor of every scratch root) after the root exists, and cleans up", async () => {
    const p = await project();
    const render = vi.fn();
    const scratchBefore = await myScratchRoots();

    const err = await buildCatalog({ ...p, outDir: scratchBaseDir }, { render }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
    expect(render).not.toHaveBeenCalled();
    expect(await myScratchRoots()).toEqual(scratchBefore);
  });

  it("surfaces a config error before touching the filesystem", async () => {
    const p = await project();
    await writeFile(p.configPath, "{ not json");
    const render = vi.fn();
    await expect(buildCatalog(p, { render })).rejects.toThrow(ConfigError);
    expect(await exists(p.outDir)).toBe(false);
  });
});

describe("buildCatalog: SIGINT/SIGTERM (C-046)", () => {
  /** An injected signal seam: `fire` is a signal arriving; `raised` records the re-delivery and what was on disk at that moment. */
  function signalSeam(dir: string) {
    const handlers = new Map<string, () => void>();
    const raised: { signal: string; scratch: string[]; siblings: string[] }[] = [];
    let removed = 0;
    return {
      handlers,
      raised,
      removed: () => removed,
      deps: {
        onSignal: (signal: NodeJS.Signals, handler: () => void) => {
          handlers.set(signal, handler);
          return () => {
            removed++;
          };
        },
        raise: (signal: NodeJS.Signals) => {
          raised.push({
            signal,
            scratch: readdirSync(scratchBaseDir).filter((name) => name.startsWith(`ocx-catalog-${process.pid}-`)),
            siblings: readdirSync(dir).filter((name) => name === "dist" || name.startsWith("dist.")),
          });
        },
      },
      fire: (signal: NodeJS.Signals) => handlers.get(signal)?.(),
    };
  }

  it("a signal during the render: previous outDir untouched, staging and scratch gone before the signal is re-raised", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const before = await snapshot(p.outDir);
    const scratchBefore = await myScratchRoots();
    const seam = signalSeam(p.dir);

    const error = await buildCatalog(p, {
      ...seam.deps,
      render: async (options) => {
        await renderOk(options);
        seam.fire("SIGINT");
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("build interrupted by SIGINT");
    expect(await snapshot(p.outDir)).toEqual(before);
    expect(await siblings(p.dir)).toEqual(["dist"]);
    expect(await myScratchRoots()).toEqual(scratchBefore);
    expect(seam.raised).toEqual([{ signal: "SIGINT", scratch: scratchBefore, siblings: ["dist"] }]);
    expect(seam.removed()).toBe(2);
  });

  it("a second signal during the render re-raises at once, skipping the unwind, and raises only once", async () => {
    const p = await project();
    const seam = signalSeam(p.dir);
    let raisedMidRender: number | undefined;
    let removedMidRender: number | undefined;

    const error = await buildCatalog(p, {
      ...seam.deps,
      render: async (options) => {
        await renderOk(options);
        seam.fire("SIGINT");
        seam.fire("SIGINT");
        raisedMidRender = seam.raised.length;
        removedMidRender = seam.removed();
      },
    }).catch((e: unknown) => e);

    expect((error as Error).message).toBe("build interrupted by SIGINT");
    expect(raisedMidRender).toBe(1);
    expect(removedMidRender).toBe(2);
    expect(seam.raised.map((r) => r.signal)).toEqual(["SIGINT"]);
  });

  it("a signal while the scratch root is being created (nothing else registered yet) still removes it", async () => {
    const p = await project();
    const scratchBefore = await myScratchRoots();
    const seam = signalSeam(p.dir);
    const render = vi.fn();

    const error = await buildCatalog(p, {
      render,
      raise: seam.deps.raise,
      onSignal: (signal, handler) => {
        if (signal === "SIGTERM") handler(); // arrives before createScratchRoot resolves
        return () => undefined;
      },
    }).catch((e: unknown) => e);

    expect((error as Error).message).toBe("build interrupted by SIGTERM");
    expect(render).not.toHaveBeenCalled();
    expect(await myScratchRoots()).toEqual(scratchBefore);
    expect(seam.raised).toEqual([{ signal: "SIGTERM", scratch: scratchBefore, siblings: [] }]);
  });

  it("a signal during the promotion lets it finish: outDir is the new tree, then the signal is re-raised", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const seam = signalSeam(p.dir);
    let renames = 0;

    const result = await buildCatalog(p, {
      ...seam.deps,
      render: renderOk,
      rename: (from, to) => {
        if (renames++ === 0) seam.fire("SIGTERM"); // the previous outDir is about to be moved aside
        return rename(from, to);
      },
    });

    expect(result).toEqual({ outDir: p.outDir });
    expect(await snapshot(p.outDir)).toEqual({ "index.html": "<h1>new</h1>" });
    expect(renames).toBe(2);
    expect(seam.raised).toEqual([{ signal: "SIGTERM", scratch: await myScratchRoots(), siblings: ["dist"] }]);
  });

  it("no signal: nothing is re-raised and the handlers are removed", async () => {
    const p = await project();
    const seam = signalSeam(p.dir);

    await buildCatalog(p, { ...seam.deps, render: renderOk });

    expect(seam.raised).toEqual([]);
    expect(seam.removed()).toBe(2);
  });

  it("by default the handlers sit on process, are removed afterwards and the signal is re-delivered to this pid", async () => {
    const p = await project();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const listeners = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    let during: number[] = [];
    try {
      const error = await buildCatalog(p, {
        render: async (options) => {
          during = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
          await renderOk(options);
          process.emit("SIGTERM");
        },
      }).catch((e: unknown) => e);

      expect((error as Error).message).toBe("build interrupted by SIGTERM");
      expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGTERM");
      expect(during).toEqual(listeners.map((count) => count + 1));
      expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(listeners);
    } finally {
      kill.mockRestore();
    }
  });
});

describe("buildCatalog: promotion is the commit point", () => {
  it("a failure removing the retired tree afterwards is a warning on stderr, not a failed build", async () => {
    const p = await project();
    await seedPreviousOutput(p.outDir);
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => written.push(String(chunk)) > 0);
    let retiredRemovals = 0;
    try {
      const result = await buildCatalog(p, {
        render: renderOk,
        rm: (path, options) => {
          if (String(path).includes(".retired-") && ++retiredRemovals === 2) {
            return Promise.reject(Object.assign(new Error("EBUSY: retired"), { code: "EBUSY" }));
          }
          return rm(path, options);
        },
      });
      expect(result).toEqual({ outDir: p.outDir });
    } finally {
      stderr.mockRestore();
    }

    expect(await snapshot(p.outDir)).toEqual({ "index.html": "<h1>new</h1>" });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^ocx-catalog build: warning: could not remove the previous build at .+\.retired-\d+: EBUSY: retired\n$/);
    // The old tree is left for the user, intact.
    const retired = (await siblings(p.dir)).filter((name) => name.includes(".retired-"));
    expect(retired).toHaveLength(1);
    expect(await readFile(join(p.dir, retired[0] ?? "", "nested", "keep.txt"), "utf8")).toBe("previous build");
  });
});

describe("buildCatalog: the staging and retired siblings are guarded like outDir (C-036)", () => {
  it.each([
    ["staging", `dist.staging-${process.pid}`],
    ["retired", `dist.retired-${process.pid}`],
  ])("refuses an input that sits where the %s sibling would be, leaving it alone", async (_name, sibling) => {
    const p = await project();
    await cp(join(p.dir, "docs-fixture"), join(p.dir, sibling), { recursive: true });
    const config = JSON.parse(await readFile(p.configPath, "utf8")) as Record<string, unknown>;
    await writeFile(p.configPath, JSON.stringify({ ...config, docs: `./${sibling}` }));
    const render = vi.fn();

    const err = await buildCatalog(p, { render }).catch((e: unknown) => e);

    expect((err as ConfigError).code).toBe("OUT_DIR_OVERLAPS_INPUT");
    expect(render).not.toHaveBeenCalled();
    expect(await exists(join(p.dir, sibling, "guide"))).toBe(true);
  });
});
