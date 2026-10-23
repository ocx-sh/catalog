// The docs search index (D-174): one entry per docs page — title, headings, a text excerpt — written
// next to `catalog.json` for the palette to rank on its first open.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DOCS_INDEX_PATH } from "../../src/site/lib/docsIndexWire.js";
import { docsIndex, writeDocsIndex } from "../../src/viewmodel/docs_index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "docs-index-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function page(id: string, markdown: string): Promise<void> {
  await mkdir(dirname(join(dir, `${id}.md`)), { recursive: true });
  await writeFile(join(dir, `${id}.md`), markdown, "utf8");
}

test("D-174 an entry carries the title, the headings, a text excerpt and the section path as breadcrumbs", async () => {
  await page(
    "run-books/install",
    [
      "---",
      "title: Installing",
      "---",
      "# Installing",
      "",
      "Run the **installer** and read [the guide](./guide.md).",
      "",
      "## Verify the `checksum`",
      "",
      "Compare it.",
    ].join("\n"),
  );

  const [entry] = await docsIndex(dir, [{ id: "run-books/install", slug: "run-books/install", title: "Installing" }], "/catalog/");

  expect(entry).toEqual({
    id: "run-books/install",
    href: "/catalog/docs/run-books/install/",
    title: "Installing",
    crumbs: ["run books"],
    headings: ["Installing", "Verify the checksum"],
    text: "Run the installer and read the guide. Compare it.",
  });
});

test("D-174 fenced code, images and HTML are left out of the excerpt, and frontmatter never reaches it", async () => {
  await page(
    "index",
    ["---", "title: Home", "description: secret frontmatter words", "---", "Intro ![logo](a.png) <b>bold</b> text.", "```sh", "ocx install fenced-only", "~~~", "```", "~~~", "# not a heading", "~~~", "After."].join(
      "\n",
    ),
  );

  const [entry] = await docsIndex(dir, [{ id: "index", slug: "", title: "Home" }], "/");

  expect(entry!.text).toBe("Intro bold text. After.");
  expect(entry!.headings).toEqual([]);
  expect(entry!.crumbs).toEqual([]);
});

test("D-174 the excerpt is capped so the index stays small", async () => {
  await page("long", `# Long\n\n${"word ".repeat(1000)}`);

  const [entry] = await docsIndex(dir, [{ id: "long", slug: "long", title: "Long" }], "/");

  expect(entry!.text.length).toBe(600);
});

test("D-174 writeDocsIndex writes data/catalog/docs-index.json under the public dir", async () => {
  await page("index", "# Home\n\nHello.");

  await writeDocsIndex(join(dir, "public"), dir, [{ id: "index", slug: "", title: "Home" }], "/");

  const written = JSON.parse(await readFile(join(dir, "public", DOCS_INDEX_PATH), "utf8"));
  expect(written).toEqual([{ id: "index", href: "/docs/", title: "Home", crumbs: [], headings: ["Home"], text: "Hello." }]);
});

test("D-174 the entry link is the docs model's own: base-joined, percent-encoded, the docs root as /docs/", async () => {
  await page("index", "# Home");
  await page("release notes", "# Notes");

  const entries = await docsIndex(dir, [
    { id: "index", slug: "", title: "Home" },
    { id: "release notes", slug: "release notes", title: "Notes" },
  ], "/catalog/");

  expect(entries.map((entry) => entry.href)).toEqual(["/catalog/docs/", "/catalog/docs/release%20notes/"]);
});

test("D-174 headings are capped per page", async () => {
  await page("many", Array.from({ length: 50 }, (_, i) => `## Heading ${i}`).join("\n\n"));

  const [entry] = await docsIndex(dir, [{ id: "many", slug: "many", title: "Many" }], "/");

  expect(entry!.headings).toHaveLength(20);
  expect(entry!.headings[0]).toBe("Heading 0");
});
