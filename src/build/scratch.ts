import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { cacheBaseDir } from "./cache_dir.js";

/**
 * mkdtemp scratch-root lifecycle (C-005) — the per-invocation Astro root.
 * `engine.ts` (`buildCatalog`) fills it with `astro.config.mjs`, `site.json`
 * and `public/` (and `src/content.config.ts`, only when `docs` is set); it
 * never holds `src/fetch.ts` or any other page source — the pages ship with
 * this package and are injected as routes (C-045). `dev.ts` (`devServer`)
 * fills the same root through the same `writeRenderTree` and runs `astro dev`
 * against it.
 *
 * ## Location — NOT `os.tmpdir()` (Specify-spike correction)
 *
 * Every root is created under `<cwd>/node_modules/.cache/ocx-catalog/`
 * (falling back to `<cwd>/.ocx-catalog/` when the consumer project has no
 * `node_modules` of its own yet). A bare `mkdtemp` root under `os.tmpdir()`
 * has no `node_modules` chain of its own: Node's bare-specifier resolution
 * walks up ANCESTORS OF THE IMPORTING FILE, which never reaches this
 * package's install from an unrelated `/tmp` tree, so the Astro child cannot
 * even find `astro` from its `--root` (verified: `Cannot resolve entry module
 * astro/entrypoints/prerender`). Nesting the scratch root inside the
 * CONSUMER's own `node_modules` fixes this for free: walking up from
 * `<cwd>/node_modules/.cache/ocx-catalog/<unique>/` reaches
 * `<cwd>/node_modules` itself as an ancestor's own `node_modules` directory —
 * no symlink, no `resolve.alias`, no extra plumbing. The same ancestry keeps
 * the injected route entrypoints (in this package's install) at a sane
 * relative path from the root, which Astro turns into a page module id.
 *
 * Guarantees:
 * - **Per-pid.** The directory name is prefixed `ocx-catalog-<pid>-` before
 *   `mkdtemp`'s random suffix — two `ocx-catalog` processes (e.g. a `build`
 *   and a concurrently running `dev`) never collide, and a leftover
 *   directory from a killed run is identifiable by the pid that made it.
 * - **Self-sweeping.** Every root this module creates is tracked in a
 *   module-level registry; a single process-wide `exit` hook (registered
 *   once, idempotently, on first `createScratchRoot` call) removes every
 *   still-tracked root as a best-effort net. This is a BACKSTOP, not the
 *   primary path — callers are still expected to call `dispose()` explicitly
 *   (typically from a `finally`) once they're done. It does NOT cover a
 *   default `SIGINT`/`SIGTERM`: with no listener installed Node ends the
 *   process on the signal WITHOUT emitting `exit`, so the hook never runs.
 *   That is why the callers (`buildCatalog`, `devServer`) each hold their own
 *   `SIGINT`/`SIGTERM` handlers for the root's whole life and unwind through
 *   `dispose()`; this module installs none itself, because a listener
 *   overrides Node's default termination for the whole process, which a
 *   shared helper cannot reason about.
 * - **Ceiling, stated plainly (not a silent gap):** `SIGKILL` or a
 *   `process.exit()` called from code this module doesn't control bypasses
 *   every Node exit hook, this one included — same ceiling every Node
 *   cleanup-on-exit pattern has. A crashed-and-uncleaned root is a
 *   `ocx-catalog-<pid>-*` directory directly under the base dir described
 *   above, safe to remove by hand once its pid is confirmed dead.
 *
 * `dispose()` is idempotent-safe to call more than once — the SECOND call is
 * a no-op (tracked via a closure-local flag), never re-touching the
 * filesystem or throwing, since both an explicit caller `finally` and the
 * process-exit backstop can race to dispose the same root.
 */
export interface ScratchRoot {
  /** Absolute path to the created directory. */
  readonly path: string;
  /** Removes the directory tree and drops it from the self-sweeping
   * registry. Safe to call more than once. */
  dispose(): Promise<void>;
}

/** Every scratch root created in this process that hasn't been disposed
 * yet — the `exit`-hook backstop's sweep list. */
const registry = new Set<string>();
let cleanupHookRegistered = false;

/** The process-exit backstop's actual sweep logic — a plain, synchronous,
 * dependency-injected function (takes the paths to remove rather than
 * closing over the module-private `registry`) so it's directly
 * unit-testable without needing to synthesize an actual process exit.
 * `force: true` already makes `rmSync` a no-op for a path that's already
 * gone (the expected case — most tracked roots are disposed properly
 * before the process ever exits); no try/catch around it — a truly
 * exceptional OS-level failure here is the same documented ceiling as
 * `SIGKILL` bypassing this hook entirely (see this module's doc "Ceiling"
 * note), not a case worth an untestable defensive branch for. */
export function sweepScratchRoots(paths: Iterable<string>): void {
  for (const root of paths) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function registerCleanupHook(): void {
  if (cleanupHookRegistered) return;
  cleanupHookRegistered = true;
  process.on("exit", () => sweepScratchRoots(registry));
}

export async function createScratchRoot(): Promise<ScratchRoot> {
  registerCleanupHook();
  const base = await cacheBaseDir();
  await mkdir(base, { recursive: true });
  const path = await mkdtemp(join(base, `ocx-catalog-${process.pid}-`));
  registry.add(path);

  let disposed = false;
  return {
    path,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      registry.delete(path);
      // `maxRetries`/`retryDelay` are load-bearing, not belt-and-braces:
      // Vite's dep-optimizer cache lives INSIDE this root (the generated config points
      // `cacheDir` here), and it keeps writing for a moment after
      // `server.close()` resolves. A bare recursive `rm` walks the tree, then
      // fails `rmdir` with ENOTEMPTY because a file reappeared underneath it —
      // observed crashing `ocx-catalog dev` on Ctrl-C against a real index.
      // Node retries exactly this errno class when asked to.
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}
