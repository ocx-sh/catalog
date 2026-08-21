import type { ConfigErrorCode } from "../config/errors.js";

/**
 * IPC message shapes exchanged between `dev.ts` (parent, orchestrates from
 * the `ocx-catalog` CLI's own process) and `dev_worker.ts` (child, the only
 * place `vitepress`'s `createServer()` ever runs — see `dev.ts`'s own doc
 * "Child-process design" section for why). A dedicated types-only module so
 * neither side needs to import the OTHER side's executable code just to
 * share these shapes.
 */

/** Parent -> worker: boot the dev server. Sent exactly once, immediately
 * after `fork()`. */
export interface WorkerBootMessage {
  readonly type: "boot";
  readonly configPath?: string;
  readonly sourcePath?: string;
  readonly port?: number;
}

/** Parent -> worker: shut down gracefully (stop listening, dispose the
 * scratch root, exit). */
export interface WorkerShutdownMessage {
  readonly type: "shutdown";
}

export type ParentToWorkerMessage = WorkerBootMessage | WorkerShutdownMessage;

/** Worker -> parent: boot outcome. A `configErrorCode` distinguishes a
 * `loadConfig()`-raised `ConfigError` (the worker's `configPath` resolution
 * — see `dev_worker.ts`'s `resolveThemeInputs`) from every other startup
 * failure (e.g. a bound port, S-003), so the parent can reconstruct the
 * SAME error class `cli/dev.ts`'s `runDev` already branches on for
 * `build`/`buildCatalog` — `ConfigError` instances don't survive the IPC
 * boundary as themselves (structured-clone strips the prototype), so this
 * is the explicit, serializable stand-in for `instanceof`. */
export type WorkerToParentMessage =
  | { readonly type: "ready"; readonly port: number }
  | { readonly type: "error"; readonly message: string; readonly configErrorCode?: ConfigErrorCode };
