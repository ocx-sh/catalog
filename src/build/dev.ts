import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { loadConfig } from "../config/load.js";
import type { LoadedConfig, SourceEntry } from "../config/types.js";
import { runAstro, type AstroRun, type SpawnFn } from "./astro_runner.js";
import { writeAstroConfig } from "./astro_config_file.js";
import { onProcessSignal, writeRenderTree } from "./engine.js";
import { startDevReload, type DevReload, type ReloadTimers, type WatchFn } from "./dev_reload.js";
import { BuildError, RenderError } from "./errors.js";
import { createScratchRoot } from "./scratch.js";
import { reservedNamesFor, resolveCatalog, type RemoteCache } from "./sources_pipeline.js";

/**
 * `devServer` (C-023, C-046, S-004): the `ocx-catalog dev` supervisor. It
 * prepares the same scratch root `build` does (`engine.ts`'s `writeRenderTree`),
 * runs `astro dev` in a child bound to `127.0.0.1` (`astro_runner.ts`), waits
 * until the site answers, prints the URL, and then lives until the user stops
 * it. It is a supervisor, not a server: Astro owns the HTTP side, so a Vite
 * instance never shares this process (the old "Vite-in-Vite" constraint).
 *
 * Resolves on a clean stop (SIGINT/SIGTERM, or `--smoke` passing). Rejects with
 * `BuildError` (`UNAVAILABLE`: the requested port is taken; `DATA`: a source
 * problem), `ConfigError` (config), or `RenderError` (the child failed to come
 * up or died on its own); `cli/dev.ts` catches each and maps it to an exit
 * code. The scratch root is removed on every path.
 *
 * `--source <dir>` is sugar for an implicit single-entry, `root: true` config
 * with no branding: the "local" label applies only when the index is empty.
 */
export interface DevServerOptions {
  /** Mutually exclusive with `sourcePath`; resolved against `process.cwd()` when relative. */
  readonly configPath?: string;
  readonly sourcePath?: string;
  /** Requested port. Absent: the first free port from 4321 upward. */
  readonly port?: number;
  /** Boot, GET `<base>` and `<base>data/catalog/catalog.json`, stop, resolve. */
  readonly smoke: boolean;
}

/** Everything `dev` reads from the config (or the `--source` sugar) for one render. */
export interface DevInputs {
  readonly loaded: LoadedConfig;
  /** Only the `--source` sugar sets this: the label of an index with nothing to derive one from. */
  readonly fallbackLabel: string | undefined;
}

/** Test seams; production callers pass nothing. */
export interface DevDeps {
  readonly spawn: SpawnFn;
  readonly env: NodeJS.ProcessEnv;
  /** A GET that resolves with the status; rejects on a connection error. */
  readonly fetch: (url: string) => Promise<{ readonly status: number }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** True when nothing is bound to `127.0.0.1:<port>`. */
  readonly isPortFree: (port: number) => Promise<boolean>;
  /** Registers a signal handler; returns its remover. */
  readonly onSignal: (signal: NodeJS.Signals, handler: () => void) => () => void;
  /** The banner. */
  readonly log: (line: string) => void;
  /** Relayed child output (both streams, C-046) and diagnostics: stderr. */
  readonly warn: (line: string) => void;
  /** The reload loop's file watcher and debounce timers (`dev_reload.ts`'s defaults when absent). */
  readonly watch?: WatchFn;
  readonly timers?: ReloadTimers;
}

const FIRST_PORT = 4321;
/** Ports tried upward from `FIRST_PORT` before giving up. */
const PORT_SCAN = 100;
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 100;
/** How long a child gets to exit after SIGTERM before it is SIGKILLed. */
const STOP_GRACE_MS = 5_000;
const SIGNALS = ["SIGINT", "SIGTERM"] as const;
/** `--source` with no config: a generic title, since there is no file to read one from. */
const IMPLICIT_TITLE = "OCX Catalog";
const IMPLICIT_SOURCE_LABEL = "local";

const realFetch = async (url: string): Promise<{ status: number }> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  await response.body?.cancel();
  return { status: response.status };
};

