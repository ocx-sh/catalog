import { resolve } from "node:path";
import { devServer } from "../build/dev.js";
import { BuildError } from "../build/errors.js";
import { ConfigError } from "../config/errors.js";
import { DATA, UNAVAILABLE, USAGE } from "./exit.js";

/** Raw commander option values for `ocx-catalog dev`. `port` arrives as a
 * string (commander doesn't coerce `<n>` options); `smoke` is a boolean
 * flag, `undefined` when absent. */
export interface DevCommandOptions {
  readonly source?: string;
  readonly config?: string;
  readonly port?: string;
  readonly smoke?: boolean;
}

/** No `--config`/`--source` given -> look for `catalog.config.json` in
 * `process.cwd()` — same convention as `cli/build.ts`'s
 * `DEFAULT_CONFIG_FILE` (kept as its own local constant here rather than a
 * shared import: one literal string, two small self-contained command
 * modules — not worth a cross-file dependency for). */
const DEFAULT_CONFIG_FILE = "catalog.config.json";

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RangeError(`invalid --port value "${raw}"`);
  }
  return port;
}

/**
 * Runs `ocx-catalog dev`: resolves `--port` and `--source`/`--config`, then
 * either exits immediately once `devServer`'s promise resolves (`--smoke`)
 * or waits for `SIGINT` (Ctrl-C) to call `handle.close()` before returning,
 * satisfying S-003's "Ctrl-C cleans scratch dir". Error mapping mirrors
 * `cli/build.ts`'s `runBuild`.
 *
 * `--source`/`--config` resolution (C-001), same convention as `build`
 * (`cli/build.ts`'s `DEFAULT_CONFIG_FILE`):
 * - Both given -> USAGE (64) — mutually exclusive, S-003's own example runs
 *   `dev` with `--source` ALONE, no config file.
 * - `--source` only -> sugar for an implicit single-entry, `root:true`
 *   config (`build/dev.ts`'s own doc) — `sourcePath` set, `configPath`
 *   left unset.
 * - `--config` only, or NEITHER given -> `configPath` resolves to
 *   `--config`'s value, or (bare `dev`) `./catalog.config.json` — the same
 *   default `build` uses for a bare `ocx-catalog build`.
 */
export async function runDev(options: DevCommandOptions): Promise<void> {
  const hasSource = options.source !== undefined;
  const hasConfig = options.config !== undefined;

  if (hasSource && hasConfig) {
    process.stderr.write("ocx-catalog dev: --source and --config are mutually exclusive\n");
    process.exitCode = USAGE;
    return;
  }

  let port: number | undefined;
  try {
    port = parsePort(options.port);
  } catch (err) {
    process.stderr.write(`ocx-catalog dev: ${(err as Error).message}\n`);
    process.exitCode = USAGE;
    return;
  }

  try {
    const handle = await devServer({
      configPath: hasSource ? undefined : resolve(options.config ?? DEFAULT_CONFIG_FILE),
      sourcePath: hasSource ? resolve(options.source as string) : undefined,
      port,
      smoke: options.smoke ?? false,
    });

    if (options.smoke) {
      await handle.close();
      return;
    }

    await new Promise<void>((resolveDev) => {
      process.once("SIGINT", () => {
        handle.close().finally(resolveDev);
      });
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`ocx-catalog dev: ${err.message}\n`);
      process.exitCode = DATA;
      return;
    }
    if (err instanceof BuildError) {
      process.stderr.write(`ocx-catalog dev: ${err.message}\n`);
      process.exitCode = err.code === "UNAVAILABLE" ? UNAVAILABLE : DATA;
      return;
    }
    throw err;
  }
}
