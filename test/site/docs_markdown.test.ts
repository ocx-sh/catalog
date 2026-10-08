/**
 * The docs-mount link rewriter: `rewriteDocsHref` as a pure function, and the
 * hast plugin through the real Sätteri processor Astro runs it in.
 */
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { docsLinksPlugin, rewriteDocsHref } from "../../src/site/docs_markdown.js";

describe("rewriteDocsHref", () => {
  const rewrite = (href: string, file = "ops/run-reconcile-dry-run.md", base = "/catalog/"): string =>
    rewriteDocsHref(href, file, base);

  it("resolves a sibling page against its file, not against the directory route", () => {
    expect(rewrite("./m1-flip.md")).toBe("/catalog/docs/ops/m1-flip/");
    expect(rewrite("./m1-flip")).toBe("/catalog/docs/ops/m1-flip/");
    expect(rewrite("m1-flip.md")).toBe("/catalog/docs/ops/m1-flip/");
  });

  it("resolves ../ against the file and clamps at the docs root", () => {
    expect(rewrite("../guide/install.md")).toBe("/catalog/docs/guide/install/");
    expect(rewrite("../../../x.md")).toBe("/catalog/docs/x/");
  });

  it("serves an index.md at its directory", () => {
    expect(rewrite("./index.md")).toBe("/catalog/docs/ops/");
    expect(rewrite("../index.md")).toBe("/catalog/docs/");
    expect(rewrite("../guide/index.md")).toBe("/catalog/docs/guide/");
  });

  it("keeps a query and a fragment", () => {
    expect(rewrite("./m1-flip.md#step-2")).toBe("/catalog/docs/ops/m1-flip/#step-2");
    expect(rewrite("./m1-flip.md?tab=a#b")).toBe("/catalog/docs/ops/m1-flip/?tab=a#b");
    expect(rewrite("./m1-flip#b")).toBe("/catalog/docs/ops/m1-flip/#b");
  });

  it("maps a directory link to its route", () => {
    expect(rewrite("../guide/")).toBe("/catalog/docs/guide/");
    expect(rewrite("..")).toBe("/catalog/docs/");
    expect(rewrite("./")).toBe("/catalog/docs/ops/");
  });

  it("prefixes base onto a root-relative link and keeps its query and fragment", () => {
    expect(rewrite("/docs/guide/")).toBe("/catalog/docs/guide/");
    expect(rewrite("/sharkdp/bat/?x=../y#z")).toBe("/catalog/sharkdp/bat/?x=../y#z");
    expect(rewrite("/docs/guide/", "index.md", "/")).toBe("/docs/guide/");
  });

  it("treats #, ? and % in the docs file name as literal characters of its path", () => {
    expect(rewrite("./next.md", "c#/intro.md")).toBe("/catalog/docs/c%23/next/");
    expect(rewrite("./next.md", "what?/intro.md")).toBe("/catalog/docs/what%3F/next/");
    expect(rewrite("./next.md", "100%/intro.md")).toBe("/catalog/docs/100%25/next/");
    expect(rewrite("../up.md", "a b/c d/intro.md")).toBe("/catalog/docs/a%20b/up/");
  });

  it("leaves a link joinBase refuses unchanged instead of throwing", () => {
    expect(rewrite("/a/..//x")).toBe("/a/..//x");
    expect(rewrite("/docs/%2e%2e/x/../..//y#z")).toBe("/docs/%2e%2e/x/../..//y#z");
  });

  it("leaves non-page files, external, protocol-relative, mailto, #-only and empty hrefs alone", () => {
    for (const href of [
      "./diagram.svg",
      "../files/archive.tar.gz",
      "https://example.org/a.md",
      "HTTP://example.org/",
      "//cdn.example.org/a.md",
      "mailto:docs@example.org",
      "#section",
      "",
    ]) {
      expect(rewrite(href), href).toBe(href);
    }
  });
});

describe("docsLinksPlugin", () => {
  const docsDir = join("/work", "site", "docs");
  const render = async (markdown: string, file: string | undefined, features = {}): Promise<string> => {
    const processor = await createSatteriMarkdownProcessor({
      hastPlugins: [docsLinksPlugin(docsDir, "/catalog/")],
      features,
    });
    const fileURL = file === undefined ? undefined : pathToFileURL(file);
    return (await processor.render(markdown, fileURL === undefined ? undefined : { fileURL })).code;
  };

  it("rewrites the links of a document inside the docs directory", async () => {
    const html = await render("[a](./b.md#c) [d](/docs/e/) [f](https://example.org/)", join(docsDir, "ops", "a.md"));
    expect(html).toContain('href="/catalog/docs/ops/b/#c"');
    expect(html).toContain('href="/catalog/docs/e/"');
    expect(html).toContain('href="https://example.org/"');
  });

  it("leaves an anchor without an href untouched", async () => {
    // Astro leaves raw HTML as text; `rawHtml` parses it so the visitor sees a bare `<a>`.
    const html = await render('<a name="top">x</a>', join(docsDir, "a.md"), { rawHtml: true });
    expect(html).toContain('<a name="top">x</a>');
  });

  it("does not rewrite a raw HTML anchor in Astro's own configuration", async () => {
    expect(await render('<a href="./b.md">x</a>', join(docsDir, "a.md"))).toContain('href="./b.md"');
  });

  it("sits out a document outside the docs directory and one with no file", async () => {
    expect(await render("[a](./b.md)", join("/work", "site", "other", "a.md"))).toContain('href="./b.md"');
    expect(await render("[a](./b.md)", undefined)).toContain('href="./b.md"');
  });
});
