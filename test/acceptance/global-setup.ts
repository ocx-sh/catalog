import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { ensureDist } from "../global-setup.js";
import { fixtureConfig, runBuild, SITE_NAMES, type CliResult, type SiteName } from "./cli.js";

/**
 * The ACCEPTANCE setup (vitest `acceptance` project's `globalSetup`; contract
 * in `helpers.ts`): builds `dist/` once, then runs the real CLI once per
 * selected fixture config into a temp dir and `provide`s the paths and the
 * CLI output. A failed fixture build does not abort the run: its log is
 * provided with the non-zero code, and the suites that need the site fail on
 * `site()`'s own message plus the captured stderr.
 */
function selectedSites(): SiteName[] {
  const raw = process.env.ACCEPT_CONFIG;
  if (raw === undefined || raw.trim() === "") return [...SITE_NAMES];
  const names = raw.split(",").map((name) => name.trim());
  const unknown = names.filter((name) => !(SITE_NAMES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(`ACCEPT_CONFIG: unknown site(s) ${unknown.join(", ")}; expected a subset of ${SITE_NAMES.join(", ")}`);
  }
  return names as SiteName[];
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  ensureDist();
  const root = await mkdtemp(join(tmpdir(), "ocx-catalog-accept-"));
  const sites: Partial<Record<SiteName, string>> = {};
  const logs: Partial<Record<SiteName, CliResult>> = {};
  for (const name of selectedSites()) {
    const out = join(root, name);
    const started = Date.now();
    const log = await runBuild(fixtureConfig(name), out);
    process.stderr.write(`[acceptance] ${name}: exit ${log.code} in ${Date.now() - started} ms\n`);
    if (log.code !== 0) process.stderr.write(`${log.stdout}${log.stderr}\n`);
    else sites[name] = out;
    logs[name] = log;
  }
  project.provide("acceptanceSites", sites);
  project.provide("acceptanceLogs", logs);
  return () => rm(root, { recursive: true, force: true });
}
