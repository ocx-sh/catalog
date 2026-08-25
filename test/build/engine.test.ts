import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDir } from "./helpers.js";
import { buildCatalog } from "../../src/build/engine.js";
import { BuildError } from "../../src/build/errors.js";
import { ConfigError } from "../../src/config/errors.js";

/*
 * Mocked orchestration-order test suite for `buildCatalog` (C-005's FIXED
 * 8-step pipeline). `createScratchRoot`/`synthesizePages`/`generateConfig`
 * and vitepress's own `build()` are mocked so this file can assert ORDER
 * and ARGUMENTS cheaply and deterministically; `loadConfig` (config/load.ts)
 * and `assertOutDirSafe` (cli/out_dir.ts) run FOR REAL — both are already
 * fully implemented (not stubs) and small enough that mocking them would
 * only hide bugs at their call sites.
 *
 * A REAL (non-mocked) end-to-end build — the "closest thing to the identity
 * gate inside the package" — lives in `engine_real_build.test.ts` instead of
 * this file: `vi.mock("vitepress", ...)` is hoisted file-wide, so a real
 * `vitepress build()` call cannot coexist with this file's mocked one.
 * Flagged in the WP-06 report, not a silent split.
 */

const hoisted = vi.hoisted(() => ({
  calls: [] as string[],
  createScratchRootMock: vi.fn(),
  synthesizePagesMock: vi.fn(),
  generateConfigMock: vi.fn(),
  vitepressBuildMock: vi.fn(),
  disposeMock: vi.fn(),
}));

vi.mock("../../src/build/scratch.js", () => ({
  createScratchRoot: hoisted.createScratchRootMock,
}));
vi.mock("../../src/build/pages.js", () => ({
  synthesizePages: hoisted.synthesizePagesMock,
}));
vi.mock("../../src/build/config_gen.js", () => ({
  generateConfig: hoisted.generateConfigMock,
}));
vi.mock("vitepress", () => ({
  build: hoisted.vitepressBuildMock,
}));

const FAKE_SCRATCH = join("/tmp", "fake-ocx-catalog-scratch-for-tests");

function resetMocks(scratchPath = FAKE_SCRATCH) {
  hoisted.calls.length = 0;
  hoisted.createScratchRootMock.mockReset();
  hoisted.synthesizePagesMock.mockReset();
  hoisted.generateConfigMock.mockReset();
  hoisted.vitepressBuildMock.mockReset();
  hoisted.disposeMock.mockReset();

  hoisted.createScratchRootMock.mockImplementation(async () => {
    hoisted.calls.push("createScratchRoot");
    return { path: scratchPath, dispose: hoisted.disposeMock };
  });
  hoisted.synthesizePagesMock.mockImplementation(async () => {
    hoisted.calls.push("synthesizePages");
  });
  hoisted.generateConfigMock.mockImplementation(async () => {
    hoisted.calls.push("generateConfig");
  });
  hoisted.vitepressBuildMock.mockImplementation(async () => {
    hoisted.calls.push("vitepress.build");
  });
  hoisted.disposeMock.mockImplementation(async () => {
    hoisted.calls.push("dispose");
  });
}

beforeEach(() => resetMocks());
afterEach(() => vi.restoreAllMocks());

/** Writes a minimal, valid `catalog.config.json` + empty source dir under a
 * fresh temp directory, returning the config's absolute path. Real
 * `loadConfig` AND the real source pipeline (`sources_pipeline.ts`) read
 * this — only the steps AFTER source resolution are mocked.
 *
 * The explicit `label` is load-bearing, not decoration: `labels.ts` derives
 * an absent label from the source's OWN package roots and raises
 * `LABEL_DERIVATION_EMPTY` when there are none, so an unlabeled EMPTY source
 * dir is a hard error now that the pipeline is wired (it used to be silently
 * ignored, along with every other source). This suite is about step ORDER,
 * not label derivation — that has its own coverage in
 * `test/sources/labels.test.ts` and `test/build/sources_pipeline.test.ts`. */
async function withValidConfig<T>(fn: (configPath: string) => Promise<T>): Promise<T> {
  return withTempDir("catalog-engine-", async (dir) => {
    await mkdir(join(dir, "packages"), { recursive: true });
    const configPath = join(dir, "catalog.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        sources: [{ path: "packages", root: true, label: "ocx.sh" }],
        brand: { title: "Test Catalog" },
      }),
      "utf8",
    );
    return fn(configPath);
  });
}

