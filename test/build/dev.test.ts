import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { devServer } from "../../src/build/dev.js";
import { BuildError } from "../../src/build/errors.js";
import {
  captureNewPidsDuring,
  findFreePort,
  isProcessAlive,
  occupyPort,
  scratchBaseDirEntries,
  waitUntil,
  withTempDir,
  workerProcessPids,
} from "./helpers.js";

/*
 * `devServer` (C-005/S-003) has no worker module at all yet (per dev.ts's
 * own doc, the actual `createServer()`/`.listen()` call is an internal
 * detail added in Implement phase, deliberately not fixed as public
 * surface here) — so this file tests ONLY the PUBLIC `devServer()` /
 * `DevServerHandle` contract, black-box. Per the "Vite-in-Vite pitfall"
 * research constraint, the real dev server must run in a forked CHILD
 * process — this file never calls vitepress's own `createServer()`
 * in-process; it only calls the public `devServer()` API, which is the
 * sanctioned way to exercise that child-process lifecycle from a test.
 */

/** Writes a minimal wire-shaped source directory — `sourcePath` is sugar
 * for an implicit single-entry, `root: true` config (C-001). Deliberately
 * EMPTY of packages: `--source` must still boot against an index that has
 * none (`dev_worker.ts`'s `IMPLICIT_SOURCE_LABEL` exists for exactly that —
 * an unlabeled empty source has no name to derive a label from). */
async function writeSourceFixture(dir: string): Promise<string> {
  const sourceDir = join(dir, "source");
  await mkdir(join(sourceDir, "p"), { recursive: true });
  await writeFile(join(sourceDir, "config.json"), JSON.stringify({ format_version: 1 }), "utf8");
  return sourceDir;
}

/** The same fixture WITH a package, for the live-wire-data case (S-003). */
async function writePopulatedSourceFixture(dir: string): Promise<{ sourceDir: string; rootJson: string }> {
  const sourceDir = join(dir, "populated-source");
  const rootJson = JSON.stringify({
    name: "ocx.sh/acme/widget",
    repository: "oci://ghcr.io/ocx-contrib/widget",
    owners: [{ github: "octocat", github_id: 1 }],
    status: "active",
    deprecated_message: null,
    created: "2026-01-01",
    desc: null,
    tags: {},
  });
  await mkdir(join(sourceDir, "p", "acme"), { recursive: true });
  await writeFile(join(sourceDir, "config.json"), JSON.stringify({ format_version: 1 }), "utf8");
  await writeFile(join(sourceDir, "p", "acme", "widget.json"), rootJson, "utf8");
  return { sourceDir, rootJson };
}

/** Resolves true once a TCP connection to `port` succeeds, false if it's
 * refused — used to prove `close()` actually tore the child down (no
 * orphaned listener), without depending on `fetch`'s own retry/timeout
 * behavior. */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("C-005/S-003 devServer — child-process lifecycle", () => {
  it(
    "--smoke boots a real server, resolves a valid port, and the landing page responds",
    async () => {
      await withTempDir("catalog-dev-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const handle = await devServer({ sourcePath, smoke: true });
        try {
          expect(Number.isInteger(handle.port)).toBe(true);
          expect(handle.port).toBeGreaterThan(0);
          expect(handle.port).toBeLessThanOrEqual(65535);

          const response = await fetch(`http://127.0.0.1:${handle.port}/`);
          expect(response.ok).toBe(true);
        } finally {
          await handle.close();
        }
      });
    },
    30_000,
  );

  it(
    "serves the configured source's live wire data and the merged catalog (S-003)",
    async () => {
      await withTempDir("catalog-dev-wire-", async (dir) => {
        const { sourceDir, rootJson } = await writePopulatedSourceFixture(dir);
        const handle = await devServer({ sourcePath: sourceDir, smoke: true });
        try {
          // The view model the catalog grid fetches — built from the source,
          // not an empty placeholder.
          const catalogResponse = await fetch(`http://127.0.0.1:${handle.port}/data/catalog/catalog.json`);
          expect(catalogResponse.ok).toBe(true);
          const catalog = (await catalogResponse.json()) as { packages: { namespace: string; package: string }[] };
          expect(catalog.packages.map((entry) => `${entry.namespace}/${entry.package}`)).toEqual(["acme/widget"]);

          // The package root itself, byte-verbatim, at the wire path a
          // detail page's own fetch uses (the root:true source, so no
          // index/<label> prefix).
          const rootResponse = await fetch(`http://127.0.0.1:${handle.port}/p/acme/widget.json`);
          expect(rootResponse.ok).toBe(true);
          expect(await rootResponse.text()).toBe(rootJson);

          // ...and the detail page synthesized for it.
          const pageResponse = await fetch(`http://127.0.0.1:${handle.port}/acme/widget`);
          expect(pageResponse.ok).toBe(true);
        } finally {
          await handle.close();
        }
      });
    },
    30_000,
  );

  it(
    "close() tears the child process down — no orphaned listener on the port afterward",
    async () => {
      await withTempDir("catalog-dev-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const handle = await devServer({ sourcePath, smoke: true });
        const { port } = handle;
        await handle.close();
        expect(await isPortOpen(port)).toBe(false);
      });
    },
    30_000,
  );

  it(
    "close() is idempotent — calling it twice never throws",
    async () => {
      await withTempDir("catalog-dev-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const handle = await devServer({ sourcePath, smoke: true });
        await handle.close();
        await expect(handle.close()).resolves.not.toThrow();
      });
    },
    30_000,
  );

  it(
    "a requested port already bound rejects with BuildError UNAVAILABLE naming the port, and leaves no orphaned worker process or scratch dir",
    async () => {
      await withTempDir("catalog-dev-", async (dir) => {
        const sourcePath = await writeSourceFixture(dir);
        const port = await findFreePort();
        const occupied = await occupyPort(port);
        try {
          const pidsBefore = new Set(workerProcessPids());
          const scratchBefore = new Set(await scratchBaseDirEntries());

          // Isolates the pid(s) THIS call's own worker spawned — other test
          // FILES run in parallel and legitimately keep their OWN dev-server
          // workers alive for the whole matcher `workerProcessPids()` shares,
          // so a global-count comparison drifts against that traffic (a
          // count returning to its earlier value is neither necessary nor
          // sufficient for THIS call's worker having exited). The worker's
          // boot-failure IPC message races its own `process.exit()` — sample
          // pids CONCURRENTLY with the call (`captureNewPidsDuring`) rather
          // than once after it settles, or a worker that already exited by
          // then leaves `capturedPids` empty and the "nothing alive" check
          // below passes vacuously without ever having proven a worker ran.
          const { settled, capturedPids } = await captureNewPidsDuring(pidsBefore, () =>
            devServer({ sourcePath, port, smoke: true }),
          );
          expect(settled.status).toBe("rejected");
          const error = settled.status === "rejected" ? settled.reason : undefined;
          expect(error).toBeInstanceOf(BuildError);
          expect((error as BuildError).code).toBe("UNAVAILABLE");
          expect((error as BuildError).message).toContain(String(port));

          // Proves the worker was actually observed alive at least once —
          // without this, the cleanup assert below (every captured pid now
          // dead) is vacuously true of an empty list.
          expect(capturedPids.length).toBeGreaterThan(0);
          await waitUntil(() => capturedPids.every((pid) => !isProcessAlive(pid)));

          // Diffed against the snapshot above (not the directory's whole
          // contents at the end): other test FILES run in parallel and can
          // legitimately be creating/disposing their OWN scratch roots in
          // this same shared directory concurrently — this isolates the
          // entry THIS call itself would have leaked from that traffic.
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
});
