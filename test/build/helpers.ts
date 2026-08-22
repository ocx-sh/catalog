import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's own root — same directory `package.json`/`node_modules` live in. */
export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Absolute path to `dev.ts`'s compiled forked worker entry — unique per
 * checkout/worktree, so matching against it (via `pgrep -f`) is safe even
 * when other concurrent agents/worktrees run their own `dev_worker.js`. */
export const workerEntryPath = join(repoRoot, "dist", "build", "dev_worker.js");

/** Absolute path to the base directory `createScratchRoot()` uses when
 * `node_modules` is present (this repo's own case — `scratch.ts`'s own
 * "Location" doc) — duplicated here rather than imported, since it's a
 * private implementation detail of that module, not exported. */
export const scratchBaseDir = join(repoRoot, "node_modules", ".cache", "ocx-catalog");

/** Pids of every currently-running OS process whose command line matches
 * `workerEntryPath` — used to prove a `devServer()` worker child actually
 * terminated (no orphan) rather than just that the PARENT's promise
 * settled. Returns the SET, not a count: vitest runs test FILES in
 * parallel, so other files' own (legitimately still-running) dev-server
 * workers share this same matcher — a global count comparison drifts
 * against that unrelated traffic. Callers diff pids across a before/after
 * snapshot instead, isolating the specific pid(s) THIS call spawned. */
export function workerProcessPids(): number[] {
  const result = spawnSync("pgrep", ["-f", workerEntryPath], { encoding: "utf8" });
  // pgrep exits 1 (no non-empty stdout) when nothing matches — not an error.
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(Number);
}

/** True iff a process with this pid is currently running — POSIX
 * `kill(pid, 0)` sends no signal, it only checks existence/permission. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls `check` every 25ms until it resolves true, or throws once
 * `timeoutMs` elapses — used to await an async side effect (a forked
 * child's exit, a swept scratch dir) that has no promise of its own to
 * await from outside the module under test. */
export async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

/**
 * Runs `fn` to completion while concurrently sampling `workerProcessPids()`
 * every few ms, capturing every observed pid not already in `pidsBefore`.
 *
 * Exists because a dev-server worker's boot-failure IPC message races its
 * own `process.exit()` (`dev.ts`'s own doc note): sampling pids only ONCE,
 * after `fn` has already settled, can miss a worker that already exited by
 * then — `capturedPids` would silently come back empty, and an "every
 * captured pid is now dead" assertion built on top of that passes
 * vacuously (true of the empty set) without ever having observed a live
 * worker at all. Sampling concurrently instead observes the worker's pid
 * WHILE it's still alive, whichever narrow window that falls in, so a
 * caller can assert `capturedPids.length > 0` is actually reachable before
 * asserting on its eventual cleanup.
 */
export async function captureNewPidsDuring<T>(
  pidsBefore: ReadonlySet<number>,
  fn: () => Promise<T>,
): Promise<{ settled: PromiseSettledResult<T>; capturedPids: number[] }> {
  const captured = new Set<number>();
  let polling = true;
  const pollLoop = (async () => {
    while (polling) {
      for (const pid of workerProcessPids()) {
        if (!pidsBefore.has(pid)) captured.add(pid);
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  })();

  const [settled] = await Promise.allSettled([fn()]);
  polling = false;
  await pollLoop;
  return { settled, capturedPids: [...captured] };
}

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

/**
 * Symlinks this package's own `node_modules` into `scratchRoot`.
 *
 * GAP (flagged in the test-suite report, not guessed at): a scratch root is
 * a bare `mkdtemp` directory under `os.tmpdir()`, with no `node_modules`
 * chain of its own reaching this package's install — Node's bare-specifier
 * resolution for a generated config's `import ... from "vitepress"` (and the
 * theme shim's `import Theme from "@ocx-sh/catalog/theme"`) walks up
 * ancestors of the FILE doing the importing, which never reaches this
 * package's `node_modules` from an unrelated `/tmp` tree. None of
 * scratch.ts/config_gen.ts's docs say how Implement phase resolves this —
 * confirmed empirically (STEP 0 spike) that a real `vitepress build()`
 * against an external root fails outright without it. This helper is
 * TEST-SIDE scaffolding standing in for whatever mechanism Implement phase
 * picks (a similar symlink, `resolve.alias`, or something else) — it does
 * not assert that symlinking is the "correct" answer.
 */
export async function linkNodeModules(scratchRoot: string): Promise<void> {
  await symlink(join(repoRoot, "node_modules"), join(scratchRoot, "node_modules"), "dir");
}

/** Writes a small real docs fixture (S-006) under `dir`, returns its path. */
export async function writeDocsFixture(dir: string): Promise<string> {
  const docsDir = join(dir, "docs-src");
  await mkdir(docsDir, { recursive: true });
  await writeFile(join(docsDir, "guide.md"), "# Guide\n\nHello from the docs fixture.\n", "utf8");
  return docsDir;
}

/** Writes a docs fixture with a NESTED subdirectory (S-006's named case —
 * a docs tree deeper than one level), returns its path. */
export async function writeNestedDocsFixture(dir: string): Promise<string> {
  const docsDir = join(dir, "docs-src-nested");
  await mkdir(join(docsDir, "guides"), { recursive: true });
  await writeFile(join(docsDir, "guide.md"), "# Guide\n\nHello from the docs fixture.\n", "utf8");
  await writeFile(join(docsDir, "guides", "sub.md"), "# Sub guide\n\nNested page.\n", "utf8");
  return docsDir;
}

/** Writes a static-assets (`publicDir`) fixture with a nested asset, returns
 * its path. */
export async function writePublicDirFixture(dir: string): Promise<string> {
  const publicDir = join(dir, "public-src");
  await mkdir(join(publicDir, "nested"), { recursive: true });
  await writeFile(join(publicDir, "favicon.svg"), "<svg><!-- fixture favicon --></svg>\n", "utf8");
  await writeFile(join(publicDir, "nested", "logo.svg"), "<svg><!-- fixture nested asset --></svg>\n", "utf8");
  return publicDir;
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
