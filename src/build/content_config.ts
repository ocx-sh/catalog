import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Writes the scratch `src/content.config.ts` declaring the one docs
 * collection: glob loader, pattern `**\/*.md` only (no MDX — MDX is code
 * execution at build), absolute `base`, no copy. Written only when `docs` is
 * set (the caller decides).
 *
 * `base` is the docs directory as a `file:` URL: Astro resolves a string
 * `base` against the project root, and a bare Windows path (`C:\…`) would
 * parse as a URL scheme. The entry id is the path under `base` without `.md`
 * (`index`, `guide/index` — never an empty id, which `getEntry` rejects), so it
 * equals the `id` `scanDocs` reports (`docs_scan.ts`); the route slug, where an
 * `index` maps to its directory, is derived there — Astro's default id would
 * slugify (lowercase, strip) and let the two drift. The one
 * interpolated value goes through `JSON.stringify` (C-040).
 *
 * Wired by the engine; `docs.astro` reads the collection.
 *
 * @returns the written file's path
 */
export const writeContentConfig = async (root: string, docsDir: string): Promise<string> => {
  const source = `import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const collections = { docs: defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: ${JSON.stringify(pathToFileURL(docsDir).href)},
    generateId: ({ entry }) => entry.slice(0, -".md".length),
  }),
  schema: z.object({ title: z.string().optional(), order: z.number().optional() }),
}) };
`;
  const path = join(root, "src", "content.config.ts");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(path, source);
  return path;
};
