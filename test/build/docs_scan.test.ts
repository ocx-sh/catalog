/**
 * C-020 — `scanDocs` turns the consumer's docs directory into the pre-scanned
 * `DocsSource[]` the pure site model takes.
 */
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copyDocsAssets, scanDocs } from "../../src/build/docs_scan.js";
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
      await docsDir(dir, { "a/plain.md": "no heading\n", "b/empty.md": "---\n---\ntext", "c.md": "---\r\norder: 0\r\n---\r\n" });
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
      await docsDir(dir, { "index.md": "hi", "guide/index.md": "hi" });
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

  it("D-121 rejects names that one case-insensitive or normalising file system would merge: case-only and NFC/NFD pairs", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "Guide.md": "x", "guide.md": "x" });
      await expect(scanDocs(dir)).rejects.toThrow(/Guide\.md and guide\.md both map to|guide\.md and Guide\.md both map to/);
    });
    await withTempDir("catalog-docs-scan-", async (dir) => {
      // "Über" as one code point (NFC) and as U+0055 U+0308 (NFD).
      await docsDir(dir, { "\u00dcber.md": "x", "U\u0308ber.md": "x" });
      const error = await scanDocs(dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).code).toBe("DATA");
      expect((error as Error).message).toContain("both map to");
    });
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "a/Intro/index.md": "x", "a/intro.md": "x" });
      await expect(scanDocs(dir)).rejects.toThrow(/both map to/);
    });
  });

  it("D-121 keeps the routability check on an index page's path", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "100%/index.md": "x" });
      await expect(scanDocs(dir)).rejects.toThrow(/100%\/index\.md is not a routable page name/);
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

  it("D-121 accepts any file name VitePress served: spaces, Unicode, and a dot-bearing page name", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "guide/My Notes.md": "x", "Über uns.md": "x", "v1.2/Setup (old).md": "x" });
      expect((await scanDocs(dir)).map((s) => s.slug).sort()).toEqual(["guide/My Notes", "v1.2/Setup (old)", "Über uns"]);
    });
  });

  it.each(["a#b.md", "what?.md", "100%.md", "back\\slash.md", "ctl\u0007.md"])(
    "D-121 rejects the name %j, which cannot be a route, as a DATA error",
    async (name) => {
      await withTempDir("catalog-docs-scan-", async (dir) => {
        await docsDir(dir, { [name]: "x" });
        const error = await scanDocs(dir).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BuildError);
        expect((error as BuildError).code).toBe("DATA");
        expect((error as Error).message).toMatch(/is not a routable page name/);
      });
    },
  );

  it("D-116 titles a page without a frontmatter title from its first H1, as VitePress did", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, {
        "a.md": "intro\n\n# The A page\n\n## sub\n",
        "b.md": "---\ntitle: Frontmatter wins\n---\n# Ignored H1\n",
        "c.md": "```md\n# not a title\n```\n\n~~~\n# nor this\n~~~\n\n# The `c` **page** [linked](./a.md) #\n",
        "d.md": "## only a second-level heading\n#hashtag is not a heading\n",
        "e.md": "```md\n~~~\n# still inside the backtick fence\n```\n# After the fence\n",
        "index.md": "---\norder: 1\n---\n# Home\n",
        "empty.md": "# **`**\n",
      });
      const titles = Object.fromEntries((await scanDocs(dir)).map((s) => [s.id, s.title]));
      expect(titles).toEqual({
        a: "The A page",
        b: "Frontmatter wins",
        c: "The c page linked",
        d: "d",
        e: "After the fence",
        index: "Home",
        empty: "empty",
      });
    });
  });

  it("D-120 reads a frontmatter description and rejects a non-string one, naming the file", async () => {
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "a.md": "---\ndescription: What a is for.\n---\n", "b.md": "x" });
      expect(bySlug(await scanDocs(dir))).toEqual([
        { slug: "a", id: "a", title: "a", description: "What a is for." },
        { slug: "b", id: "b", title: "b" },
      ]);
    });
    await withTempDir("catalog-docs-scan-", async (dir) => {
      await docsDir(dir, { "d.md": "---\ndescription: 5\n---\n" });
      await expect(scanDocs(dir)).rejects.toThrow(/d\.md frontmatter "description" must be a string/);
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
    expect(view.pages.map((p) => p.slug)).toEqual([
      "",
      "guide",
      "guide/getting-started",
      "guide/install",
      "guide/untitled",
      "reference/cli",
      "reference/release notes",
    ]);
    expect(view.groups.map((g) => g.label)).toEqual(["", "guide", "reference"]);
    expect(view.groups[1]?.pages[0]).toMatchObject({ title: "Guide overview", href: "/docs/guide/" });
  });
});