describe("C-005 buildCatalog — fixed step order", () => {
  it("runs createScratchRoot -> synthesizePages -> generateConfig -> vitepress build -> dispose, in that order", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        const result = await buildCatalog({ configPath, outDir });
        expect(hoisted.calls).toEqual([
          "createScratchRoot",
          "synthesizePages",
          "generateConfig",
          "vitepress.build",
          "dispose",
        ]);
        expect(result.outDir).toBe(outDir);
      });
    });
  });

  it("passes the scratch root's path to both synthesizePages and generateConfig", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        await buildCatalog({ configPath, outDir });
        const pagesArg = hoisted.synthesizePagesMock.mock.calls[0]?.[0];
        const configArg = hoisted.generateConfigMock.mock.calls[0]?.[0];
        expect(pagesArg.scratchRoot).toBe(FAKE_SCRATCH);
        expect(configArg.scratchRoot).toBe(FAKE_SCRATCH);
      });
    });
  });

  it("calls vitepress build(scratchRoot, { outDir }) with outDir explicit, never vitepress's own default", async () => {
    // NOT asserting a `cacheDir` option here: engine.ts's own doc describes
    // this call as `build(scratchRoot, { outDir, cacheDir })`, but a
    // standalone tsc check against the REAL installed vitepress@2.0.0-alpha.19
    // types (verified for this WP's report) shows `build()`'s options param
    // has no `cacheDir` field at all — it's a Vite root-level `UserConfig`
    // field, not a build-call option. The explicit-cacheDir requirement
    // most likely belongs to `generateConfig()` writing it into the
    // generated site config instead; asserting it here would encode a call
    // shape the real library rejects.
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        await buildCatalog({ configPath, outDir });
        const [root, opts] = hoisted.vitepressBuildMock.mock.calls[0] ?? [];
        expect(root).toBe(FAKE_SCRATCH);
        expect(opts.outDir).toBe(outDir);
      });
    });
  });

  it("outDir passed to vitepress build is the caller's own directory, never inside the scratch root", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        await buildCatalog({ configPath, outDir });
        const [, opts] = hoisted.vitepressBuildMock.mock.calls[0] ?? [];
        expect(opts.outDir.startsWith(FAKE_SCRATCH)).toBe(false);
      });
    });
  });
});

describe("C-005 buildCatalog — config-shape failures surface before anything is written", () => {
  it("a ConfigError from loadConfig propagates unchanged, and nothing else in the pipeline ever runs", async () => {
    await withTempDir("catalog-engine-out-", async (outDir) => {
      const missingConfigPath = join(outDir, "does-not-exist.json");
      await expect(buildCatalog({ configPath: missingConfigPath, outDir })).rejects.toBeInstanceOf(ConfigError);
      expect(hoisted.createScratchRootMock).not.toHaveBeenCalled();
      expect(hoisted.synthesizePagesMock).not.toHaveBeenCalled();
      expect(hoisted.generateConfigMock).not.toHaveBeenCalled();
      expect(hoisted.vitepressBuildMock).not.toHaveBeenCalled();
    });
  });
});

describe("C-005 buildCatalog — assertOutDirSafe runs before the real vitepress build, using the REAL guard", () => {
  it("rejects when outDir equals the scratch root, and still disposes the scratch root", async () => {
    await withValidConfig(async (configPath) => {
      // Point the (mocked) scratch root's path AT outDir itself — the real,
      // unmocked assertOutDirSafe must reject this before vitepress build()
      // is ever reached.
      await withTempDir("catalog-engine-out-", async (outDir) => {
        resetMocks(outDir);
        await expect(buildCatalog({ configPath, outDir })).rejects.toThrow();
        expect(hoisted.vitepressBuildMock).not.toHaveBeenCalled();
        expect(hoisted.disposeMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("C-005 buildCatalog — scratch cleanup (finally semantics)", () => {
  it("disposes the scratch root on the success path", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        await buildCatalog({ configPath, outDir });
        expect(hoisted.disposeMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  it("disposes the scratch root even when the vitepress build() call itself fails", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        hoisted.vitepressBuildMock.mockImplementation(async () => {
          hoisted.calls.push("vitepress.build");
          throw new Error("build blew up");
        });
        await expect(buildCatalog({ configPath, outDir })).rejects.toThrow("build blew up");
        expect(hoisted.disposeMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  it("disposes the scratch root even when synthesizePages itself fails", async () => {
    await withValidConfig(async (configPath) => {
      await withTempDir("catalog-engine-out-", async (outDir) => {
        hoisted.synthesizePagesMock.mockImplementation(async () => {
          hoisted.calls.push("synthesizePages");
          throw new BuildError("DATA", "a root's name prefix mismatches its path");
        });
        await expect(buildCatalog({ configPath, outDir })).rejects.toBeInstanceOf(BuildError);
        expect(hoisted.disposeMock).toHaveBeenCalledTimes(1);
        expect(hoisted.vitepressBuildMock).not.toHaveBeenCalled();
      });
    });
  });
});
