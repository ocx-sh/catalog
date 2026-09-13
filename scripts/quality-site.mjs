#!/usr/bin/env node
/**
 * Build a corporate-sized catalog site, for the measurements that only mean
 * anything at that size.
 *
 * `task quality:web`'s Lighthouse run audits the committed six-package
 * fixture, which is the right size for "does every page score well" and says
 * nothing about the two costs that grow with the catalog: the payload the
 * landing page hands the browser, and the work of building a card or a row
 * for every package in it.
 *
 * The clone logic is `lib/inflate.mjs`, shared with `scripts/dev-indexes.mjs`,
 * so the site a regression is measured against is the site it was eyeballed
 * in. Nothing is written back to `test/fixtures/quality-index/` — the clones
 * are made in a scratch copy that this script removes on the way out.
 *
 * Usage: node scripts/quality-site.mjs [--bulk N] [--out DIR]
 */
import { rm, cp, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { inflate } from "./lib/inflate.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/quality-index");

const { values } = parseArgs({
  options: {
    bulk: { type: "string", default: "250" },
    out: { type: "string", default: ".lhci-bulk" },
  },
});

const bulk = Number(values.bulk);
if (!Number.isInteger(bulk) || bulk < 1) {
  // 64 is the usage exit code the CLI itself uses for a bad flag (BSD sysexits).
  console.error(`--bulk ${JSON.stringify(values.bulk)}: must be a package count (1 or more)`);
  process.exit(64);
}

const outDir = resolve(ROOT, values.out);
// Repo-local and gitignored rather than the OS temp dir: the fixture's
// `catalog.config.json` resolves its source `path` and its brand logo
// relative to its own directory, so the config has to travel with the copy.
const scratch = join(ROOT, ".lhci-bulk-src");

try {
  await rm(scratch, { recursive: true, force: true });
  await cp(FIXTURE, scratch, { recursive: true });

  const made = await inflate(scratch, bulk);
  const total = (await readdir(join(scratch, "p"), { recursive: true })).filter(
    (name) => name.endsWith(".json") && !name.includes("o/sha256"),
  ).length;
  console.log(`bulk: cloned ${made} package(s) into the scratch copy — ${total} total`);

  execFileSync(
    process.execPath,
    [join(ROOT, "dist/cli/index.js"), "build", "--config", join(scratch, "catalog.config.json"), "--out", outDir],
    { stdio: "inherit" },
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
