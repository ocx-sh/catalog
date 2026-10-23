#!/usr/bin/env node
/**
 * Parity gate for the 0.6 theme port: every defect row in
 * `.claude/artifacts/defects_ocx_theme_port.md` that is not a recorded removal
 * (plus the removals the owner chose to restore) must be named, by its D-id,
 * in the title of a test — an `it(`/`test(` under `test/`, or a `check(` in
 * `scripts/quality-*.mjs`. Exits 1 listing every uncovered row.
 *
 * A row that is neither `fixed` nor `removed-by-decision` fails the gate too,
 * unless it is a `residual` whose Detail cell carries a `Residual:` reason
 * (a residual is exempt from the test requirement: it is deliberately left).
 *
 * Temporary: it exists for the port and goes once the ledger is closed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const LEDGER = join(ROOT, ".claude/artifacts/defects_ocx_theme_port.md");
// Removed-by-decision rows the owner chose to bring back (user-facing).
const RESTORED = new Set(["D-170", "D-171", "D-173", "D-174", "D-175", "D-178", "D-179"]);
const TITLE = /\b(?:it|test|check)\s*\(.*?\bD-\d{3}\b.*$/gm;

const required = [];
const unresolved = [];
for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
  const cells = line.split(" | ");
  const id = /^\| (D-\d{3})$/.exec(cells[0])?.[1];
  if (!id) continue;
  const status = cells[2];
  if (status === "residual") {
    if (!/Residual: \S/.test(cells.slice(6).join(" | "))) unresolved.push(id);
    continue;
  }
  if (status !== "fixed" && !status.startsWith("removed-by-decision")) unresolved.push(id);
  if (status.startsWith("removed-by-decision") && !RESTORED.has(id)) continue;
  required.push(id);
}

function files(dir, keep) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && keep(e.name))
    .map((e) => join(e.parentPath, e.name));
}
const sources = [
  ...files(join(ROOT, "test"), (n) => /\.test\.ts$/.test(n)),
  ...files(join(ROOT, "scripts"), (n) => /^quality-.*\.mjs$/.test(n)),
];
const covered = new Set();
for (const file of sources) {
  for (const [title] of readFileSync(file, "utf8").matchAll(TITLE)) {
    for (const [id] of title.matchAll(/\bD-\d{3}\b/g)) covered.add(id);
  }
}

if (unresolved.length) {
  console.log(`not fixed and no recorded residual: ${unresolved.join(" ")}`);
  process.exit(1);
}

const missing = required.filter((id) => !covered.has(id));
console.log(`parity: ${required.length - missing.length}/${required.length} rows covered by a test`);
if (missing.length) {
  console.log(`uncovered: ${missing.join(" ")}`);
  process.exit(1);
}
