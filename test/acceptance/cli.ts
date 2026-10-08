/**
 * The vitest-free half of the acceptance harness: what `global-setup.ts` (which
 * cannot import `vitest`) and the suites share. Documented in `helpers.ts`,
 * which re-exports everything here.
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SiteName = "root" | "rootbase" | "catalog";
export const SITE_NAMES: readonly SiteName[] = ["root", "rootbase", "catalog"];

export interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The CLI process id — scratch roots are named `ocx-catalog-<pid>-*`. */
  readonly pid: number;
}

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const FIXTURE_DIR = join(REPO_ROOT, "test/fixtures/site");
export const CLI_ENTRY = join(REPO_ROOT, "dist/cli/index.js");

/** Absolute path of a committed fixture config. */
export const fixtureConfig = (name: SiteName): string => join(FIXTURE_DIR, `${name}.config.json`);

/** The directory owning the REAL `node_modules` tree (see the header). */
export const cliCwd = (): string => dirname(realpathSync(join(REPO_ROOT, "node_modules")));

/** Where the CLI puts scratch roots (`<cwd>/node_modules/.cache/ocx-catalog`). */
export const scratchBase = (): string => join(cliCwd(), "node_modules", ".cache", "ocx-catalog");

export interface RunCliOptions {
  /** Merged over `process.env`; `undefined` deletes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

/** Runs `node dist/cli/index.js <args>` to completion and collects its output. */
export function runCli(args: readonly string[], options: RunCliOptions = {}): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], { cwd: options.cwd ?? cliCwd(), env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr, pid: child.pid! }));
  });
}

/** `ocx-catalog build --config <config> --out <out>`. */
export const runBuild = (config: string, out: string, options: RunCliOptions = {}): Promise<CliResult> =>
  runCli(["build", "--config", config, "--out", out], options);
