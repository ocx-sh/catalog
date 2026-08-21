import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildError } from "../src/build/errors.js";
import { DATA } from "../src/cli/exit.js";

/*
 * Focused unit coverage for `cli/dev.ts`'s `runDev` `BuildError` mapping —
 * the two branches `test/cli_dev.test.ts`'s REAL (unmocked) port-in-use
 * case can't reach: a `BuildError` whose `code` is `DATA` (not
 * `UNAVAILABLE` — `devServer()` itself never actually raises this today,
 * same reasoning as `test/cli_build_error_mapping.test.ts`'s equivalent
 * `runBuild` gap), and a non-`ConfigError`/`BuildError` propagating instead
 * of being swallowed.
 */

const hoisted = vi.hoisted(() => ({ devServerMock: vi.fn() }));
vi.mock("../src/build/dev.js", () => ({ devServer: hoisted.devServerMock }));

const { runDev } = await import("../src/cli/dev.js");

beforeEach(() => {
  hoisted.devServerMock.mockReset();
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
});

describe("C-001 cli/dev.ts runDev — BuildError mapping", () => {
  it("a BuildError with code DATA maps to exit 65 (not the UNAVAILABLE default)", async () => {
    hoisted.devServerMock.mockRejectedValueOnce(new BuildError("DATA", "a root's name mismatches its path"));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runDev({ source: ".", smoke: true });
      expect(process.exitCode).toBe(DATA);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a non-ConfigError/BuildError propagates instead of being swallowed", async () => {
    hoisted.devServerMock.mockRejectedValueOnce(new Error("totally unexpected"));
    await expect(runDev({ source: ".", smoke: true })).rejects.toThrow("totally unexpected");
  });
});
