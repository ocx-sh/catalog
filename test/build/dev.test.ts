import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devServer, loadDevInputs, realDevDeps, type DevDeps } from "../../src/build/dev.js";
import { BuildError, RenderError } from "../../src/build/errors.js";
import { ConfigError } from "../../src/config/errors.js";
import { rootJsonBytes } from "../sources/helpers.js";

/*
 * `devServer` (C-023, C-046, S-004) against a fake `astro dev` child: the
 * injected `spawn`/`fetch`/clock/port probe drive every path. The real child
 * (and real sockets) are the acceptance suite's (`test/acceptance/dev.test.ts`).
 */

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];
  /** Like a real child: stop signals end it. `exitOnKill: false` ignores everything but SIGKILL. */
  exitOnKill = true;
  readonly kill = (signal: NodeJS.Signals): boolean => {
    this.signals.push(signal);
    if (this.exitOnKill || signal === "SIGKILL") this.finish(null, signal);
    return true;
  };
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, signal));
  }
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A config over an empty `ocx.sh` path index; returns the config path. */
async function writeConfig(extra: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-dev-"));
  cleanup.push(dir);
  await mkdir(join(dir, "index", "p"), { recursive: true });
  await writeFile(join(dir, "index", "config.json"), JSON.stringify({ format_version: 1 }));
  const config = { sources: [{ path: "./index", root: true, label: "ocx.sh" }], brand: { title: "T" }, ...extra };
  await writeFile(join(dir, "catalog.config.json"), JSON.stringify(config));
  return join(dir, "catalog.config.json");
}

interface Harness {
  readonly deps: DevDeps;
  /** The first spawned child (before the spawn, the one about to be). */
  readonly child: FakeChild;
  /** Every child, in spawn order; a respawn takes the next. */
  readonly children: FakeChild[];
  /** Watchers the reload loop opened, by path. */
  readonly watches: { path: string; emit(relative: string): void; closed: boolean }[];
  /** Runs the pending debounce timer, if any. */
  fireTimer(): void;
  readonly spawned: { args: readonly string[]; options: SpawnOptions }[];
  readonly logs: string[];
  readonly warns: string[];
  readonly fetched: string[];
  /** Fire the handlers `onSignal` registered, as a SIGINT would. */
  signal(): void;
  readonly removed: () => number;
  /** Runs `action` the moment the child is spawned (after the runner attached its stdio listeners). */
  whenSpawned(action: () => void): void;
  /** The scratch root the child was pointed at (`--root`). */
  root(): string;
}

/**
 * `statuses` answers each fetch in turn (the last repeats); `"fail"` rejects
 * like ECONNREFUSED, `"hang"` never answers (the child's exit is then the only
 * event, with no polling loop racing it).
 */
function harness(statuses: readonly (number | "fail" | "hang")[], overrides: Partial<DevDeps> = {}): Harness {
  const children = [new FakeChild()];
  const watches: Harness["watches"] = [];
  let timerAction: (() => void) | undefined;
  const spawned: Harness["spawned"] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const fetched: string[] = [];
  const handlers: (() => void)[] = [];
  let removed = 0;
  let clock = 0;
  let onSpawn: (() => void) | undefined;
  let call = 0;
  const deps: DevDeps = {
    spawn: (_command, args, options) => {
      spawned.push({ args, options });
      if (onSpawn) setImmediate(onSpawn);
      if (children.length < spawned.length) children.push(new FakeChild());
      return children[spawned.length - 1] as unknown as ChildProcess;
    },
    env: { PATH: "/bin" },
    fetch: async (url) => {
      fetched.push(url);
      const next = statuses[Math.min(call++, statuses.length - 1)];
      if (next === "hang") return new Promise<never>(() => undefined);
      if (next === "fail" || next === undefined) throw new Error("ECONNREFUSED");
      return { status: next };
    },
    // Yields to the event loop so a pending child 'close' is observed; time only moves here.
    sleep: (ms) =>
      new Promise((done) => {
        clock += ms;
        setImmediate(done);
      }),
    now: () => clock,
    isPortFree: async () => true,
    onSignal: (_signal, handler) => {
      handlers.push(handler);
      return () => {
        removed++;
      };
    },
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    watch: (path, onChange) => {
      const watch = { path, emit: onChange, closed: false };
      watches.push(watch);
      return {
        close: () => {
          watch.closed = true;
        },
      };
    },
    timers: {
      set: (action) => {
        timerAction = action;
        return 1;
      },
      clear: () => {
        timerAction = undefined;
      },
    },
    ...overrides,
  };
  return {
    deps,
    child: children[0] as FakeChild,
    children,
    watches,
    fireTimer: () => timerAction?.(),
    spawned,
    logs,
    warns,
    fetched,
    signal: () => handlers.forEach((handler) => handler()),
    removed: () => removed,
    whenSpawned: (action) => {
      onSpawn = action;
    },
    root: () => {
      const args = spawned[0]?.args ?? [];
      return args[args.indexOf("--root") + 1] ?? "";
    },
  };
}

