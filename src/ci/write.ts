import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeForDrift } from "./normalize.js";
import type { RenderedFile } from "./render.js";

/** One rendered file's drift status against what's committed. */
export interface DriftEntry {
  path: string;
  drift: boolean;
}

/**
 * Compares each of `files` against what's on disk at `repoRoot`, through
 * `normalizeForDrift` — never raw bytes, so a Renovate-bumped `uses:`/
 * `image:` pin is never read as drift. A missing file counts as drift.
 */
export async function checkCi(repoRoot: string, files: readonly RenderedFile[]): Promise<DriftEntry[]> {
  const results: DriftEntry[] = [];
  for (const file of files) {
    const actual = await readFile(path.join(repoRoot, file.path), "utf8").catch(() => null);
    const same = actual !== null && normalizeForDrift(actual) === normalizeForDrift(file.content);
    results.push({ path: file.path, drift: !same });
  }
  return results;
}

/** Writes `files` to `repoRoot`, creating parent directories as needed. */
export async function writeCi(repoRoot: string, files: readonly RenderedFile[]): Promise<void> {
  for (const file of files) {
    const abs = path.join(repoRoot, file.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf8");
  }
}
