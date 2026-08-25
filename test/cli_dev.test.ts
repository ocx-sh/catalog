import { mkdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { main } from "../src/cli/main.js";
import { USAGE, DATA, UNAVAILABLE } from "../src/cli/exit.js";
import {
  findFreePort,
  isProcessAlive,
  occupyPort,
  scratchBaseDirEntries,
  waitUntil,
  withTempDir,
  workerProcessPids,
} from "./build/helpers.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Writes a minimal wire-shaped source directory — `--source` sugar for an
 * implicit single-entry, `root: true` config (C-001). Mirrors
 * `test/build/dev.test.ts`'s own fixture (kept local here too — DAMP,
 * different test file). */
async function writeSourceFixture(dir: string): Promise<string> {
  const sourceDir = join(dir, "source");
  await mkdir(join(sourceDir, "p"), { recursive: true });
  await writeFile(join(sourceDir, "config.json"), JSON.stringify({ format_version: 1 }), "utf8");
  return sourceDir;
}

/** Resolves true once a TCP connection to `port` succeeds. */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("error", () => resolvePort(false));
  });
}

/** Polls `isPortOpen` until it resolves true — used to know when a real
 * dev server the test just started is actually listening, before
 * proceeding (e.g. sending it a SIGINT). */
async function waitForPortOpen(port: number): Promise<void> {
  while (!(await isPortOpen(port))) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

/*
 * `ocx-catalog dev`'s `--source`/`--config` mutual-exclusion (C-001),
 * Implement phase (`cli/dev.ts`'s `runDev`).
 *
 * Bare `dev` (neither flag) now DOES resolve a default config path
 * (`./catalog.config.json`, same convention as `build`'s own
 * `DEFAULT_CONFIG_FILE`) — the orchestrator ruling that landed alongside
 * this WP's Implement phase corrected the stub-phase assumption this file
 * originally test-drove ("no default-path resolution exists or is
 * documented anywhere in this tree"); see `test/cli.test.ts`'s matching
 * `build`/`dev` case for the same assertion against the FULL CLI surface.
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
  await main(["node", "ocx-catalog", ...args]);
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  outSpy.mockRestore();
  errSpy.mockRestore();
  return { exitCode, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("C-001 ocx-catalog dev — --source/--config mutual exclusion", () => {
  it("--source and --config together exit 64 (USAGE), naming the conflict", async () => {
    const { exitCode, stderr } = await runMain(["dev", "--source", "../index", "--config", "catalog.config.json"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("--source");
    expect(stderr).toContain("--config");
  });

  it("bare dev (neither flag) resolves the default ./catalog.config.json and surfaces its real ConfigError", async () => {
    const { exitCode, stderr } = await runMain(["dev"]);
    expect(exitCode).toBe(DATA);
    expect(stderr).toContain("ocx-catalog dev:");
    expect(stderr).toContain(join(repoRoot, "catalog.config.json"));
  });
});

describe("C-001/C-005/S-003 ocx-catalog dev — full CLI lifecycle", () => {
  it("an invalid --port value exits 64 (USAGE) before devServer is ever reached", async () => {
    const { exitCode, stderr } = await runMain(["dev", "--source", ".", "--port", "not-a-number"]);
    expect(exitCode).toBe(USAGE);
    expect(stderr).toContain("--port");
  });

  it(
    "--smoke boots a real server and exits 0",
    async () => {
      await withTempDir("cli-dev-smoke-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const { exitCode, stderr } = await runMain(["dev", "--source", sourcePath, "--smoke"]);
        expect(exitCode).toBeUndefined();
        expect(stderr).toBe("");
      });
    },
    30_000,
  );

  it(
    "a requested port already bound maps devServer's BuildError to exit 69, naming the port, and leaves no orphaned worker process or scratch dir",
    async () => {
      await withTempDir("cli-dev-portbusy-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const port = await findFreePort();
        const occupied = await occupyPort(port);
        try {
          const pidsBefore = new Set(workerProcessPids());
          const scratchBefore = new Set(await scratchBaseDirEntries());

          const { exitCode, stderr } = await runMain([
            "dev",
            "--source",
            sourcePath,
            "--port",
            String(port),
            "--smoke",
          ]);
          expect(exitCode).toBe(UNAVAILABLE);
          expect(stderr).toContain("ocx-catalog dev:");
          expect(stderr).toContain(String(port));

          // Same reasoning as test/build/dev.test.ts's equivalent case: pids
          // are diffed against the snapshot above (not a global count) so
          // other test FILES' own concurrently-running dev-server workers
          // never make this assertion drift, and the scratch-dir diff
          // isolates THIS call's own leak from other test FILES running in
          // parallel against the same shared base directory.
          const newPids = workerProcessPids().filter((pid) => !pidsBefore.has(pid));
          await waitUntil(() => newPids.every((pid) => !isProcessAlive(pid)));
          const newEntries = (await scratchBaseDirEntries()).filter((entry) => !scratchBefore.has(entry));
          await waitUntil(async () => {
            const current = new Set(await scratchBaseDirEntries());
            return newEntries.every((entry) => !current.has(entry));
          });
        } finally {
          await occupied.release();
        }
      });
    },
    30_000,
  );

  it(
    "interactive mode (no --smoke) waits for SIGINT, then gracefully closes and exits 0",
    async () => {
      await withTempDir("cli-dev-sigint-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const port = await findFreePort();
        const runPromise = runMain(["dev", "--source", sourcePath, "--port", String(port)]);
        await waitForPortOpen(port);
        process.emit("SIGINT");
        const { exitCode, stdout } = await runPromise;
        expect(exitCode).toBeUndefined();
        expect(await isPortOpen(port)).toBe(false);
        // A server that says nothing is indistinguishable from a hung
        // command — and with no --port the port is picked dynamically, so
        // the URL is the only way to find it.
        expect(stdout).toContain(`http://localhost:${port}/`);
      });
    },
    30_000,
  );
});
