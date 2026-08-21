import { resolve } from "node:path";
import { buildCatalog } from "../build/engine.js";
import { BuildError } from "../build/errors.js";
import { ConfigError } from "../config/errors.js";
import { DATA, UNAVAILABLE } from "./exit.js";

/** Raw commander option values for `ocx-catalog build`. */
export interface BuildCommandOptions {
  readonly config?: string;
  readonly out?: string;
}

/** No `--config` given -> look for `catalog.config.json` in `process.cwd()`
 * (matches the "obvious file, no config" convention of `tsconfig.json`/
 * `.eslintrc`; nothing in C-001 documents a default explicitly, so this is
 * a plain, reversible naming choice, not an open question). No `--out`
 * given -> `dist` in `process.cwd()`. */
const DEFAULT_CONFIG_FILE = "catalog.config.json";
const DEFAULT_OUT_DIR = "dist";

/**
 * Runs `ocx-catalog build`: calls `buildCatalog` and maps its failure modes
 * onto this CLI's sysexits-derived exit codes (C-001) — `ConfigError` (any
 * C-002 config-shape problem) and `BuildError` (`DATA`/`UNAVAILABLE`, see
 * `build/errors.ts`) both print `err.message` to stderr and set
 * `process.exitCode`; any other thrown error is NOT caught here and
 * propagates to `main.ts`'s caller, which maps it to `FAIL` (1) — matching
 * `main.ts`'s existing convention of only ever mapping KNOWN failure
 * classes locally. Never calls `process.exit()`.
 */
export async function runBuild(options: BuildCommandOptions): Promise<void> {
  const configPath = resolve(options.config ?? DEFAULT_CONFIG_FILE);
  const outDir = resolve(options.out ?? DEFAULT_OUT_DIR);
  try {
    await buildCatalog({ configPath, outDir });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`ocx-catalog build: ${err.message}\n`);
      process.exitCode = DATA;
      return;
    }
    if (err instanceof BuildError) {
      process.stderr.write(`ocx-catalog build: ${err.message}\n`);
      process.exitCode = err.code === "UNAVAILABLE" ? UNAVAILABLE : DATA;
      return;
    }
    throw err;
  }
}
