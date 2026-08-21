import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { main } from "../src/cli/main.js";
import { OK, FAIL, USAGE, DATA, UNAVAILABLE } from "../src/cli/exit.js";
import { withTempDir, writeConfig } from "./config/helpers.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pkgVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/**
 * Invokes `main()` in-process with a commander-shaped argv (commander's
 * default `from: "node"` parsing strips index 0/1 as exec path + script
 * path, matching real `process.argv`), capturing stdout/stderr and the
 * `process.exitCode` main() sets. Resets `process.exitCode` before and
 * after so tests never leak exit-code state onto each other or the runner.
 */
async function runMain(args: string[]) {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      outChunks.push(String(chunk));
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      errChunks.push(String(chunk));
      return true;
    });
  process.exitCode = undefined;
  await main(["node", "ocx-catalog", ...args]);
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  outSpy.mockRestore();
  errSpy.mockRestore();
  return { exitCode, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("C-001 CLI surface", () => {
  it("--version prints the package.json version and exits 0", async () => {
    const { exitCode, stdout, stderr } = await runMain(["--version"]);
    expect(exitCode).toBe(OK);
    expect(stdout).toBe(`${pkgVersion}\n`);
    expect(stderr).toBe("");
  });

  it("--help exits 0 and lists every subcommand", async () => {
    const { exitCode, stdout, stderr } = await runMain(["--help"]);
    expect(exitCode).toBe(OK);
    expect(stdout).toContain("Usage: ocx-catalog");
    expect(stdout).toContain("build");
    expect(stdout).toContain("dev");
    expect(stdout).toContain("ci");
    expect(stderr).toBe("");
  });

  it("unknown flag exits 64 with usage text on stderr", async () => {
    const { exitCode, stdout, stderr } = await runMain(["--bogus"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("unknown option");
    expect(stderr).toContain("--bogus");
    expect(stdout).toBe("");
  });

  it("unknown subcommand exits 64 with usage text on stderr", async () => {
    const { exitCode, stdout, stderr } = await runMain(["frobnicate"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("unknown command");
    expect(stderr).toContain("frobnicate");
    expect(stdout).toBe("");
  });

  // build/dev are implemented (C-005): a bare invocation (no --config) now
  // resolves the default `./catalog.config.json` (same convention as
  // `build`'s own DEFAULT_CONFIG_FILE) and surfaces a REAL ConfigError,
  // not the "not implemented" stub text — this repo's own root has no
  // catalog.config.json, so both commands exit 65 (DATA) naming the
  // resolved path, mirroring loadConfig's MISSING_FILE message exactly.
  // `dev`'s case additionally proves the worker's ConfigError survives the
  // IPC boundary back to the parent as a real ConfigError (dev.ts's
  // `configErrorCode` reconstruction), not a generic BuildError/UNAVAILABLE.
  it.each([["build"], ["dev"]])(
    "%s with no config file present exits 65 naming the resolved default config path",
    async (command) => {
      const { exitCode, stdout, stderr } = await runMain([command]);
      expect(exitCode).toBe(DATA);
      expect(stderr).toContain(`ocx-catalog ${command}:`);
      expect(stderr).toContain(join(repoRoot, "catalog.config.json"));
      expect(stdout).toBe("");
    },
  );

  it("dev with both --source and --config exits 64 (mutually exclusive)", async () => {
    const { exitCode, stderr } = await runMain(["dev", "--source", ".", "--config", "catalog.config.json"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("--source and --config are mutually exclusive");
  });

  it("propagates a non-CommanderError from parsing instead of swallowing it", async () => {
    // main() only remaps CommanderError exit codes; any other error (e.g. a
    // future subcommand action throwing a real bug) must propagate so the
    // bin shim's own try/catch (src/cli/index.ts) can set FAIL and report it.
    const parseAsyncSpy = vi
      .spyOn(Command.prototype, "parseAsync")
      .mockRejectedValueOnce(new Error("boom"));
    process.exitCode = undefined;
    await expect(main(["node", "ocx-catalog", "build"])).rejects.toThrow("boom");
    expect(process.exitCode).toBeUndefined();
    parseAsyncSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("exit code constants match the sysexits-derived contract", () => {
    expect(OK).toBe(0);
    expect(FAIL).toBe(1);
    expect(USAGE).toBe(64);
    expect(DATA).toBe(65);
    expect(UNAVAILABLE).toBe(69);
  });
});

describe("C-007 ci command wiring", () => {
  /** Runs `runMain` with `process.cwd()` mocked to `dir` for the duration of
   * `fn` — the `ci` action resolves both `catalog.config.json` and every
   * rendered path relative to `process.cwd()`, never via a `--config`/`--out`
   * flag (C-001's CLI surface lists `ci [--check]` only). */
  async function runMainIn(dir: string, args: string[]) {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      return await runMain(args);
    } finally {
      cwdSpy.mockRestore();
    }
  }

  it("missing catalog.config.json exits 65 naming the path", async () => {
    await withTempDir(async (dir) => {
      const { exitCode, stderr } = await runMainIn(dir, ["ci"]);
      expect(exitCode).toBe(DATA);
      expect(stderr).toContain("ocx-catalog ci:");
      expect(stderr).toContain(join(dir, "catalog.config.json"));
    });
  });

  it("config with no ci block exits 65 naming the missing block", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, { sources: [{ path: "packages" }], brand: { title: "T" } });
      await mkdir(join(dir, "packages"), { recursive: true });
      const { exitCode, stderr } = await runMainIn(dir, ["ci"]);
      expect(exitCode).toBe(DATA);
      expect(stderr).toContain('no "ci" block');
    });
  });

  it("renders the github job set and exits 0", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, {
        sources: [{ path: "packages" }],
        brand: { title: "T" },
        ci: { forge: "github" },
      });
      const { exitCode, stdout, stderr } = await runMainIn(dir, ["ci"]);
      expect(exitCode).toBe(OK);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      const written = await readFile(join(dir, ".github/workflows/catalog-ci.yml"), "utf8");
      expect(written.split("\n")[0]).toBe("# generated by ocx-catalog ci v1 — do not edit");
    });
  });

  it("--check exits 65 before anything is rendered (missing counts as drift)", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, {
        sources: [{ path: "packages" }],
        brand: { title: "T" },
        ci: { forge: "github" },
      });
      const { exitCode, stderr } = await runMainIn(dir, ["ci", "--check"]);
      expect(exitCode).toBe(DATA);
      expect(stderr).toContain(".github/workflows/catalog-ci.yml");
    });
  });

  it("--check exits 0 immediately after a clean render", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, {
        sources: [{ path: "packages" }],
        brand: { title: "T" },
        ci: { forge: "gitlab" },
      });
      await runMainIn(dir, ["ci"]);
      const { exitCode, stderr } = await runMainIn(dir, ["ci", "--check"]);
      expect(exitCode).toBe(OK);
      expect(stderr).toBe("");
    });
  });

  it("propagates a non-ConfigError/CiError instead of swallowing it", async () => {
    // A path that exists but isn't a directory makes discoverGeneratedFiles's
    // readdir() reject ENOTDIR — a plain Node error, neither ConfigError nor
    // CiError, so the ci action's catch must rethrow it rather than mapping
    // it to exit 65 like the two error classes it does handle.
    await withTempDir(async (dir) => {
      await writeConfig(dir, {
        sources: [{ path: "packages" }],
        brand: { title: "T" },
        ci: { forge: "github" },
      });
      await mkdir(join(dir, ".github"), { recursive: true });
      await writeFile(join(dir, ".github/workflows"), "not a directory");
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
      try {
        await expect(main(["node", "ocx-catalog", "ci"])).rejects.toThrow();
      } finally {
        cwdSpy.mockRestore();
        process.exitCode = undefined;
      }
    });
  });
});

describe("C-001 bin shim subprocess smoke", () => {
  // dist/ is built once by vitest's globalSetup (test/global-setup.ts)
  // before any test file runs — the bin shim (package.json "bin" field,
  // wired through dist/cli/index.js) is already there to invoke as a real
  // subprocess. This file is excluded from in-process coverage (see
  // vitest.config.ts) since it only runs meaningfully as a standalone
  // process against real argv.
  it("node dist/cli/index.js --version prints the version and exits 0", () => {
    const result = execFileSync("node", ["dist/cli/index.js", "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result).toBe(`${pkgVersion}\n`);
  });
});