// Bound to 127.0.0.1, the address the child binds: probing `localhost` could
// answer for the other loopback family.
const realIsPortFree = (port: number): Promise<boolean> =>
  new Promise((settle) => {
    const probe = createServer();
    probe.once("error", () => settle(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => settle(true)));
  });

export const realDevDeps: DevDeps = {
  spawn,
  env: process.env,
  fetch: realFetch,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: Date.now,
  isPortFree: realIsPortFree,
  onSignal: onProcessSignal,
  log: (line) => process.stdout.write(`${line}\n`),
  warn: (line) => process.stderr.write(`${line}\n`),
};

/** Reads the config (or builds the `--source` sugar's implicit one). Re-run by every reload. */
export async function loadDevInputs(options: Pick<DevServerOptions, "configPath" | "sourcePath">): Promise<DevInputs> {
  if (options.configPath !== undefined) {
    return { loaded: await loadConfig(resolve(options.configPath)), fallbackLabel: undefined };
  }
  const entry: SourceEntry = { path: ".", root: true };
  return {
    loaded: {
      // `path: "."` against the source dir itself keeps `path.ts`'s containment check meaningful.
      config: { sources: [entry], brand: { title: IMPLICIT_TITLE }, base: "/" },
      configDir: resolve(options.sourcePath ?? "."),
      sources: [{ entry, label: null }],
    },
    fallbackLabel: IMPLICIT_SOURCE_LABEL,
  };
}

async function choosePort(requested: number | undefined, deps: DevDeps): Promise<number> {
  if (requested !== undefined) {
    if (await deps.isPortFree(requested)) return requested;
    throw new BuildError("UNAVAILABLE", `port ${requested} is already in use`);
  }
  for (let port = FIRST_PORT; port < FIRST_PORT + PORT_SCAN; port++) {
    if (await deps.isPortFree(port)) return port;
  }
  throw new BuildError("UNAVAILABLE", `no free port from ${FIRST_PORT} to ${FIRST_PORT + PORT_SCAN - 1}`);
}

type Readiness = "ready" | "exited" | "timeout";

/** Polls `url` until 200, the child exits, or `READY_TIMEOUT_MS` passes. */
async function waitReady(url: string, run: AstroRun, deps: DevDeps): Promise<Readiness> {
  const deadline = deps.now() + READY_TIMEOUT_MS;
  let cancelled = false;
  const polled = (async (): Promise<Readiness> => {
    while (!cancelled && deps.now() < deadline) {
      const status = await deps.fetch(url).then(
        (response) => response.status,
        () => 0,
      );
      if (status === 200) return "ready";
      await deps.sleep(POLL_MS);
    }
    return "timeout";
  })();
  const exited = run.exit.then((): Readiness => "exited");
  try {
    return await Promise.race([polled, exited]);
  } finally {
    cancelled = true;
  }
}

