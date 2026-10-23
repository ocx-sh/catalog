import { copyFile, lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative as relativePath, sep } from "node:path";
import { parse } from "yaml";
import { isDocsAsset, type DocsSource } from "../site/model/docs.js";
import { BuildError } from "./errors.js";

/** Leading `---` fenced block (after an optional UTF-8 BOM); the body is group 1 (absent for an empty block). */
const FRONTMATTER = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
/**
 * A character a page name cannot carry into its route: `\\` and control characters
 * break the URL, `#` and `?` end its path, `%` starts an escape. Anything else (spaces,
 * Unicode) is percent-encoded where the name becomes a link (`model/docs.ts`).
 */
const UNROUTABLE = /[\\#?%\p{Cc}]/u;
/** An ATX level-1 heading line: `# Title`, with an optional closing `#` run. */
const ATX_H1 = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
/** The opening or closing line of a fenced code block. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The title of a page with no frontmatter `title` and no H1: its last route segment, `Overview` for the docs root. */
const fallbackTitle = (slug: string): string => (slug === "" ? "Overview" : slug.slice(slug.lastIndexOf("/") + 1));

/** Heading text as plain text: links reduced to their label, code and emphasis markers dropped. */
const plainHeading = (text: string): string => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "").trim();

/** The text of the first level-1 heading outside a fenced code block (VitePress titled an untitled page from it). */
const firstH1 = (markdown: string): string | undefined => {
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1]?.[0];
    if (marker !== undefined) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined) {
      const text = ATX_H1.exec(line)?.[1];
      if (text !== undefined) return plainHeading(text);
    }
  }
  return undefined;
};

/**
 * Scans the consumer's `docs` directory into the pre-scanned list `siteModel`
 * takes (the model stays pure, C-031): every `**\/*.md` file — never `.mdx`,
 * never a dot-file or dot-directory, matching the content glob
 * (`content_config.ts`) — as a `DocsSource`. Its `id` is the path without `.md`
 * (the collection id); its `slug` is the route, which is the same except that an
 * `index.md` maps to its directory (`index` → `""`, `guide/index` → `"guide"`).
 * `title` comes from frontmatter, else the first H1 (as VitePress titled an
 * untitled page), else the file name; `description` and `order` from
 * frontmatter when present. The engine calls this when `docs` is set.
 *
 * @throws BuildError `DATA` for a name that cannot be a route (`#`, `?`, `%`,
 *   `\\` or a control character), two files that map to one route (`foo.md` and
 *   `foo/index.md`), frontmatter that is not valid YAML, or a frontmatter
 *   `title`/`description`/`order` of the wrong type — each would otherwise fail later, in Astro.
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
    if (UNROUTABLE.test(id)) {
      throw new BuildError("DATA", `docs: ${relative} is not a routable page name (no "#", "?", "%", "\\" or control character)`);
    }
    const slug = id === "index" ? "" : id.endsWith("/index") ? id.slice(0, -"/index".length) : id;
    // Keyed as a case-insensitive, normalisation-insensitive file system would see it: `Guide.md` and
    // `guide.md`, or the NFC and NFD spellings of one name, would be one directory on macOS and Windows.
    const key = slug.normalize("NFC").toLowerCase();
    const other = fileOfSlug.get(key);
    if (other !== undefined) {
      throw new BuildError("DATA", `docs: ${other} and ${relative} both map to /docs/${slug}/`);
    }
    fileOfSlug.set(key, relative);
    const text = await readFile(path, "utf8");
    const block = FRONTMATTER.exec(text);
    let data: Record<string, unknown>;
    try {
      data = (parse(block?.[1] ?? "") ?? {}) as Record<string, unknown>;
    } catch (err) {
      throw new BuildError("DATA", `docs: ${relative} frontmatter is not valid YAML: ${(err as Error).message}`, { cause: err });
    }
    if (data.title !== undefined && typeof data.title !== "string") {
      throw new BuildError("DATA", `docs: ${relative} frontmatter "title" must be a string`);
    }
    if (data.description !== undefined && typeof data.description !== "string") {
      throw new BuildError("DATA", `docs: ${relative} frontmatter "description" must be a string`);
    }
    if (data.order !== undefined && (typeof data.order !== "number" || !Number.isFinite(data.order))) {
      throw new BuildError("DATA", `docs: ${relative} frontmatter "order" must be a number`);
    }
    sources.push({
      slug,
      id,
      title: data.title ?? (firstH1(text.slice(block?.[0].length ?? 0)) || fallbackTitle(slug)),
      ...(data.description === undefined ? {} : { description: data.description }),
      ...(data.order === undefined ? {} : { order: data.order }),
    });
  }
  return sources;
};

/**
 * Carries the docs tree's other files (images, downloads) to `<publicDir>/docs/`,
 * where a page's relative link to them resolves (VitePress served them beside the
 * pages). Markdown and MDX sources stay behind, as do dot-files and dot-directories
 * (`isDocsAsset`). `pages` are the scanned pages: an asset may not take a page's
 * place in the built site.
 *
 * @throws BuildError `DATA` for a symbolic link anywhere in the docs tree (it
 *   could carry a file from outside the tree into a published site), and for an
 *   asset that would replace a page: `<route>/index.html`, a file named like a
 *   page's directory, or a file standing where a page's directory must be (all
 *   compared case-insensitively and NFC-normalised); and for an asset whose copy
 *   would overwrite a file the consumer's `publicDir` already put at that path.
 */
export const copyDocsAssets = async (docsDir: string, publicDir: string, pages: readonly DocsSource[]): Promise<void> => {
  const entries = await readdir(docsDir, { recursive: true, withFileTypes: true });
  const assets: string[] = [];
  for (const entry of entries) {
    const relative = relativePath(docsDir, join(entry.parentPath, entry.name)).split(sep).join("/");
    if (relative.split("/").some((segment) => segment.startsWith("."))) continue;
    if (entry.isSymbolicLink()) {
      throw new BuildError("DATA", `docs: ${relative} is a symbolic link; docs files must be regular files and directories`);
    }
    if (entry.isFile() && isDocsAsset(relative)) assets.push(relative);
  }
  // Compared like D-121's route keys: a case-folding host serves `Guide` and `guide` as one path.
  const fold = (path: string): string => path.normalize("NFC").toLowerCase();
  const routes = new Map(pages.map(({ slug }) => [fold(slug), slug]));
  for (const asset of assets) {
    const folded = fold(asset);
    const page = folded.endsWith("/index.html") ? folded.slice(0, -"/index.html".length) : folded === "index.html" ? "" : undefined;
    const clash =
      page !== undefined && routes.has(page)
        ? routes.get(page)
        : [...routes].find(([slug]) => slug === folded || slug.startsWith(`${folded}/`))?.[1];
    if (clash !== undefined) {
      throw new BuildError("DATA", `docs: ${asset} would replace the page /docs/${clash}/ in the built site; rename the file`);
    }
  }
  for (const asset of assets) {
    const target = join(publicDir, "docs", asset);
    if (await lstat(target).then(() => true, () => false)) {
      throw new BuildError("DATA", `docs: ${join(docsDir, asset)} would overwrite ${target}, a file already in publicDir; rename one of the two`);
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(docsDir, asset), target);
  }
};
