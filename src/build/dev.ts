import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../config/errors.js";
import { BuildError } from "./errors.js";
import type { WorkerBootMessage, WorkerToParentMessage } from "./dev_worker_protocol.js";

/**
 * `devServer` (C-005, S-003): the `ocx-catalog dev` entrypoint.
 *
 * ## Child-process design
 *
 * Per the "Vite-in-Vite pitfall" research constraint, `vitepress`'s
 * `createServer()` must never run in the SAME process as another Vite
 * instance — this rules out running it in-process under vitest (vitest's
 * own module transform IS a Vite instance), and, by the same construction,
 * in-process inside the `ocx-catalog` CLI's own process. `devServer()`
 * therefore only ORCHESTRATES from the parent process; the actual
 * `createServer()`/`.listen()` call runs in a forked child
 * (`node:child_process` `fork()` — ESM-compatible IPC), a dedicated worker
 * entry module (`dev_worker.ts`, compiled to `dist/build/dev_worker.js` —
 * see the "Worker entry resolution" note below for why it's always the
 * COMPILED path, even when `devServer()` itself runs from TypeScript
 * source under vitest).
 *
 * Sequence:
 * 1. Parent forks the worker, then sends a single `{ type: "boot", ... }`
 *    IPC message carrying `configPath`/`sourcePath`/`port` (never argv —
 *    avoids leaking a filesystem path through `ps`).
 * 2. Worker builds its own scratch root (`scratch.ts`/`pages.ts`/
 *    `config_gen.ts` — the same pipeline `engine.ts` uses for `build`) and
 *    calls `createServer()` + `.listen()`.
 * 3. Worker sends `{ type: "ready", port }` back over IPC once listening,
 *    or `{ type: "error", message }` on failure (mapped to `BuildError`
 *    `UNAVAILABLE` here — e.g. port already bound, S-003).
 * 4. `devServer()` resolves with a `DevServerHandle` as soon as `ready`
 *    arrives — `smoke` doesn't change this: it's the CALLER's job (see
 *    `cli/dev.ts`'s `runDev`) to decide whether to `close()` immediately
 *    after boot (`--smoke`) or wait for `SIGINT` (interactive). This
 *    function's own contract stays black-box identical either way.
 * 5. `DevServerHandle.close()` sends the child a `{ type: "shutdown" }` IPC
 *    message (graceful — lets the worker's own `scratch.ts` `dispose()` run
 *    inside the child) and awaits the child's `exit` event. Safe to call
 *    more than once (idempotent no-op after the first call).
 *
 * ## Worker entry resolution
 *
 * `fork()` spawns a plain `node` process — it cannot run a `.ts` file
 * directly, so the worker is always resolved to the COMPILED
 * `dist/build/dev_worker.js`, computed relative to THIS module's own
 * `import.meta.url` (`src/ci/templates.ts` uses the identical technique for
 * a same-depth resource): `src/build/dev.ts` and `dist/build/dev.js` sit at
 * the SAME relative depth under the repo root, so
 * `../../dist/build/dev_worker.js` resolves correctly whether this module
 * itself is currently running as TypeScript source (vitest, via vite-node)
 * or as compiled `dist/build/dev.js` (a real, published CLI invocation).
 * `test/global-setup.ts` guarantees `dist/` is freshly built from the
 * CURRENT source tree before any test runs, so the compiled worker is
 * always in sync during tests too.
 *
 * ## `--source` vs `--config`
 *
 * C-001: `dev [--source <path>] [--config <path>] ...` — S-003's own
 * example (`ocx-catalog dev --source ../index`) runs with NO config file.
 * `sourcePath` is sugar for an implicit single-entry, `root:true` config (no
 * `brand`/`nav` customization — the worker defaults to a generic
 * brand title). The CLI layer (`cli/dev.ts`) validates "exactly one of
 * `--source`/`--config`" (or defaults to `./catalog.config.json` when
 * NEITHER is given, matching `build`'s own convention) before calling here;
 * this function's own contract is simply that at least one resolution path
 * is present.
 *
 * ## Dep-optimizer staleness (linked `file:` packages) — deferred
 *
 * A long-running `dev` session against a `file:`-linked `@ocx-sh/catalog`
 * (the index repo's own dogfood setup, C-010) can go stale mid-session:
 * Vite's esbuild dep-optimizer pre-bundles `node_modules`-resolved bare
 * imports into `.vitepress/cache/deps/*.js`, keyed by a hash of the
 * lockfile + config — a rebuild of the LINKED package's `dist/` on disk
 * while the dev server keeps running does not, by itself, change that hash,
 * so Vite keeps serving the stale pre-bundle. No mitigation implemented in
 * this phase (not exercised by S-003's own contract, which only requires
 * `--smoke` to boot/assert/cleanup once) — a real fix (watching the linked
 * package's build-output mtime and calling Vite's `server.restart({
 * forceOptimize: true })`) is future work, not invented here speculatively.
 */
