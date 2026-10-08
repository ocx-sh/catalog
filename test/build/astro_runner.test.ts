import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { RenderError } from "../../src/build/errors.js";
import { resolveAstroBin, runAstro, type AstroMode, type AstroRunOptions } from "../../src/build/astro_runner.js";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true);
  /** Drains stdio, then closes like a real child: 'close' follows the streams' 'end'. */
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, signal));
  }
}

interface Harness {
  readonly child: FakeChild;
  readonly calls: { command: string; args: readonly string[]; options: SpawnOptions }[];
  readonly lines: [string, "stdout" | "stderr"][];
  readonly run: ReturnType<typeof runAstro>;
}

function start(mode: AstroMode, extra: Partial<AstroRunOptions> = {}, env: NodeJS.ProcessEnv = { PATH: "/bin", KEEP: "1" }): Harness {
  const child = new FakeChild();
  const calls: Harness["calls"] = [];
  const lines: Harness["lines"] = [];
  const run = runAstro(
    mode,
    { root: "/scratch", configFile: "/scratch/astro.config.mjs", onLine: (line, stream) => lines.push([line, stream]), ...extra },
    {
      env,
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return child as unknown as ChildProcess;
      },
    },
  );
  return { child, calls, lines, run };
}

describe("resolveAstroBin", () => {
  it("is the installed astro package's bin script, absolute and on disk", () => {
    const bin = resolveAstroBin();
    expect(bin).toMatch(/astro[\\/]bin[\\/]astro\.mjs$/);
    expect(existsSync(bin)).toBe(true);
  });
});

