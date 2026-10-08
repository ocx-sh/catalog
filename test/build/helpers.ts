import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's own root — same directory `package.json`/`node_modules` live in. */
export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Absolute path to the base directory `createScratchRoot()` uses when
 * `node_modules` is present (this repo's own case — `scratch.ts`'s own
 * "Location" doc) — duplicated here rather than imported, since it's a
 * private implementation detail of that module, not exported. */
export const scratchBaseDir = join(repoRoot, "node_modules", ".cache", "ocx-catalog");

/** Every entry currently in `scratchBaseDir`, or `[]` if it doesn't exist
 * yet (nothing has ever created a scratch root in this checkout). */
export async function scratchBaseDirEntries(): Promise<string[]> {
  return readdir(scratchBaseDir).catch(() => []);
}

/**
 * Runs `fn` against a freshly created, isolated temp directory, removing it
 * (recursively) afterward regardless of outcome. Mirrors
 * `test/config/helpers.ts`'s `withTempDir` — kept separate (DAMP) since this
 * suite's fixtures (wire-shaped source trees, docs dirs, css files) are
 * shaped differently from config-loader fixtures.
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Finds a currently-free TCP port by letting the OS assign one, then
 * releasing it — used to build a "port already in use" fixture (bind it
 * again deliberately) without hardcoding a port number that might collide
 * with something else on the test machine. */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        srv.close();
        reject(new Error("could not determine assigned port"));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

/** Binds and holds a TCP listener on `port` until `release()` is called —
 * used to simulate "port already in use" for `devServer`. */
export async function occupyPort(port: number): Promise<{ release: () => Promise<void> }> {
  const srv = createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    release: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}
