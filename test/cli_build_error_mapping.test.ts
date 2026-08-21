import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildError } from "../src/build/errors.js";
import { DATA, UNAVAILABLE } from "../src/cli/exit.js";

/*
 * Focused unit coverage for `cli/build.ts`'s `runBuild` `BuildError`
 * mapping branch. `test/cli.test.ts`'s real (unmocked) "no config file"
 * case already covers the `ConfigError` branch; `test/cli_dev.test.ts`'s
 * real port-in-use case already covers `cli/dev.ts`'s equivalent branch via
 * a REAL `devServer()` call. `cli/build.ts`'s `BuildError` branch has no
 * matching real throw site in the CURRENT `buildCatalog` implementation
 * (`engine.ts` only ever raises `ConfigError`, or whatever `vitepress`'s
 * own `build()` throws — neither is a `BuildError`), so it's mocked here
 * instead — same `vi.mock` technique `test/build/engine.test.ts` already
 * uses for `buildCatalog`'s own order assertions, applied one layer up to
 * verify the CLI's own error-to-exit-code mapping in isolation.
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

  it("a non-ConfigError/BuildError propagates instead of being swallowed", async () => {
    hoisted.buildCatalogMock.mockRejectedValueOnce(new Error("totally unexpected"));
    await expect(runBuild({})).rejects.toThrow("totally unexpected");
  });
});
