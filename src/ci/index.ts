import type { CiConfig } from "../config/types.js";
import { CiError } from "./errors.js";
import { renderCi } from "./render.js";
import { checkCi, writeCi } from "./write.js";

export { CiError } from "./errors.js";
export type { CiErrorCode } from "./errors.js";

export interface RunCiResult {
  /** Repo-root-relative paths of every file rendered (written, or checked
   * clean). */
  files: string[];
}

/**
 * Entry point wired to `ocx-catalog ci [--check]` (C-001/C-007).
 *
 * `check: false` (default `ci` invocation) renders and writes the job set.
 * `check: true` renders and compares against what's committed instead,
 * writing nothing — throws `CiError("DRIFT")` naming every mismatched file
 * (S-004). Throws `CiError("MISSING_CI_CONFIG")` when the loaded config
 * carries no `ci` block, and `CiError("TOOL_TOO_OLD")` (via `renderCi`)
 * when a committed generated file names a version newer than this tool
 * supports. The CLI wiring maps every `CiError` to exit 65 (`DATA`).
 */
export async function runCi(ci: CiConfig | undefined, repoRoot: string, check: boolean): Promise<RunCiResult> {
  if (ci === undefined) {
    throw new CiError("MISSING_CI_CONFIG", `catalog.config.json has no "ci" block — nothing to render`);
  }

  const files = await renderCi(ci, repoRoot);

  if (!check) {
    await writeCi(repoRoot, files);
    return { files: files.map((file) => file.path) };
  }

  const results = await checkCi(repoRoot, files);
  const drifted = results.filter((result) => result.drift).map((result) => result.path);
  if (drifted.length > 0) {
    throw new CiError(
      "DRIFT",
      `${drifted.length} generated CI file(s) do not match catalog.config.json — ` +
        `re-run \`npx ocx-catalog ci\` and commit the result: ${drifted.join(", ")}`,
    );
  }
  return { files: files.map((file) => file.path) };
}
