/**
 * The docs search index (`data/catalog/docs-index.json`): one entry per docs
 * page — title, headings and a text excerpt — that the command palette ranks
 * with MiniSearch on its first open. Written only when a docs mount exists, so
 * a catalog without docs carries no such file. The page list is `scanDocs`'s;
 * this reads each page's markdown for the headings and the excerpt.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { docsView, type DocsSource } from "../site/model/docs.js";
import { DOCS_INDEX_PATH, type DocsIndexEntry } from "../site/lib/docsIndexWire.js";

const FRONTMATTER = /^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
/** Characters of body text kept per page. */
const EXCERPT_LENGTH = 600;
/** Headings kept per page, so one very long page cannot bloat the index. */
const MAX_HEADINGS = 20;

/** Markdown inline syntax reduced to its text: links to their label, images dropped, markers removed. */
const plain = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Headings and prose of a page body; fenced code is left out of both. */
const outline = (markdown: string): { headings: string[]; text: string } => {
  const headings: string[] = [];
  const prose: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.replace(FRONTMATTER, "").split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1]?.[0];
    if (marker !== undefined) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined) {
      const heading = HEADING.exec(line)?.[1];
      if (heading === undefined) prose.push(line);
      else headings.push(plain(heading));
    }
  }
  return { headings: headings.slice(0, MAX_HEADINGS), text: plain(prose.join(" ")).slice(0, EXCERPT_LENGTH) };
};

/** A directory name as a breadcrumb (`run-books` → `run books`), as the sidebar's group titles read. */
const crumb = (directory: string): string => directory.replace(/[-_]+/g, " ");

export const docsIndex = async (docsDir: string, sources: readonly DocsSource[], base: string): Promise<DocsIndexEntry[]> => {
  // The link is the docs model's own, so the palette and the sidebar can never disagree about a route.
  const hrefs = new Map(docsView(sources, base).pages.map((page) => [page.id, page.href]));
  return Promise.all(
    sources.map(async ({ id, title }) => {
      const { headings, text } = outline(await readFile(join(docsDir, `${id}.md`), "utf8"));
      const directories = id.split("/").slice(0, -1);
      return { id, href: hrefs.get(id) as string, title, crumbs: directories.map(crumb), headings, text };
    }),
  );
};

/** Writes the docs index into the public tree next to `catalog.json`. */
export async function writeDocsIndex(
  publicDir: string,
  docsDir: string,
  sources: readonly DocsSource[],
  base: string,
): Promise<void> {
  const path = join(publicDir, DOCS_INDEX_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(await docsIndex(docsDir, sources, base)), "utf8");
}