describe("copyDocsAssets", () => {
  it("D-117 carries images and downloads to <publicDir>/docs/, leaving markdown, MDX and dot-files behind", async () => {
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const docs = await docsDir(join(dir, "docs"), {
        "page.md": "x",
        "notes.mdx": "x",
        "img/logo.png": "png",
        "guide/files/archive.tar.gz": "tgz",
        "guide/.hidden.txt": "x",
        ".git/config": "x",
        "guide/deep.md": "x",
      });
      const publicDir = join(dir, "public");
      await mkdir(publicDir, { recursive: true });

      await copyDocsAssets(docs, publicDir, [{ slug: "page", id: "page", title: "Page" }]);

      const copied = (await readdir(join(publicDir, "docs"), { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(join(publicDir, "docs").length + 1).split("\\").join("/"))
        .sort();
      expect(copied).toEqual(["guide/files/archive.tar.gz", "img/logo.png"]);
      expect(await readFile(join(publicDir, "docs", "img", "logo.png"), "utf8")).toBe("png");
    });
  });

  it("D-117 refuses a symbolic link in the docs tree, a file or a directory pointing outside it, naming the path", async () => {
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const outside = await docsDir(join(dir, "outside"), { "secret.txt": "runner secret", "deep/key.pem": "key" });
      const publicDir = join(dir, "public");
      for (const [name, target] of [["leak.txt", join(outside, "secret.txt")], ["files", outside], ["ok/nested/leak.pem", join(outside, "deep/key.pem")]] as const) {
        const docs = await docsDir(join(dir, `docs-${name.replaceAll("/", "-")}`), { "page.md": "x", "ok/nested/keep.txt": "k" });
        await symlink(target, join(docs, name));
        const error = await copyDocsAssets(docs, publicDir, []).catch((e: unknown) => e);
        expect(error, name).toBeInstanceOf(BuildError);
        expect((error as BuildError).code).toBe("DATA");
        expect((error as Error).message).toBe(`docs: ${name} is a symbolic link; docs files must be regular files and directories`);
      }
      expect(await readdir(dir).then((names) => names.includes("public"))).toBe(false);
    });
  });

  it("D-117 refuses a symbolic link that is a markdown source too, but not one inside a dot-directory", async () => {
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const outside = await docsDir(join(dir, "outside"), { "secret.md": "s" });
      const bad = await docsDir(join(dir, "bad"), { "a.md": "x" });
      await symlink(join(outside, "secret.md"), join(bad, "linked.md"));
      await expect(copyDocsAssets(bad, join(dir, "p1"), [])).rejects.toThrow(/linked\.md is a symbolic link/);
      const fine = await docsDir(join(dir, "fine"), { "a.md": "x", ".git/keep": "k" });
      await symlink(join(outside, "secret.md"), join(fine, ".git", "link"));
      await expect(copyDocsAssets(fine, join(dir, "p2"), [])).resolves.toBeUndefined();
    });
  });

  it("D-117 refuses an asset that would replace a page in the built site", async () => {
    const pages = [
      { slug: "", id: "index", title: "Home" },
      { slug: "guide", id: "guide/index", title: "Guide" },
      { slug: "guide/install", id: "guide/install", title: "Install" },
    ];
    const cases: [string, string][] = [
      ["guide/install/index.html", "guide/install"],
      ["guide/index.html", "guide"],
      ["index.html", ""],
      ["guide/install", "guide/install"],
      ["guide", "guide"],
    ];
    for (const [asset, page] of cases) {
      await withTempDir("catalog-docs-assets-", async (dir) => {
        const docs = await docsDir(join(dir, "docs"), { [asset]: "x" });
        const error = await copyDocsAssets(docs, join(dir, "public"), pages).catch((e: unknown) => e);
        expect(error, asset).toBeInstanceOf(BuildError);
        expect((error as BuildError).code).toBe("DATA");
        expect((error as Error).message).toBe(`docs: ${asset} would replace the page /docs/${page}/ in the built site; rename the file`);
      });
    }
    // An asset that only looks similar is fine.
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const docs = await docsDir(join(dir, "docs"), { "other/index.html": "x", "guides": "x", "guide/install.txt": "x" });
      await copyDocsAssets(docs, join(dir, "public"), pages);
      expect(await readFile(join(dir, "public/docs/other/index.html"), "utf8")).toBe("x");
    });
  });

  it("D-117 matches the asset-vs-page clash case-insensitively and NFC-normalised", async () => {
    const pages = [{ slug: "Guide", id: "Guide/index", title: "Guide" }, { slug: "caf\u00e9", id: "caf\u00e9", title: "Cafe" }];
    for (const [asset, page] of [["guide/index.html", "Guide"], ["GUIDE", "Guide"], ["cafe\u0301", "caf\u00e9"]] as const) {
      await withTempDir("catalog-docs-assets-", async (dir) => {
        const docs = await docsDir(join(dir, "docs"), { [asset]: "x" });
        await expect(copyDocsAssets(docs, join(dir, "public"), pages), asset).rejects.toThrow(`would replace the page /docs/${page}/`);
      });
    }
  });

  it("D-117 refuses an asset that would overwrite a file publicDir already holds, naming both", async () => {
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const docs = await docsDir(join(dir, "docs"), { "img/a.png": "docs" });
      const publicDir = await docsDir(join(dir, "public"), { "docs/img/a.png": "public" });
      const error = await copyDocsAssets(docs, publicDir, []).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).code).toBe("DATA");
      expect((error as Error).message).toContain(join(docs, "img/a.png"));
      expect((error as Error).message).toContain(join(publicDir, "docs/img/a.png"));
      expect(await readFile(join(publicDir, "docs/img/a.png"), "utf8")).toBe("public");
    });
  });

  it("D-117 copies a docs directory that is itself a dot-directory", async () => {
    await withTempDir("catalog-docs-assets-", async (dir) => {
      const docs = await docsDir(join(dir, ".docs"), { "a.png": "png" });
      await copyDocsAssets(docs, join(dir, "public"), []);
      expect(await readFile(join(dir, "public", "docs", "a.png"), "utf8")).toBe("png");
    });
  });
});
