/**
 * The only module that resolves and spawns the `astro` CLI (C-025). No other
 * `src/**` file resolves the bin or value-imports `build|dev|preview|sync`
 * from `"astro"` — `test/build/astro_isolation.test.ts` enforces both.
 *
 * The injected `spawn` is what makes the
 * module unit-testable against a fake child; the real spawn is exercised by
 * the acceptance build.
 */
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { RenderError } from "./errors.js";

/** Prefix of every relayed child line (C-046). */
const PREFIX = "ocx-catalog: ";
const RELAYED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type AstroMode = "build" | "dev";

/** The slice of `node:child_process.spawn` the runner needs. */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface AstroRunOptions {
  /** The scratch root, passed to the child as `--root`. */
  readonly root: string;
  /** `<root>/astro.config.mjs`; passed as `--config` relative to `root`, because Astro joins `--config` onto `--root`. */
  readonly configFile: string;
  /**
   * The child's working directory. Astro writes its prerender intermediates to
   * `<outDir>/.prerender` only when `outDir` starts with `process.cwd()`;
   * otherwise it uses `<cwd>/.astro` (a write into the consumer tree, and an
   * EXDEV rename across devices). The build passes the staging dir's parent.
   */
  readonly cwd?: string;
  /** Dev only: passed as `--port` (the config's `strictPort` makes it binding). */
  readonly port?: number;
  /** Receives each output line, already prefixed for the CLI relay. */
  readonly onLine: (line: string, stream: "stdout" | "stderr") => void;
}

export interface AstroRunnerDeps {
  readonly spawn: SpawnFn;
  /** Child env base; the runner adds `ASTRO_TELEMETRY_DISABLED=1` and `ASTRO_DISABLE_UPDATE_CHECK=true`. */
  readonly env: NodeJS.ProcessEnv;
}

/** A spawned Astro child. */
export interface AstroRun {
  /**
   * `build`: resolves once the child exited 0, rejects with `RenderError` on a
   * non-zero exit, a signal death or a spawn failure (ENOENT).
   * `dev`: resolves with the child's exit code (`1` when it died on a signal)
   * whatever it is — stopping the server is the normal way to end it — and
   * rejects only on a spawn failure.
   */
  readonly exit: Promise<number>;
  /** Forwards a signal to the child. */
  stop(signal: NodeJS.Signals): void;
}

/** Absolute path of the `astro` bin script (`astro/package.json` + `bin.astro`). */
export const resolveAstroBin = (): string => {
  const pkgPath = createRequire(import.meta.url).resolve("astro/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: { astro: string } };
  return resolve(dirname(pkgPath), pkg.bin.astro);
};

/** Splits a text stream into lines, handing each (prefixed) to `emit`; flushes the tail on `end`. */
const relayLines = (
  stream: NodeJS.ReadableStream | null,
  emit: (line: string) => void,
): void => {
  if (!stream) return;
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk: string) => {
    pending += chunk;
    for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
      emit(PREFIX + pending.slice(0, nl).replace(/\r$/, ""));
      pending = pending.slice(nl + 1);
    }
  });
  stream.on("end", () => {
    if (pending !== "") emit(PREFIX + pending);
  });
};

/** Spawns `process.execPath <bin> build|dev --root … --config …` and relays its output. */
export const runAstro = (mode: AstroMode, options: AstroRunOptions, deps: AstroRunnerDeps): AstroRun => {
  const args = [resolveAstroBin(), mode, "--root", options.root, "--config", relative(options.root, options.configFile)];
  // `--ignore-lock`: without it Astro 7 detaches the dev server into the
  // background (and reports "running at …" on a JSON log line) whenever it
  // detects an AI-agent environment, which the supervisor would read as the
  // child exiting. It also skips the project lock file: each run owns a unique
  // scratch root, so there is no other server to coordinate with.
  if (mode === "dev") args.push("--ignore-lock");
  if (mode === "dev" && options.port !== undefined) args.push("--port", String(options.port));
  const env: NodeJS.ProcessEnv = { ...deps.env, ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true" };
  // Vite lets a `BASE_URL` variable in the process environment shadow the
  // configured `base` (verified: `BASE_URL=/ ocx-catalog build` on a
  // `/catalog/` site renders `/favicon.svg` where `/catalog/favicon.svg`
  // belongs). Vitest and many CI images export it; the generated config is the
  // only source of `base` here.
  delete env.BASE_URL;
  const child = deps.spawn(process.execPath, args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  relayLines(child.stdout, (line) => options.onLine(line, "stdout"));
  relayLines(child.stderr, (line) => options.onLine(line, "stderr"));

  const stop = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  const forwarders = RELAYED_SIGNALS.map((signal) => [signal, () => stop(signal)] as const);
  for (const [signal, forward] of forwarders) process.on(signal, forward);

  const exit = new Promise<number>((settle, fail) => {
    // 'close' (not 'exit') fires after stdio drained, so no output line is lost.
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      const exitCode = code ?? 1;
      if (mode === "dev" || exitCode === 0) return settle(exitCode);
      fail(new RenderError(`astro ${mode} ${signal ? `was killed by ${signal}` : `exited with code ${exitCode}`}`));
    });
    child.once("error", (err: NodeJS.ErrnoException) => {
      fail(new RenderError(`cannot start astro (${process.execPath} ${args[0]}): ${err.code ?? err.message}`));
    });
  }).finally(() => {
    for (const [signal, forward] of forwarders) process.off(signal, forward);
  });
  return { exit, stop };
};
