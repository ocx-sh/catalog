import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildError, RenderError } from "../src/build/errors.js";
import { ConfigError } from "../src/config/errors.js";
import { DATA, FAIL, UNAVAILABLE } from "../src/cli/exit.js";

/*
 * `cli/dev.ts`'s `runDev` against a mocked `devServer` (C-001, S-012): the
 * options it hands over, and one exit code per error class — including the
 * ones the real supervisor only raises mid-session (a `DATA` `BuildError`,
 * a `RenderError` from a dying child), which test/cli_dev.test.ts's
 * pre-spawn failures cannot reach.
 */

const hoisted = vi.hoisted(() => ({ devServerMock: vi.fn() }));
vi.mock("../src/build/dev.js", () => ({ devServer: hoisted.devServerMock }));

const { runDev } = await import("../src/cli/dev.js");

let stderr: string[];
beforeEach(() => {
  hoisted.devServerMock.mockReset();
  process.exitCode = undefined;
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("what runDev hands to devServer", () => {
  it("--config, --port and --smoke: an absolute config path, a numeric port, no source", async () => {
    hoisted.devServerMock.mockResolvedValueOnce(undefined);
    await runDev({ config: "site/catalog.config.json", port: "4400", smoke: true });
    expect(hoisted.devServerMock).toHaveBeenCalledWith({
      configPath: resolve("site/catalog.config.json"),
      sourcePath: undefined,
      port: 4400,
      smoke: true,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("--source alone: an absolute source path and no config path", async () => {
    hoisted.devServerMock.mockResolvedValueOnce(undefined);
    await runDev({ source: "../index" });
    expect(hoisted.devServerMock).toHaveBeenCalledWith({
      configPath: undefined,
      sourcePath: resolve("../index"),
      port: undefined,
      smoke: false,
    });
  });

  it("neither flag: ./catalog.config.json", async () => {
    hoisted.devServerMock.mockResolvedValueOnce(undefined);
    await runDev({});
    expect(hoisted.devServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: resolve("catalog.config.json"), sourcePath: undefined }),
    );
  });

  it("--source with --config never reaches devServer", async () => {
    await runDev({ source: ".", config: "c.json" });
    expect(hoisted.devServerMock).not.toHaveBeenCalled();
  });
});

describe("exit codes (C-001)", () => {
  it.each([
    ["a ConfigError", new ConfigError("INVALID_JSON", "catalog.config.json: bad"), DATA],
    ["a DATA BuildError", new BuildError("DATA", "a root's name mismatches its path"), DATA],
    ["an UNAVAILABLE BuildError", new BuildError("UNAVAILABLE", "port 4321 is already in use"), UNAVAILABLE],
    ["a RenderError (the child died or never came up)", new RenderError("astro dev exited unexpectedly (code 1)"), FAIL],
  ])("%s prints the message with the CLI prefix and exits with its code", async (_name, error, code) => {
    hoisted.devServerMock.mockRejectedValueOnce(error);
    await runDev({ source: "." });
    expect(process.exitCode).toBe(code);
    expect(stderr.join("")).toBe(`ocx-catalog dev: ${error.message}\n`);
  });

  it("any other error propagates, for index.ts to exit 1", async () => {
    hoisted.devServerMock.mockRejectedValueOnce(new Error("totally unexpected"));
    await expect(runDev({ source: "." })).rejects.toThrow("totally unexpected");
    expect(process.exitCode).toBeUndefined();
  });
});
