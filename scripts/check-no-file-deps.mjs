#!/usr/bin/env node
/**
 * C-026 guard: no `file:` (or `link:`) dependency may reach `main`.
 *
 * The root and `docs/` manifests depend on `@ocx-sh/theme` through a local
 * `file:` path while the theme is unpublished (plan step I.1 swaps it for
 * `^0.2.0`). A `file:` specifier in a manifest cannot resolve for a consumer
 * of the published tarball, and a `file:` entry in a lockfile makes `npm ci`
 * depend on a path that exists on one machine. So this scans both manifests
 * AND both lockfiles — a lockfile can carry a local link the manifest no
 * longer names — and fails on any string value starting `file:`/`link:` and any
 * lockfile entry marked `"link": true`.
 *
 * `npm audit signatures` (the `audit-signatures` CI job) cannot help here: it
 * only verifies registry-resolved packages and silently skips `file:` ones, so
 * a local dependency passes it unchecked. This guard is the check for them.
 *
 * Usage: `node scripts/check-no-file-deps.mjs [repo-root]` — exits 1 and lists
 * every offender (file, JSON path, value); exits 0 when clean. A missing file
 * is skipped (a project without a `docs/` lockfile has nothing to scan).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCANNED = ["package.json", "package-lock.json", "docs/package.json", "docs/package-lock.json"];
const LOCAL_SPECIFIER = /^(file|link):/;

function walk(value, path, found) {
  if (typeof value === "string") {
    if (LOCAL_SPECIFIER.test(value)) found.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${String(i)}]`, found));
  } else if (value !== null && typeof value === "object") {
    if (value.link === true) found.push({ path: `${path}.link`, value: "true" });
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, found);
  }
}

/** Every local-path dependency in the four scanned files under `root`, as
 * `{ file, path, value }`. */
export function findFileDeps(root) {
  const offenders = [];
  for (const file of SCANNED) {
    const full = join(root, file);
    if (!existsSync(full)) continue;
    const found = [];
    walk(JSON.parse(readFileSync(full, "utf8")), "$", found);
    for (const entry of found) offenders.push({ file, ...entry });
  }
  return offenders;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
  const offenders = findFileDeps(root);
  for (const { file, path, value } of offenders) {
    process.stderr.write(`check-no-file-deps: ${file} ${path} = ${value}\n`);
  }
  if (offenders.length > 0) {
    process.stderr.write(
      `check-no-file-deps: FAILED — ${String(offenders.length)} local dependency reference(s); ` +
        `swap them for a published semver range before merging to main (C-026)\n`,
    );
    process.exitCode = 1;
  } else {
    process.stderr.write("check-no-file-deps: OK\n");
  }
}