/** Waits for the child's exit; one that outlives `STOP_GRACE_MS` is SIGKILLed and reaped. */
async function awaitExit(run: AstroRun): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<"grace">((elapsed) => {
    timer = setTimeout(() => elapsed("grace"), STOP_GRACE_MS);
  });
  try {
    if ((await Promise.race([run.exit, grace])) === "grace") {
      run.stop("SIGKILL");
      await run.exit;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** SIGTERM, then `awaitExit`. */
async function terminate(run: AstroRun): Promise<void> {
  run.stop("SIGTERM");
  await awaitExit(run);
}

/** `--smoke`: the page and the catalog both answer 200. */
async function smokeCheck(origin: string, base: string, deps: DevDeps): Promise<void> {
  for (const path of [base, `${base}data/catalog/catalog.json`]) {
    const status = await deps.fetch(`${origin}${path}`).then(
      (response) => response.status,
      (err: unknown) => {
        throw new RenderError(`smoke: GET ${path} failed: ${(err as Error).message}`);
      },
    );
    if (status !== 200) throw new RenderError(`smoke: GET ${path} answered ${status}`);
  }
}

export async function devServer(options: DevServerOptions, deps: DevDeps = realDevDeps): Promise<void> {
  const { loaded, fallbackLabel } = await loadDevInputs(options);
  const port = await choosePort(options.port, deps);
  const remoteCache: RemoteCache = new Map();
  const catalog = await resolveCatalog(
    loaded.sources,
    loaded.configDir,
    fallbackLabel,
    await reservedNamesFor(loaded),
    remoteCache,
  );

  const scratch = await createScratchRoot();
  let stopping = false;
  let current: AstroRun | undefined;
  // Registered before the runner's own forwarders, so `stopping` is already
  // set when the child's exit is observed. The runner forwards the signal; this
  // starts the grace clock for a child that ignores it.
  const removers = SIGNALS.map((signal) =>
    deps.onSignal(signal, () => {
      stopping = true;
      // A rejected exit (spawn failure) is already delivered by `track`.
      if (current !== undefined) void awaitExit(current).catch(() => undefined);
    }),
  );
  let reload: DevReload | undefined;
  try {
    const { sitePath } = await writeRenderTree({
      loaded,
      catalog,
      scratch: scratch.path,
      outDir: join(scratch.path, "dist"),
      port,
    });
    const configFile = await writeAstroConfig(
      scratch.path,
      new URL("../site/astro_config.js", import.meta.url).href,
      sitePath,
    );
    if (stopping) return;

    const origin = `http://127.0.0.1:${port}`;
    // Settles once, when the session ends: clean (a stop) or with the failure.
    // Assigned synchronously by the executor below, before anything can call it.
    let endSession!: (error?: Error) => void;
    const session = new Promise<void>((done, fail) => {
      endSession = (error) => (error === undefined ? done() : fail(error));
    });
    session.catch(() => undefined); // a failure while nothing awaits yet is still delivered by `await session`

    /** A live child that exits for any reason but a stop (or a respawn) ends the session as a failure. */
    const track = (run: AstroRun): void => {
      void run.exit.then(
        (code) => {
          if (run !== current) return;
          endSession(stopping ? undefined : new RenderError(`astro dev exited unexpectedly (code ${code})`));
        },
        (err: Error) => endSession(err),
      );
    };

    /** Spawns the child for `base` and waits until it answers. "stopped": a signal ended it first. */
    const boot = async (base: string): Promise<"ready" | "stopped"> => {
      const run = runAstro(
        "dev",
        {
          root: scratch.path,
          configFile,
          // Astro writes `<cwd>/.astro` for some intermediates: keep that in the scratch root.
          cwd: scratch.path,
          port,
          onLine: deps.warn,
        },
        { spawn: deps.spawn, env: deps.env },
      );
      current = run;
      const readiness = await waitReady(`${origin}${base}`, run, deps);
      if (stopping) {
        await awaitExit(run);
        return "stopped";
      }
      if (readiness !== "ready") {
        if (readiness === "timeout") await terminate(run);
        throw new RenderError(
          readiness === "exited"
            ? "astro dev exited before the site was ready"
            : `astro dev did not answer on ${origin}${base} within ${READY_TIMEOUT_MS / 1000}s`,
        );
      }
      deps.log(`ocx-catalog dev: serving ${origin}${base} — Ctrl-C to stop`);
      track(run);
      return "ready";
    };

    /** A new `base` is baked into the child's config at startup: stop it and boot a fresh one on the same port. */
    const respawn = async (base: string): Promise<void> => {
      const old = current;
      current = undefined;
      if (old !== undefined) await terminate(old);
      if (stopping) return endSession();
      await boot(base).then((outcome) => (outcome === "stopped" ? endSession() : undefined), endSession);
    };

    if ((await boot(loaded.config.base)) === "stopped") return;

    if (options.smoke) {
      try {
        await smokeCheck(origin, loaded.config.base, deps);
      } finally {
        stopping = true;
        if (current !== undefined) await terminate(current);
      }
      return;
    }
    reload = startDevReload({
      scratch: scratch.path,
      port,
      initial: loaded,
      remoteCache,
      configFile: options.configPath === undefined ? undefined : resolve(options.configPath),
      loadInputs: () => loadDevInputs(options),
      onBaseChange: respawn,
      log: deps.log,
      warn: deps.warn,
      watch: deps.watch,
      timers: deps.timers,
    });
    await session;
  } finally {
    for (const remove of removers) remove();
    await reload?.close();
    await scratch.dispose();
  }
}
