/**
 * The `ocx-catalog dev` session helpers `dev.test.ts` and `dev_parity.test.ts` share: spawn the
 * shipped CLI, poll its HTTP side, and read what it printed. Not a test file.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { CLI_ENTRY, cliCwd } from "./cli.js";

export const TIMEOUT_MS = 90_000;

export interface Reply {
  /** 0 when nothing answered (connection refused, reset mid-restart). */
  readonly status: number;
  readonly body: string;
}

export const get = async (url: string): Promise<Reply> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return { status: response.status, body: await response.text() };
  } catch {
    return { status: 0, body: "" };
  }
};

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** A running `ocx-catalog dev` and everything it has printed so far. */
export interface Session {
  readonly child: ChildProcess;
  readonly port: number;
  stdout(): string;
  stderr(): string;
  exited(): Promise<number | null>;
}

export function startDev(config: string, port: number): Session {
  // A VITEST* variable in the environment makes `astro dev` answer 404 for every route, so it is not
  // passed down: the test runner's own markers are not what a developer's shell carries.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")));
  const child = spawn(process.execPath, [CLI_ENTRY, "dev", "--config", config, "--port", String(port)], {
    cwd: cliCwd(),
    env,
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  return { child, port, stdout: () => stdout, stderr: () => stderr, exited: () => exited };
}

/** Polls `probe` until it returns something other than `undefined`; fails with the CLI's output on timeout. */
export async function until<T>(what: string, session: Session, probe: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline || session.child.exitCode !== null) {
      throw new Error(
        `timed out waiting for ${what} (exit ${session.child.exitCode})\n--- stdout\n${session.stdout()}\n--- stderr (tail)\n${session.stderr().slice(-2000)}`,
      );
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

export const count = (text: string, needle: string): number => text.split(needle).length - 1;
