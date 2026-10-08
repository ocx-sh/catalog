import { readdir, readFile } from "node:fs/promises";
import { join, relative as relativePath, sep } from "node:path";
import { parse } from "yaml";
import type { DocsSource } from "../site/model/docs.js";
import { BuildError } from "./errors.js";

/** Leading `---` fenced block (after an optional UTF-8 BOM); the body is group 1 (absent for an empty block). */
const FRONTMATTER = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
/** One URL path segment of a slug: no dot-leading name, no space or reserved character. */
const SLUG_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** The title of a page with no frontmatter `title`: its last route segment, `Overview` for the docs root. */
const fallbackTitle = (slug: string): string => (slug === "" ? "Overview" : slug.slice(slug.lastIndexOf("/") + 1));

/**
 * Scans the consumer's `docs` directory into the pre-scanned list `siteModel`
 * takes (the model stays pure, C-031): every `**\/*.md` file — never `.mdx`,
 * never a dot-file or dot-directory, matching the content glob
 * (`content_config.ts`) — as a `DocsSource`. Its `id` is the path without `.md`
 * (the collection id); its `slug` is the route, which is the same except that an
 * `index.md` maps to its directory (`index` → `""`, `guide/index` → `"guide"`).
 * `title` comes from frontmatter, else the file name; `order` from
 * frontmatter when present. The engine calls this when `docs` is set.
 *
 * @throws BuildError `DATA` for a path that is not URL-safe, two files that map
 *   to one route (`foo.md` and `foo/index.md`), frontmatter that is not valid
 *   YAML, or a frontmatter `title`/`order` of the wrong type — each would otherwise fail later, in Astro.
 */
export const scanDocs = async (docsDir: string): Promise<DocsSource[]> => {
  const entries = await readdir(docsDir, { recursive: true, withFileTypes: true });
  const sources: DocsSource[] = [];
  const fileOfSlug = new Map<string, string>();
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const relative = relativePath(docsDir, path).split(sep).join("/");
    if (!entry.isFile() || !relative.endsWith(".md") || relative.split("/").some((part) => part.startsWith("."))) {
      continue;
    }
    const id = relative.slice(0, -".md".length);
    if (!id.split("/").every((segment) => SLUG_SEGMENT.test(segment))) {
      throw new BuildError("DATA", `docs: ${relative} is not a URL-safe page name (letters, digits, "-", "_", ".")`);
    }
    const slug = id === "index" ? "" : id.endsWith("/index") ? id.slice(0, -"/index".length) : id;
    const other = fileOfSlug.get(slug);
    if (other !== undefined) {
      throw new BuildError("DATA", `docs: ${other} and ${relative} both map to /docs/${slug}/`);
    }
    fileOfSlug.set(slug, relative);
    const body = FRONTMATTER.exec(await readFile(path, "utf8"))?.[1] ?? "";
    let data: Record<string, unknown>;
    try {
      data = (parse(body) ?? {}) as Record<string, unknown>;
    } catch (err) {
      throw new BuildError("DATA", `docs: ${relative} frontmatter is not valid YAML: ${(err as Error).message}`, { cause: err });
    }
    if (data.title !== undefined && typeof data.title !== "string") {
      throw new BuildError("DATA", `docs: ${relative} frontmatter "title" must be a string`);
    }
    if (data.order !== undefined && (typeof data.order !== "number" || !Number.isFinite(data.order))) {
      throw new BuildError("DATA", `docs: ${relative} frontmatter "order" must be a number`);
    }
    sources.push({
      slug,
      id,
      title: data.title ?? fallbackTitle(slug),
      ...(data.order === undefined ? {} : { order: data.order }),
    });
  }
  return sources;
};
