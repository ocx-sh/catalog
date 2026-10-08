/**
 * README pre-render (C-014, C-037, C-047). jsdom cannot run inside the Astro
 * child, so the CLI parent renders and sanitises every route's README during
 * assembly and writes the result to `<scratch>/readme/<hash>.html`; the pages
 * only read that file (`ReadmePane.astro`). `createReadmeRenderer` isolates
 * faults (oversize, missing, sanitizer failure): such a route gets `null`, one
 * stderr warning, and the build goes on.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { README_DIR } from "./assemble.js";
import { createReadmeRenderer } from "../site/lib/readmeRender.js";
import type { SiteModel } from "../site/model/index.js";

/**
 * @param scratch where the files are written
 * @param model the pure `siteModel()`: its `readme` still holds each route's CAS path
 * @param liveScratch the scratch root the files end up in, when `scratch` is a
 *   staging dir a `dev` reload swaps in: the returned paths point there
 * @returns each route key's absolute path of the sanitised HTML, `null` when
 *   the route has no README or it could not be rendered
 */
export async function renderReadmes(
  scratch: string,
  publicDir: string,
  model: SiteModel,
  liveScratch: string = scratch,
): Promise<Record<string, string | null>> {
  const dir = join(scratch, README_DIR);
  await mkdir(dir, { recursive: true });
  const renderer = createReadmeRenderer({ publicDir });
  const rendered: Record<string, string | null> = {};
  try {
    for (const key of model.routes) {
      const result = await renderer.render(model.details[key]?.name ?? key, model.readme[key] ?? null);
      if (result.kind === "ok") {
        // The file name is a hash of the key: a route key never reaches a path.
        const name = `${createHash("sha256").update(key).digest("hex")}.html`;
        await writeFile(join(dir, name), result.html, "utf8");
        rendered[key] = join(liveScratch, README_DIR, name);
      } else {
        rendered[key] = null;
      }
    }
  } finally {
    renderer.close();
  }
  return rendered;
}
