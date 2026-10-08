import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildError, RenderError } from "../src/build/errors.js";
import { DATA, FAIL, UNAVAILABLE } from "../src/cli/exit.js";
import { runBuild as runBuildProcess } from "./acceptance/cli.js";
import { createProject, leftoverScratch, plantedFailure } from "./acceptance/helpers.js";

/*
 * Two layers, one contract (C-001, S-012).
 *
 * 1. In-process, `buildCatalog` mocked: `cli/build.ts`'s `runBuild` error-to-exit
 *    mapping in isolation, including the `BuildError` branches, which no
 *    in-process real build reaches cheaply.
 * 2. A real `ocx-catalog build` process per failure mode (at the end of the
 *    file; the mock cannot reach a child process): what the user actually sees
 *    — exit code, stderr, and that no partial `outDir`, staging dir or scratch
 *    root is left behind.
 */

const hoisted = vi.hoisted(() => ({ buildCatalogMock: vi.fn() }));
vi.mock("../src/build/engine.js", () => ({ buildCatalog: hoisted.buildCatalogMock }));

const { runBuild } = await import("../src/cli/build.js");

beforeEach(() => {
  hoisted.buildCatalogMock.mockReset();
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
});

describe("C-001 cli/build.ts runBuild — BuildError mapping", () => {
  it("buildCatalog resolving normally leaves exitCode untouched (implicit success)", async () => {
    hoisted.buildCatalogMock.mockResolvedValueOnce({ outDir: "/tmp/does-not-matter" });
    await runBuild({});
    expect(process.exitCode).toBeUndefined();
  });

  it("a BuildError with code UNAVAILABLE maps to exit 69", async () => {
    hoisted.buildCatalogMock.mockRejectedValueOnce(new BuildError("UNAVAILABLE", "boom unavailable"));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runBuild({});
      expect(process.exitCode).toBe(UNAVAILABLE);
      expect(errSpy).toHaveBeenCalledWith("ocx-catalog build: boom unavailable\n");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a BuildError with code DATA maps to exit 65", async () => {
    hoisted.buildCatalogMock.mockRejectedValueOnce(new BuildError("DATA", "boom data"));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runBuild({});
      expect(process.exitCode).toBe(DATA);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a RenderError (the Astro child failed) prints with the ocx-catalog prefix and maps to exit 1", async () => {
    hoisted.buildCatalogMock.mockRejectedValueOnce(new RenderError("astro build exited with code 1"));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runBuild({});
      expect(process.exitCode).toBe(FAIL);
      expect(errSpy).toHaveBeenCalledWith("ocx-catalog build: astro build exited with code 1\n");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a non-ConfigError/BuildError propagates instead of being swallowed", async () => {
    hoisted.buildCatalogMock.mockRejectedValueOnce(new Error("totally unexpected"));
    await expect(runBuild({})).rejects.toThrow("totally unexpected");
  });
});

describe("C-001 / S-012 a real `ocx-catalog build` process: exit code, stderr, nothing left behind", () => {
  /** Nothing of the build remains: no `outDir`, no `out.staging-*` sibling, no scratch root of that process. */
  async function expectNothingLeft(root: string, pid: number): Promise<void> {
    expect(await readdir(root)).toEqual(["proj"]);
    expect(await leftoverScratch(pid)).toEqual([]);
  }

  it("a config error exits 65 with the message on stderr", async () => {
    const project = await createProject({ chrome: "bogus" });
    try {
      const result = await runBuildProcess(project.config, project.out);

      expect(result.code).toBe(DATA);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ocx-catalog build:");
      expect(result.stderr).toContain('"chrome" must be "neutral" or "ocx"');
      await expectNothingLeft(project.root, result.pid);
    } finally {
      await project.dispose();
    }
  });

  it("an unreachable url source exits 69 naming the source", async () => {
    const project = await createProject({ sources: [{ url: "https://127.0.0.1:1/", label: "gone" }] });
    try {
      const result = await runBuildProcess(project.config, project.out);

      expect(result.code).toBe(UNAVAILABLE);
      expect(result.stderr).toContain("ocx-catalog build: sources[0] (https://127.0.0.1:1/)");
      await expectNothingLeft(project.root, result.pid);
    } finally {
      await project.dispose();
    }
    // Three retries with jittered backoff (500 ms base) before the fetch gives up.
  }, 30_000);

  it("a non-zero Astro child exit is exit 1; the child's stderr is relayed prefixed, then the CLI names the code", async () => {
    const project = await createProject();
    try {
      const result = await runBuildProcess(project.config, project.out, { env: plantedFailure("render", project.out) });

      expect(result.code).toBe(FAIL);
      const stderr = result.stderr.split("\n");
      expect(stderr).toContain("ocx-catalog: planted astro failure");
      expect(stderr).toContain("ocx-catalog build: astro build exited with code 3");
      await expectNothingLeft(project.root, result.pid);
    } finally {
      await project.dispose();
    }
  });
});