describe("runAstro spawn (C-046, C-025)", () => {
  it.each(["build", "dev"] as const)("spawns node <astro bin> %s --root <scratch> --config astro.config.mjs (relative: Astro joins it onto --root)", async (mode) => {
    const { child, calls, run } = start(mode);
    child.finish(0);
    await run.exit;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual([
      resolveAstroBin(),
      mode,
      "--root",
      "/scratch",
      "--config",
      "astro.config.mjs",
      // dev only: stay in the foreground and skip the lock file (Astro backgrounds itself under an agent).
      ...(mode === "dev" ? ["--ignore-lock"] : []),
    ]);
  });

  it("spawns in the requested working directory (Astro's prerender dir hangs off it)", async () => {
    const { child, calls, run } = start("build", { cwd: "/out-parent" });
    child.finish(0);
    await run.exit;
    expect(calls[0]?.options.cwd).toBe("/out-parent");
  });

  it("passes --port to dev only", async () => {
    const dev = start("dev", { port: 4400 });
    dev.child.finish(0);
    await dev.run.exit;
    expect(dev.calls[0]?.args.slice(-2)).toEqual(["--port", "4400"]);
    expect(dev.calls[0]?.args).toContain("--ignore-lock");

    const build = start("build", { port: 4400 });
    build.child.finish(0);
    await build.run.exit;
    expect(build.calls[0]?.args).not.toContain("--port");
  });

  it("gives the child exactly the base env plus the two Astro switches, with piped output", async () => {
    const { child, calls, run } = start("build");
    child.finish(0);
    await run.exit;
    expect(calls[0]?.options.env).toEqual({
      PATH: "/bin",
      KEEP: "1",
      ASTRO_TELEMETRY_DISABLED: "1",
      ASTRO_DISABLE_UPDATE_CHECK: "true",
    });
    expect(calls[0]?.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("overrides a base env that tries to re-enable telemetry", async () => {
    const { child, calls, run } = start("build", {}, { ASTRO_TELEMETRY_DISABLED: "0", ASTRO_DISABLE_UPDATE_CHECK: "false" });
    child.finish(0);
    await run.exit;
    expect(calls[0]?.options.env).toMatchObject({ ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true" });
  });

  it("drops a BASE_URL from the base env: Vite would let it shadow the configured base", async () => {
    const { child, calls, run } = start("build", {}, { PATH: "/bin", BASE_URL: "/" });
    child.finish(0);
    await run.exit;
    expect(calls[0]?.options.env).not.toHaveProperty("BASE_URL");
    expect(calls[0]?.options.env).toHaveProperty("PATH", "/bin");
  });
});

describe("runAstro relay (C-046)", () => {
  it("prefixes each line, per stream, splitting chunks that straddle newlines and CRLF", async () => {
    const { child, lines, run } = start("build");
    child.stdout.write("one\ntw");
    child.stdout.write("o\r\nthree");
    child.stderr.write("warn\n");
    child.finish(0);
    await run.exit;
    expect(lines.filter(([, stream]) => stream === "stdout").map(([line]) => line)).toEqual([
      "ocx-catalog: one",
      "ocx-catalog: two",
      "ocx-catalog: three",
    ]);
    expect(lines.filter(([, stream]) => stream === "stderr")).toEqual([["ocx-catalog: warn", "stderr"]]);
  });

  it("emits an empty line prefixed but no phantom line after a trailing newline", async () => {
    const { child, lines, run } = start("build");
    child.stdout.write("a\n\nb\n");
    child.finish(0);
    await run.exit;
    expect(lines.map(([line]) => line)).toEqual(["ocx-catalog: a", "ocx-catalog: ", "ocx-catalog: b"]);
  });

  it("delivers output written right before exit before settling", async () => {
    const { child, lines, run } = start("build");
    child.stderr.write("last words");
    child.finish(0);
    await run.exit;
    expect(lines).toEqual([["ocx-catalog: last words", "stderr"]]);
  });

  it("tolerates a child without piped streams", async () => {
    const child = new EventEmitter() as unknown as ChildProcess & { kill: () => boolean };
    const run = runAstro(
      "build",
      { root: "/s", configFile: "/s/astro.config.mjs", onLine: () => undefined },
      { env: {}, spawn: () => child },
    );
    child.emit("close", 0, null);
    await expect(run.exit).resolves.toBe(0);
  });
});

describe("runAstro exit mapping (C-046, S-012)", () => {
  it("build resolves 0 on a clean exit", async () => {
    const { child, run } = start("build");
    child.finish(0);
    await expect(run.exit).resolves.toBe(0);
  });

  it("build rejects with RenderError naming the exit code on non-zero", async () => {
    const { child, run } = start("build");
    child.finish(3);
    const err: unknown = await run.exit.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).message).toBe("astro build exited with code 3");
  });

  it("build rejects with RenderError naming the signal when the child was killed", async () => {
    const { child, run } = start("build");
    child.finish(null, "SIGKILL");
    const err: unknown = await run.exit.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).message).toBe("astro build was killed by SIGKILL");
  });

  it("dev resolves with whatever code the child exits with, 1 on a signal", async () => {
    const failed = start("dev");
    failed.child.finish(7);
    await expect(failed.run.exit).resolves.toBe(7);
    const killed = start("dev");
    killed.child.finish(null, "SIGTERM");
    await expect(killed.run.exit).resolves.toBe(1);
  });

  it("maps a spawn failure (ENOENT) to RenderError and removes its SIGINT/SIGTERM handlers", async () => {
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const { child, run } = start("build");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before.map((count) => count + 1));

    child.emit("error", Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }));
    child.finish(null); // Node may still emit 'close' after 'error'; the failure stays the outcome
    const err: unknown = await run.exit.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).message).toContain("cannot start astro");
    expect((err as RenderError).message).toContain("ENOENT");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });

  it("falls back to the error message when a spawn error has no code", async () => {
    const { child, run } = start("dev");
    child.emit("error", new Error("boom"));
    const err: unknown = await run.exit.catch((e: unknown) => e);
    expect((err as RenderError).message).toContain("boom");
  });
});

describe("runAstro signals (C-046)", () => {
  it("stop(signal) kills the child with that signal", async () => {
    const { child, run } = start("dev");
    run.stop("SIGTERM");
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    child.finish(null, "SIGTERM");
    await run.exit;
  });

  it.each(["SIGINT", "SIGTERM"] as const)("forwards the parent's %s to the child while running", async (signal) => {
    const { child, run } = start("build");
    process.emit(signal);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
    child.finish(0);
    await run.exit;
  });

  it.each(["SIGINT", "SIGTERM"] as const)("removes its %s handler once the child exited, on success and on failure", async (signal) => {
    const before = process.listenerCount(signal);
    const ok = start("build");
    expect(process.listenerCount(signal)).toBe(before + 1);
    ok.child.finish(0);
    await ok.run.exit;
    expect(process.listenerCount(signal)).toBe(before);

    const bad = start("build");
    bad.child.finish(2);
    await bad.run.exit.catch(() => undefined);
    expect(process.listenerCount(signal)).toBe(before);
  });
});
