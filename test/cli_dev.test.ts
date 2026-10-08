import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA, UNAVAILABLE, USAGE } from "../src/cli/exit.js";
import { main } from "../src/cli/main.js";
import { findFreePort, occupyPort, scratchBaseDirEntries, withTempDir } from "./build/helpers.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/*
 * `ocx-catalog dev`'s exit codes through the real commander surface and the
 * real `devServer` (C-001, S-004, S-012). Every case here fails before the
 * Astro child would be spawned, so nothing boots; the booted paths (smoke,
 * SIGINT, reload) are test/acceptance/dev.test.ts. The mapping of each error
 * class in isolation is cli_dev_error_mapping.test.ts.
 */

async function runMain(args: string[]) {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    outChunks.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
  try {
    await main(["node", "ocx-catalog", ...args]);
    return { exitCode: process.exitCode as number | undefined, stdout: outChunks.join(""), stderr: errChunks.join("") };
  } finally {
    process.exitCode = undefined;
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

/** A minimal wire-shaped source directory, the `--source` sugar's input. */
async function writeSourceFixture(dir: string): Promise<string> {
  const sourceDir = join(dir, "source");
  await mkdir(join(sourceDir, "p"), { recursive: true });
  await writeFile(join(sourceDir, "config.json"), JSON.stringify({ format_version: 1 }), "utf8");
  return sourceDir;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("usage errors exit 64", () => {
  it("--source and --config together, naming the conflict", async () => {
    const { exitCode, stderr } = await runMain(["dev", "--source", "../index", "--config", "catalog.config.json"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("ocx-catalog dev: --source and --config are mutually exclusive");
  });

  it.each([["not-a-number"], ["0"], ["-1"], ["65536"], ["4321.5"]])("--port %s", async (port) => {
    const { exitCode, stderr } = await runMain(["dev", "--source", ".", "--port", port]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain(`invalid --port value "${port}"`);
  });

  it("an unknown flag, through commander", async () => {
    const { exitCode } = await runMain(["dev", "--frobnicate"]);
    expect(exitCode).toBe(USAGE);
  });
});

describe("data and availability errors", () => {
  it("bare dev resolves ./catalog.config.json and exits 65 naming it when it is missing", async () => {
    const { exitCode, stderr } = await runMain(["dev"]);
    expect(exitCode).toBe(DATA);
    expect(stderr).toContain("ocx-catalog dev:");
    expect(stderr).toContain(join(repoRoot, "catalog.config.json"));
  });

  it("--config pointing at nothing exits 65", async () => {
    await withTempDir("cli-dev-noconfig-", async (dir) => {
      const missing = join(dir, "nope.json");
      const { exitCode, stderr } = await runMain(["dev", "--config", missing]);
      expect(exitCode).toBe(DATA);
      expect(stderr).toContain(missing);
    });
  });

  it("a requested --port that is already bound exits 69, naming the port, and creates no scratch root", async () => {
    await withTempDir("cli-dev-portbusy-", async (dir) => {
      const sourcePath = await writeSourceFixture(dir);
      const port = await findFreePort();
      const occupied = await occupyPort(port);
      try {
        const { exitCode, stderr } = await runMain(["dev", "--source", sourcePath, "--port", String(port)]);

        expect(exitCode).toBe(UNAVAILABLE);
        expect(stderr).toContain("ocx-catalog dev:");
        expect(stderr).toContain(`port ${port} is already in use`);
        // Scratch roots are named for the creating pid: other test files' roots do not count.
        expect((await scratchBaseDirEntries()).filter((entry) => entry.includes(`-${process.pid}-`))).toEqual([]);
      } finally {
        await occupied.release();
      }
    });
  });
});
