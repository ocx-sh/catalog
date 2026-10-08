/**
 * C-020 — `scanDocs` turns the consumer's docs directory into the pre-scanned
 * `DocsSource[]` the pure site model takes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanDocs } from "../../src/build/docs_scan.js";
import { BuildError } from "../../src/build/errors.js";
import { docsView } from "../../src/site/model/docs.js";
import { withTempDir } from "./helpers.js";

async function docsDir(dir: string, files: Record<string, string>): Promise<string> {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

const bySlug = (sources: readonly { slug: string }[]) => [...sources].sort((a, b) => a.slug.localeCompare(b.slug));

describe("scanDocs", () => {
  it("scans nested .md files into slugs with frontmatter title and order", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, {
        "intro.md": "---\ntitle: Introduction\norder: 3\n---\n# Hi\n",
        "guide/deep/page.md": "---\ntitle: 'Deep: a page'\n---\nbody",
      });
      expect(bySlug(await scanDocs(dir))).toEqual([
        { slug: "guide/deep/page", id: "guide/deep/page", title: "Deep: a page" },
        { slug: "intro", id: "intro", title: "Introduction", order: 3 },
      ]);
    });
  });

  it("falls back to the file name for a title, with or without an empty or missing frontmatter block", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "a/plain.md": "# no frontmatter\n", "b/empty.md": "---\n---\ntext", "c.md": "---\r\norder: 0\r\n---\r\n" });
      expect(bySlug(await scanDocs(dir))).toEqual([
        { slug: "a/plain", id: "a/plain", title: "plain" },
        { slug: "b/empty", id: "b/empty", title: "empty" },
        { slug: "c", id: "c", title: "c", order: 0 },
      ]);
    });
  });

  it("maps an index.md to its directory: the root index to \"\", <dir>/index.md to <dir>", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, {
        "index.md": "---\ntitle: Docs home\n---\n",
        "guide/index.md": "---\ntitle: The guide\norder: 1\n---\n",
        "a/b/index.md": "x",
        "guide/install.md": "x",
        "indexed.md": "x",
        "reindex/guide.md": "x",
      });
      expect(bySlug(await scanDocs(dir))).toEqual([
        { slug: "", id: "index", title: "Docs home" },
        { slug: "a/b", id: "a/b/index", title: "b" },
        { slug: "guide", id: "guide/index", title: "The guide", order: 1 },
        { slug: "guide/install", id: "guide/install", title: "install" },
        { slug: "indexed", id: "indexed", title: "indexed" },
        { slug: "reindex/guide", id: "reindex/guide", title: "guide" },
      ]);
    });
  });

  it("titles an untitled index page after its directory, the docs root \"Overview\"", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "index.md": "# hi", "guide/index.md": "# hi" });
      expect(bySlug(await scanDocs(dir)).map((s) => s.title)).toEqual(["Overview", "guide"]);
    });
  });

  it("rejects two files that map to one route, naming both", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "guide.md": "x", "guide/index.md": "x" });
      const error = await scanDocs(dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).code).toBe("DATA");
      expect((error as Error).message).toMatch(/both map to \/docs\/guide\/$/);
      expect((error as Error).message).toContain("guide.md");
      expect((error as Error).message).toContain("guide/index.md");
    });
  });

  it("keeps the URL-safety check on an index page's path", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "My Guide/index.md": "x" });
      await expect(scanDocs(dir)).rejects.toThrow(/My Guide\/index\.md is not a URL-safe page name/);
    });
  });

  it("ignores .mdx, other extensions, dot-files and dot-directories", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, {
        "keep.md": "x",
        "notes.mdx": "x",
        "data.json": "{}",
        ".hidden.md": "x",
        ".git/config.md": "x",
        "sub/.draft.md": "x",
      });
      expect((await scanDocs(dir)).map((s) => s.slug)).toEqual(["keep"]);
    });
  });

  it("rejects a page name that is not URL-safe", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "guide/My Notes.md": "x" });
      await expect(scanDocs(dir)).rejects.toThrow(BuildError);
      await expect(scanDocs(dir)).rejects.toThrow(/guide\/My Notes\.md is not a URL-safe page name/);
    });
  });

  it("rejects a non-string title and a non-numeric order, naming the file", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "t.md": "---\ntitle: 5\n---\n" });
      await expect(scanDocs(dir)).rejects.toThrow(/t\.md frontmatter "title" must be a string/);
    });
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "o.md": "---\norder: first\n---\n" });
      await expect(scanDocs(dir)).rejects.toThrow(/o\.md frontmatter "order" must be a number/);
    });
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "o.md": "---\norder: .inf\n---\n" });
      await expect(scanDocs(dir)).rejects.toThrow(/o\.md frontmatter "order" must be a number/);
    });
  });

  it("rejects frontmatter that is not valid YAML as a DATA error naming the file", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "guide/bad.md": "---\ntitle: [unclosed\n---\nbody" });
      const error = await scanDocs(dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).code).toBe("DATA");
      expect((error as Error).message).toMatch(/^docs: guide\/bad\.md frontmatter is not valid YAML: /);
      expect((error as Error).cause).toBeInstanceOf(Error);
    });
  });

  it("reads the frontmatter of a file that starts with a UTF-8 BOM", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "bom.md": "\uFEFF---\ntitle: With BOM\norder: 2\n---\nbody" });
      expect(await scanDocs(dir)).toEqual([{ slug: "bom", id: "bom", title: "With BOM", order: 2 }]);
    });
  });

  it("scans the docs fixture into the sidebar the contract names (C-020)", async () => {
    const fixture = fileURLToPath(new URL("../fixtures/site/docs-fixture", import.meta.url));
    const view = docsView(await scanDocs(fixture), "/");
    expect(view.pages.map((p) => p.slug)).toEqual(["", "guide", "guide/getting-started", "guide/install", "reference/cli"]);
    expect(view.groups.map((g) => g.label)).toEqual(["", "guide", "reference"]);
    expect(view.groups[1]?.pages[0]).toMatchObject({ title: "Guide overview", href: "/docs/guide/" });
  });
});
