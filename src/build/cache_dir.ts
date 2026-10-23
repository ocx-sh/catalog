import { stat } from "node:fs/promises";
import { join } from "node:path";

/** True when `dir` exists and is a directory. */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The base directory every scratch root is created under — see `scratch.ts`'s
 * doc "Location" section for why it's the consumer's own `node_modules`
 * rather than `os.tmpdir()`.
 *
 * Its own module so `scratch.ts` and `sources_pipeline.ts` share it without
 * importing each other. `sources_pipeline.ts` puts the
 * `url` source layer's cross-build fetch cache in a sibling subdirectory:
 * that cache's whole value is surviving BETWEEN builds (ETag/conditional GET
 * + content-addressed blobs, `walker.ts`), so it must live NEXT TO the
 * scratch roots, never inside one — a self-sweeping root would delete it
 * every run and silently turn every build into a cold fetch.
 */
export async function cacheBaseDir(): Promise<string> {
  const cwd = process.cwd();
  const nodeModules = join(cwd, "node_modules");
  if (await isDirectory(nodeModules)) {
    return join(nodeModules, ".cache", "ocx-catalog");
  }
  return join(cwd, ".ocx-catalog");
}