describe("devServer --smoke (C-023, S-004)", () => {
  it("boots under base, GETs the page and catalog.json, stops the child and leaves no scratch root", async () => {
    const configPath = await writeConfig({ base: "/catalog/" });
    const h = harness([200]);

    await devServer({ configPath, port: 4400, smoke: true }, h.deps);

    expect(h.fetched).toEqual([
      "http://127.0.0.1:4400/catalog/", // readiness
      "http://127.0.0.1:4400/catalog/", // smoke: the page
      "http://127.0.0.1:4400/catalog/data/catalog/catalog.json", // smoke: the catalog
    ]);
    expect(h.logs).toEqual(["ocx-catalog dev: serving http://127.0.0.1:4400/catalog/ — Ctrl-C to stop"]);
    expect(h.child.signals).toEqual(["SIGTERM"]);
    expect(existsSync(h.root())).toBe(false);
    expect(h.removed()).toBe(2); // SIGINT + SIGTERM handlers
  });

  it("spawns astro dev for the scratch root on the chosen port, cwd = the scratch root", async () => {
    const configPath = await writeConfig();
    const h = harness([200]);

    await devServer({ configPath, port: 4400, smoke: true }, h.deps);

    const { args, options } = h.spawned[0] ?? { args: [], options: {} };
    expect(args).toContain("dev");
    expect(args.slice(args.indexOf("--port"))).toEqual(["--port", "4400"]);
    expect(options.cwd).toBe(h.root());
    expect(h.root()).toMatch(/ocx-catalog-\d+-/);
  });

  it("fails with RenderError when a smoke GET does not answer 200, still stopping the child", async () => {
    const configPath = await writeConfig();
    const h = harness([200, 200, 500]);

    const error = await devServer({ configPath, port: 4400, smoke: true }, h.deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("smoke: GET /data/catalog/catalog.json answered 500");
    expect(h.child.signals).toEqual(["SIGTERM"]);
    expect(existsSync(h.root())).toBe(false);
  });

  it("fails with RenderError when a smoke GET cannot connect", async () => {
    const configPath = await writeConfig();
    const h = harness([200, "fail"]);

    const error = await devServer({ configPath, port: 4400, smoke: true }, h.deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("smoke: GET / failed: ECONNREFUSED");
    expect(h.child.signals).toEqual(["SIGTERM"]);
  });
});

describe("devServer port handling (S-004)", () => {
  it("an explicit port that is taken is UNAVAILABLE (exit 69) before anything is written or spawned", async () => {
    const configPath = await writeConfig();
    const h = harness([200], { isPortFree: async () => false });

    const error = await devServer({ configPath, port: 4400, smoke: true }, h.deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("UNAVAILABLE");
    expect((error as BuildError).message).toBe("port 4400 is already in use");
    expect(h.spawned).toEqual([]);
  });

  it("without --port, takes the first free port from 4321 upward", async () => {
    const configPath = await writeConfig();
    const probed: number[] = [];
    const h = harness([200], {
      isPortFree: async (port) => {
        probed.push(port);
        return port >= 4323;
      },
    });

    await devServer({ configPath, smoke: true }, h.deps);

    expect(probed).toEqual([4321, 4322, 4323]);
    expect(h.spawned[0]?.args.slice(-2)).toEqual(["--port", "4323"]);
    expect(h.logs[0]).toContain("http://127.0.0.1:4323/");
  });

  it("is UNAVAILABLE when no port in the scanned range is free", async () => {
    const configPath = await writeConfig();
    const h = harness([200], { isPortFree: async () => false });

    const error = await devServer({ configPath, smoke: true }, h.deps).catch((e: unknown) => e);

    expect((error as BuildError).code).toBe("UNAVAILABLE");
    expect((error as BuildError).message).toBe("no free port from 4321 to 4420");
  });
});

describe("devServer readiness (C-046)", () => {
  it("polls through connection errors and non-200 answers until the site answers 200", async () => {
    const configPath = await writeConfig();
    const h = harness(["fail", 503, 200]);

    await devServer({ configPath, port: 4400, smoke: true }, h.deps);

    // 3 readiness polls, then the 2 smoke GETs (both 200: the last status repeats).
    expect(h.fetched).toHaveLength(5);
    expect(h.logs).toHaveLength(1);
  });

  it("stops the child and fails with RenderError when nothing answers within 60 s", async () => {
    const configPath = await writeConfig();
    const h = harness(["fail"]);

    const error = await devServer({ configPath, port: 4400, smoke: true }, h.deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("astro dev did not answer on http://127.0.0.1:4400/ within 60s");
    expect(h.child.signals).toEqual(["SIGTERM"]);
    expect(h.logs).toEqual([]);
    expect(existsSync(h.root())).toBe(false);
  });

  it("a child that exits before the site is ready (a lost bind race) fails with RenderError, its stderr relayed", async () => {
    const configPath = await writeConfig();
    const h = harness(["hang"]);
    h.whenSpawned(() => {
      h.child.stderr.write("Error: Port 4400 is in use\n");
      h.child.finish(1);
    });
    const run = devServer({ configPath, port: 4400, smoke: true }, h.deps);

    const error = await run.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("astro dev exited before the site was ready");
    expect(h.warns).toContain("ocx-catalog: Error: Port 4400 is in use");
    expect(existsSync(h.root())).toBe(false);
  });

  it("relays both child streams to warn (stderr), prefixed, in arrival order", async () => {
    const configPath = await writeConfig();
    const h = harness([200]);
    h.child.stdout.write("ready in 100 ms\n");
    h.child.stderr.write("a warning\n");
    await devServer({ configPath, port: 4400, smoke: true }, h.deps);

    // C-046: both streams reach stderr; stdout is the banner's alone.
    expect(h.logs).toEqual(["ocx-catalog dev: serving http://127.0.0.1:4400/ — Ctrl-C to stop"]);
    expect(h.warns).toEqual(["ocx-catalog: ready in 100 ms", "ocx-catalog: a warning"]);
  });
});

describe("a child that ignores SIGTERM is SIGKILLed after a bounded grace", () => {
  /** Lets the event loop (not the faked timers) run until `condition` holds. */
  const until = async (condition: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("condition never held");
      await new Promise((done) => setImmediate(done));
    }
  };
  const fakeTimers = (): void => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it("readiness timeout: SIGTERM, 5 s of silence, SIGKILL, then the RenderError", async () => {
    fakeTimers();
    const configPath = await writeConfig();
    const h = harness(["fail"]);
    h.child.exitOnKill = false;
    const run = devServer({ configPath, port: 4400, smoke: true }, h.deps).catch((e: unknown) => e);

    await until(() => h.child.signals.length === 1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.child.signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1);
    const error = await run;

    expect(h.child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toContain("did not answer");
    expect(existsSync(h.root())).toBe(false);
  });

  it("smoke shutdown: the passing smoke still returns once the child is SIGKILLed", async () => {
    fakeTimers();
    const configPath = await writeConfig();
    const h = harness([200]);
    h.child.exitOnKill = false;
    const run = devServer({ configPath, port: 4400, smoke: true }, h.deps);

    await until(() => h.child.signals.length === 1);
    await vi.advanceTimersByTimeAsync(5_000);
    await run;

    expect(h.child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("a child that exits promptly leaves no grace timer behind", async () => {
    fakeTimers();
    const configPath = await writeConfig();
    const h = harness([200]);

    await devServer({ configPath, port: 4400, smoke: true }, h.deps);

    expect(h.child.signals).toEqual(["SIGTERM"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("steady-state Ctrl-C: a child that ignores the forwarded signal is SIGKILLed after 5 s", async () => {
    fakeTimers();
    const configPath = await writeConfig();
    const h = harness([200]);
    h.child.exitOnKill = false;
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    await until(() => h.logs.some((line) => line.includes("serving")));

    // `signal()` fires the SIGINT and the SIGTERM handler alike; one real signal fires one.
    h.signal(); // the runner's forwarder would deliver SIGINT; the fake child ignores it
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await run;

    expect(new Set(h.child.signals)).toEqual(new Set(["SIGKILL"]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("steady-state Ctrl-C: an exit that rejects while the grace runs is not an unhandled rejection", async () => {
    const configPath = await writeConfig();
    const h = harness([200]);
    h.child.exitOnKill = false;
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    h.signal();
    h.child.emit("error", Object.assign(new Error("boom"), { code: "EPERM" }));

    await expect(run).rejects.toBeInstanceOf(RenderError);
  });

  it("base-change respawn: the old child is SIGKILLed before the new one boots", async () => {
    fakeTimers();
    const configPath = await writeConfig();
    const h = harness([200]);
    h.child.exitOnKill = false;
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    run.catch(() => undefined);
    await until(() => h.logs.some((line) => line.includes("serving")));

    await writeFile(
      configPath,
      JSON.stringify({ sources: [{ path: "./index", root: true, label: "ocx.sh" }], brand: { title: "T" }, base: "/x/" }),
    );
    h.watches[0]?.emit("");
    h.fireTimer();
    await until(() => h.child.signals.length === 1);
    expect(h.spawned).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await until(() => h.logs.includes("ocx-catalog dev: serving http://127.0.0.1:4400/x/ — Ctrl-C to stop"));

    expect(h.child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(h.spawned).toHaveLength(2);
    h.signal();
    h.children[1]?.finish(null, "SIGINT");
    await run;
  });
});

describe("devServer lifetime (S-004)", () => {
  it("SIGINT after ready: the child's exit is a clean stop, the scratch root is gone, handlers removed", async () => {
    const configPath = await writeConfig();
    const h = harness([200]);
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    h.signal(); // the user's Ctrl-C; the runner forwards it, the child dies of it
    h.child.finish(null, "SIGINT");
    await run;

    expect(existsSync(h.root())).toBe(false);
    expect(h.removed()).toBe(2);
  });

  it("SIGINT before the site is ready ends cleanly too", async () => {
    const configPath = await writeConfig();
    const h = harness(["hang"]);
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    await vi.waitFor(() => expect(h.spawned).toHaveLength(1));

    h.signal();
    h.child.finish(null, "SIGINT");
    await run;

    expect(h.logs).toEqual([]);
    expect(existsSync(h.root())).toBe(false);
  });

  it("a signal during preparation spawns nothing and cleans up", async () => {
    const configPath = await writeConfig();
    const h = harness([200], {
      // The signal lands the moment the handlers are installed.
      onSignal: (_signal, handler) => {
        handler();
        return () => undefined;
      },
    });

    await devServer({ configPath, port: 4400, smoke: false }, h.deps);

    expect(h.spawned).toEqual([]);
  });

  it("a child that dies on its own after ready is RenderError (exit 1) and the scratch root is removed", async () => {
    const configPath = await writeConfig();
    const h = harness([200]);
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    h.child.finish(3);
    const error = await run.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("astro dev exited unexpectedly (code 3)");
    expect(existsSync(h.root())).toBe(false);
  });
});

describe("devServer live reload (C-024, S-004)", () => {
  const WIDGET = rootJsonBytes({ name: "ocx.sh/acme/widget", created: "2026-01-01" });
  const BASE_X_CONFIG = JSON.stringify({ sources: [{ path: "./index", root: true, label: "ocx.sh" }], brand: { title: "T" }, base: "/x/" });

  /** A running, non-smoke dev session over `writeConfig`'s index; resolves once the banner printed. */
  async function boot(h: Harness): Promise<{ configPath: string; run: Promise<void> }> {
    const configPath = await writeConfig();
    const run = devServer({ configPath, port: 4400, smoke: false }, h.deps);
    run.catch(() => undefined);
    await vi.waitFor(() => expect(h.logs.some((line) => line.includes("serving"))).toBe(true));
    return { configPath, run };
  }

  /** Edits the config to `base: "/x/"` and lets the debounce fire. */
  async function changeBase(h: Harness, configPath: string): Promise<void> {
    await writeFile(configPath, BASE_X_CONFIG);
    h.watches[0]?.emit("");
    h.fireTimer();
  }

  async function stop(h: Harness, run: Promise<void>): Promise<void> {
    h.signal();
    h.children.at(-1)?.finish(null, "SIGINT");
    await run;
  }

  it("watches the config file and the path source root", async () => {
    const h = harness([200]);
    const { configPath, run } = await boot(h);

    const index = join(configPath, "..", "index");
    expect(h.watches.map((watch) => watch.path)).toEqual([join(configPath, ".."), index, join(index, "c"), join(index, "p")]);
    await stop(h, run);
    expect(h.watches.every((watch) => watch.closed)).toBe(true);
  });

  it("--source watches the source directory alone (there is no config file)", async () => {
    const h = harness([200]);
    const sourcePath = join(await writeConfig(), "..", "index");
    const run = devServer({ sourcePath, port: 4400, smoke: false }, h.deps);
    run.catch(() => undefined);
    await vi.waitFor(() => expect(h.logs.some((line) => line.includes("serving"))).toBe(true));

    expect(h.watches.map((watch) => watch.path)).toEqual([sourcePath, join(sourcePath, "c"), join(sourcePath, "p")]);
    await stop(h, run);
  });

  it("a package added to a path source shows up in the served catalog.json without a restart", async () => {
    const h = harness([200]);
    const { configPath, run } = await boot(h);
    const catalogJson = join(h.root(), "public", "data", "catalog", "catalog.json");
    expect(await readFile(catalogJson, "utf8")).not.toContain("widget");

    await mkdir(join(configPath, "..", "index", "p", "acme"), { recursive: true });
    await writeFile(join(configPath, "..", "index", "p", "acme", "widget.json"), WIDGET);
    h.watches.find((watch) => watch.path === join(configPath, "..", "index", "p"))?.emit("acme/widget.json");
    h.fireTimer();
    await vi.waitFor(() => expect(h.logs).toContain("ocx-catalog dev: reloaded (1 packages)"));

    expect(await readFile(catalogJson, "utf8")).toContain("widget");
    expect(h.spawned).toHaveLength(1);
    await stop(h, run);
  });

  it("a changed base respawns the child on the same port with the new base", async () => {
    const h = harness([200]);
    const { configPath, run } = await boot(h);

    await changeBase(h, configPath);
    await vi.waitFor(() => expect(h.logs).toContain("ocx-catalog dev: serving http://127.0.0.1:4400/x/ — Ctrl-C to stop"));

    expect(h.children[0]?.signals).toEqual(["SIGTERM"]);
    expect(h.spawned).toHaveLength(2);
    expect(h.spawned[1]?.args.slice(-2)).toEqual(["--port", "4400"]);
    expect(h.logs).toContain("ocx-catalog dev: base is now /x/, restarting the server");
    await stop(h, run);
  });

  it("a signal while the old child is still exiting ends the session without spawning another", async () => {
    const h = harness([200]);
    const { configPath, run } = await boot(h);
    h.child.exitOnKill = false;

    await changeBase(h, configPath);
    await vi.waitFor(() => expect(h.child.signals).toEqual(["SIGTERM"]));
    h.signal();
    h.child.finish(null, "SIGTERM");
    await run;

    expect(h.spawned).toHaveLength(1);
  });

  it("a respawned child that dies before it is ready fails the session with RenderError", async () => {
    const h = harness([200, "hang"]);
    const { configPath, run } = await boot(h);
    h.whenSpawned(() => h.children[1]?.finish(1));

    await changeBase(h, configPath);

    const error = await run.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toBe("astro dev exited before the site was ready");
  });

  it("a signal while the respawned child boots ends the session cleanly", async () => {
    const h = harness([200, "hang"]);
    const { configPath, run } = await boot(h);

    await changeBase(h, configPath);
    await vi.waitFor(() => expect(h.spawned).toHaveLength(2));
    await stop(h, run);
  });

  it("a respawned child that never answers fails the session after stopping it", async () => {
    const h = harness([200, "fail"]);
    const { configPath, run } = await boot(h);

    await changeBase(h, configPath);

    const error = await run.catch((e: unknown) => e);
    expect((error as Error).message).toBe("astro dev did not answer on http://127.0.0.1:4400/x/ within 60s");
    expect(h.children[1]?.signals).toEqual(["SIGTERM"]);
  });
});

describe("devServer errors before the child exists", () => {
  it("a config error surfaces as ConfigError (default deps path)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-dev-"));
    cleanup.push(dir);
    await writeFile(join(dir, "catalog.config.json"), "{ not json");

    const error = await devServer({ configPath: join(dir, "catalog.config.json"), smoke: true }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ConfigError);
  });
});

describe("loadDevInputs", () => {
  it("reads --config through loadConfig", async () => {
    const configPath = await writeConfig({ base: "/x/" });

    const { loaded, fallbackLabel } = await loadDevInputs({ configPath });

    expect(loaded.config.base).toBe("/x/");
    expect(fallbackLabel).toBeUndefined();
  });

  it("--source is an implicit single root source against that directory, labelled 'local' only as a fallback", async () => {
    const { loaded, fallbackLabel } = await loadDevInputs({ sourcePath: "/some/index" });

    expect(loaded.configDir).toBe("/some/index");
    expect(loaded.sources).toEqual([{ entry: { path: ".", root: true }, label: null }]);
    expect(loaded.config.base).toBe("/");
    expect(fallbackLabel).toBe("local");
  });

  it("neither flag falls back to the current directory", async () => {
    const { loaded } = await loadDevInputs({});

    expect(loaded.configDir).toBe(process.cwd());
  });
});

describe("realDevDeps", () => {
  it("fetch resolves with the status, 404 included", async () => {
    const server = createHttpServer((req, res) => {
      res.statusCode = req.url === "/ok" ? 200 : 404;
      res.end("body");
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await realDevDeps.fetch(`http://127.0.0.1:${port}/ok`)).toEqual({ status: 200 });
      expect(await realDevDeps.fetch(`http://127.0.0.1:${port}/nope`)).toEqual({ status: 404 });
    } finally {
      server.closeAllConnections();
      await new Promise((closed) => server.close(closed));
    }
  });

  it("isPortFree is false for a bound port and true once it is released", async () => {
    const holder = createServer();
    await new Promise<void>((ready) => holder.listen(0, "127.0.0.1", ready));
    const { port } = holder.address() as AddressInfo;

    expect(await realDevDeps.isPortFree(port)).toBe(false);
    await new Promise((closed) => holder.close(closed));
    expect(await realDevDeps.isPortFree(port)).toBe(true);
  });

  it("sleep waits and now reads the clock", async () => {
    const before = realDevDeps.now();
    await realDevDeps.sleep(20);
    expect(realDevDeps.now() - before).toBeGreaterThanOrEqual(15);
  });

  it("onSignal registers a process handler and returns its remover", () => {
    const handler = vi.fn();
    const remove = realDevDeps.onSignal("SIGUSR2", handler);
    process.emit("SIGUSR2");
    remove();
    process.emit("SIGUSR2");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("log writes to stdout and warn to stderr, one line each", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      realDevDeps.log("a");
      realDevDeps.warn("b");
      expect(out).toHaveBeenCalledWith("a\n");
      expect(err).toHaveBeenCalledWith("b\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});