export interface DevServerOptions {
  /** Mutually exclusive with `sourcePath` — see the file doc's "--source
   * vs --config" section. Resolved against `process.cwd()` when relative. */
  readonly configPath?: string;
  readonly sourcePath?: string;
  /** Requested port; `undefined` lets VitePress/Vite pick one. */
  readonly port?: number;
  /** Accepted for forward-compat with S-003's `--smoke` flag; `devServer()`
   * itself boots and resolves identically regardless of this value — the
   * smoke/interactive distinction (close immediately vs. wait for
   * `SIGINT`) lives entirely in the CALLER (`cli/dev.ts`'s `runDev`). */
  readonly smoke: boolean;
}

export interface DevServerHandle {
  /** The port the server ended up bound to. */
  readonly port: number;
  /** Gracefully shuts down the worker (its own scratch root disposed
   * inside the child) and resolves once the child has exited. Safe to
   * call more than once. */
  close(): Promise<void>;
}

const WORKER_ENTRY = fileURLToPath(new URL("../../dist/build/dev_worker.js", import.meta.url));

export async function devServer(options: DevServerOptions): Promise<DevServerHandle> {
  const child = fork(WORKER_ENTRY, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    // `error` here is Node's own ChildProcess spawn/IPC failure event (e.g.
    // the worker script itself can't be spawned) — distinct from this
    // module's own `{ type: "error" }` boot-failure MESSAGE, handled below.
    // A listener is required: Node throws an uncaught exception for an
    // unhandled `error` event with zero listeners.
    child.once("error", (err) => rejectPort(new BuildError("UNAVAILABLE", err.message)));
    child.once("exit", (code) =>
      rejectPort(new BuildError("UNAVAILABLE", `dev server worker exited before becoming ready (code ${code})`)),
    );
    child.on("message", (message: WorkerToParentMessage) => {
      if (message.type === "ready") {
        resolvePort(message.port);
      } else if (message.type === "error") {
        // A ConfigError doesn't survive the IPC boundary as itself
        // (structured-clone strips the prototype) — reconstruct it from
        // the explicit `configErrorCode` the worker sent instead, so
        // `cli/dev.ts`'s `instanceof ConfigError` branch (same one
        // `build`/`buildCatalog` already goes through) still fires here.
        rejectPort(
          message.configErrorCode !== undefined
            ? new ConfigError(message.configErrorCode, message.message)
            : new BuildError("UNAVAILABLE", message.message),
        );
      }
    });
    const boot: WorkerBootMessage = {
      type: "boot",
      configPath: options.configPath,
      sourcePath: options.sourcePath,
      port: options.port,
    };
    child.send(boot);
  });

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolveClose) => {
      child.once("exit", () => resolveClose());
      child.send({ type: "shutdown" });
    });
  }

  return { port, close };
}
