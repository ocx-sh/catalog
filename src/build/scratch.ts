import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * mkdtemp scratch-root lifecycle (C-005) — the per-invocation tree `engine.ts`
 * (`buildCatalog`) and `dev.ts` (`devServer`, inside its child process) write
 * synthesized pages, the generated `.vitepress/` config, and the theme shim
 * into.
 *
 * ## Location — NOT `os.tmpdir()` (Specify-spike correction)
 *
 * Every root is created under `<cwd>/node_modules/.cache/ocx-catalog/`
 * (falling back to `<cwd>/.ocx-catalog/` when the consumer project has no
 * `node_modules` of its own yet). A bare `mkdtemp` root under `os.tmpdir()`
 * — the original design — has no `node_modules` chain of its own: Node's
 * bare-specifier resolution for the generated config's `import ... from
 * "vitepress"` (and the theme shim's `import Theme from
 * "@ocx-sh/catalog/theme"`) walks up ANCESTORS OF THE IMPORTING FILE, which
 * never reaches this package's install from an unrelated `/tmp` tree — a
 * real `vitepress build()` against such a root fails outright with a
 * module-resolution error (Specify-phase spike, empirically confirmed).
 * Nesting the scratch root inside the CONSUMER's own `node_modules` fixes
 * this for free: walking up from `<cwd>/node_modules/.cache/ocx-catalog/
 * <unique>/.vitepress/config.mts` reaches `<cwd>/node_modules` itself as an
 * ancestor's own `node_modules` directory, so every bare import this
 * package's generated config or theme shim needs resolves through the
 * consumer's REAL install — no symlink, no `resolve.alias`, no extra
 * plumbing.
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
 *   (typically from a `finally`) once they're done. Node's OWN default
 *   disposition for `SIGINT`/`SIGTERM` (when no other code in the process
 *   installs its own listener for those signals — `cli/dev.ts` does, for its
 *   own graceful shutdown, but only in the PARENT process, which never calls
 *   `createScratchRoot` itself) still routes through this same `exit` event,
 *   so a plain Ctrl-C is covered without this module needing its own signal
 *   listeners — deliberately NOT added: installing a `SIGINT`/`SIGTERM`
 *   listener overrides Node's default termination behavior for every OTHER
 *   listener-free code path in the process, a correctness footgun this
 *   module has no way to reason about from inside a shared library.
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

/** True when `dir` exists and is a directory. */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The base directory every scratch root is created under — see this module's
 * doc "Location" section for why it's the consumer's own `node_modules`
 * rather than `os.tmpdir()`.
 *
 * Exported for its second caller, `sources_pipeline.ts`, which puts the
 * `url` source layer's cross-build fetch cache in a sibling subdirectory:
 * that cache's whole value is surviving BETWEEN builds (ETag/conditional GET
 * + content-addressed blobs, `walker.ts`), so it must live NEXT TO the
 * scratch roots, never inside one — a self-sweeping root would delete it
 * every run and silently turn every build into a cold fetch.
 */
export async function cacheBaseDir(): Promise<string> {
  const cwd = process.cwd();
  const nodeModules = join(cwd, "node_modules");
  if (await isDirectory(nodeModules)) {
    return join(nodeModules, ".cache", "ocx-catalog");
  }
  return join(cwd, ".ocx-catalog");
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
      // Vite's dep-optimizer cache lives INSIDE this root (`config_gen.ts`
      // points `vite.cacheDir` here), and it keeps writing for a moment after
      // `server.close()` resolves. A bare recursive `rm` walks the tree, then
      // fails `rmdir` with ENOTEMPTY because a file reappeared underneath it —
      // observed crashing `ocx-catalog dev` on Ctrl-C against a real index.
      // Node retries exactly this errno class when asked to.
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}
