import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseHeaderVersion } from "./header.js";
import type { Forge } from "./types.js";

/** A committed file whose first line matches the generated-file header
 * (C-007) — any version. `path` is repo-root-relative, forward-slash. */
export interface DiscoveredFile {
  path: string;
  content: string;
  headerVersion: number;
}

/**
 * Where each forge's generated files live. GitHub's convention directory
 * holds the rendered workflow directly; GitLab's holds the rendered
 * *included* job files (C-007: "hand-written root `.gitlab-ci.yml` includes
 * — render the included job files, not the root" — `.gitlab-ci/` is never
 * the root file itself).
 */
const FORGE_DIR: Record<Forge, string> = {
  github: ".github/workflows",
  gitlab: ".gitlab-ci",
};

const YAML_NAME = /\.ya?ml$/;

/**
 * Scans `<repoRoot>/<forge's directory>` for every file whose first line
 * matches the header contract, regardless of the version it names — this is
 * the "discovery" half of C-007: pin scraping and the tool-too-old check
 * both operate over this full set, not just the specific path this module
 * is about to (re-)write. A file with no header, or a malformed one, is
 * silently absent from the result — never touched, per contract. A missing
 * directory is not an error: nothing of ours can exist in it yet.
 */
export async function discoverGeneratedFiles(repoRoot: string, forge: Forge): Promise<DiscoveredFile[]> {
  const dir = FORGE_DIR[forge];
  const absDir = path.join(repoRoot, dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files: DiscoveredFile[] = [];
  for (const entry of entries.filter((name) => YAML_NAME.test(name)).sort()) {
    const relPath = `${dir}/${entry}`;
    const content = await readFile(path.join(repoRoot, relPath), "utf8");
    // `String.prototype.split` always returns at least one element, so `[0]`
    // is never `undefined` here — no `?? ""` fallback needed.
    const firstLine = content.split("\n", 1)[0];
    const headerVersion = parseHeaderVersion(firstLine);
    if (headerVersion === null) continue;
    files.push({ path: relPath, content, headerVersion });
  }
  return files;
}
