import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, CommanderError } from "commander";
import { CiError, runCi } from "../ci/index.js";
import { ConfigError } from "../config/errors.js";
import { loadConfig } from "../config/load.js";
import { runBuild } from "./build.js";
import { runDev } from "./dev.js";
import { DATA, OK, USAGE } from "./exit.js";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

function buildProgram(): Command {
  const program = new Command();
  program.name("ocx-catalog").version(pkg.version).exitOverride();

  program
    .command("build")
    .description("render the catalog site to static output")
    .option("--config <path>", "path to catalog config")
    .option("--out <dir>", "output directory")
    .action(runBuild);

  program
    .command("dev")
    .description("run the catalog dev server")
    .option("--source <path>", "source data directory")
    .option("--config <path>", "path to catalog config")
    .option("--port <n>", "dev server port")
    .option("--smoke", "start, verify readiness, then exit")
    .action(runDev);

  program
    .command("ci")
    .description("render or check the catalog CI pipeline (C-007)")
    .option("--check", "check-only, no writes")
    .action(async (opts: { check?: boolean }) => {
      const repoRoot = process.cwd();
      try {
        const { config } = await loadConfig(join(repoRoot, "catalog.config.json"));
        await runCi(config.ci, repoRoot, opts.check ?? false);
        process.exitCode = OK;
      } catch (err) {
        if (err instanceof ConfigError || err instanceof CiError) {
          process.stderr.write(`ocx-catalog ci: ${err.message}\n`);
          process.exitCode = DATA;
          return;
        }
        throw err;
      }
    });

  return program;
}

/**
 * Parses `argv` and runs the selected subcommand. Never calls `process.exit`;
 * sets `process.exitCode` and returns so callers control process teardown.
 */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
  } catch (err) {
    if (!(err instanceof CommanderError)) {
      throw err;
    }
    // commander already wrote its own error/help/version output; we only
    // remap its exit code onto this CLI's sysexits-derived convention.
    process.exitCode = err.exitCode === 0 ? OK : USAGE;
  }
}
