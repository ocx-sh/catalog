/**
 * C-020 — the scratch `src/content.config.ts` declares the one docs
 * collection. Written only when `docs` is set; the glob matches `.md` only;
 * the docs path reaches the generated source through `JSON.stringify` alone.
 */
import { access, readFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeContentConfig } from "../../src/build/content_config.js";
import { withTempDir } from "./helpers.js";

/** The `base` string literal the generated source carries, decoded back to a path. */
function baseOf(source: string): string {
  const literal = /base: ("(?:[^"\\]|\\.)*")/.exec(source)?.[1] ?? "";
  return fileURLToPath(JSON.parse(literal) as string);
}

describe("writeContentConfig", () => {
  it("writes <root>/src/content.config.ts and returns its path", async () => {
    await withTempDir("catalog-content-config-", async (root) => {
      const path = await writeContentConfig(root, "/consumer/docs");
      expect(path).toBe(join(root, "src", "content.config.ts"));
      await expect(access(path)).resolves.toBeUndefined();
    });
  });

  it("declares one docs collection: glob loader, absolute base, no copy, title? and order? schema", async () => {
    await withTempDir("catalog-content-config-", async (root) => {
      const source = await readFile(await writeContentConfig(root, "/consumer/docs"), "utf8");
      expect(source).toContain('import { glob } from "astro/loaders"');
      expect(source).toContain("export const collections = { docs: defineCollection(");
      expect(baseOf(source)).toBe("/consumer/docs");
      expect(source).toContain("title: z.string().optional()");
      expect(source).toContain("order: z.number().optional()");
      expect(source).not.toContain("mdx");
    });
  });

  it("matches .md files at any depth and never .mdx", async () => {
    await withTempDir("catalog-content-config-", async (root) => {
      const source = await readFile(await writeContentConfig(root, "/consumer/docs"), "utf8");
      const pattern = JSON.parse(/pattern: ("[^"]*")/.exec(source)?.[1] ?? "null") as string;
      expect(pattern).toBe("**/*.md");
      expect(matchesGlob("intro.md", pattern)).toBe(true);
      expect(matchesGlob("guide/deep/page.md", pattern)).toBe(true);
      expect(matchesGlob("notes.mdx", pattern)).toBe(false);
      expect(matchesGlob("guide/notes.mdx", pattern)).toBe(false);
    });
  });

  it("derives the entry id from the path under base, so ids are exactly what the scanner reports", async () => {
    await withTempDir("catalog-content-config-", async (root) => {
      const source = await readFile(await writeContentConfig(root, "/consumer/docs"), "utf8");
      const generateId = /generateId: (\(\{ entry \}\) => [^\n]+?),\n/.exec(source)?.[1] ?? "";
      const id = new Function(`return (${generateId})`)() as (o: { entry: string }) => string;
      expect(id({ entry: "guide/Getting Started.md" })).toBe("guide/Getting Started");
      // An index keeps its file path: an empty id is rejected by getEntry, and the
      // route slug (index -> its directory) is derived by scanDocs, not here.
      expect(id({ entry: "index.md" })).toBe("index");
      expect(id({ entry: "guide/index.md" })).toBe("guide/index");
    });
  });

  it("interpolates a hostile docs path only as a JSON string literal", async () => {
    await withTempDir("catalog-content-config-", async (root) => {
      const hostile = '/tmp/x"; process.exit(1); /*\\`${evil}\n`';
      const source = await readFile(await writeContentConfig(root, hostile), "utf8");
      expect(baseOf(source)).toBe(hostile);
      // The raw hostile text never appears unescaped in the generated source.
      expect(source).not.toContain('x"; process.exit');
      expect(source.split("\n").filter((line) => line.includes("evil"))).toHaveLength(1);
    });
  });
});
