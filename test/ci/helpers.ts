import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export { withTempDir } from "../config/helpers.js";

/** Writes `content` verbatim to `<dir>/<relPath>`, creating parent
 * directories as needed — for planting a "committed generated file" fixture
 * ahead of `discoverGeneratedFiles`/`renderCi`/`checkCi`. */
export async function writeGenerated(dir: string, relPath: string, content: string): Promise<void> {
  const abs = join(dir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}
