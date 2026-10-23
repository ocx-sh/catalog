/**
 * The docs-mount link rewriter: `rewriteDocsHref` as a pure function, and the
 * hast plugin through the real Sätteri processor Astro runs it in.
 */
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { docsMarkdownPlugin, docsTargetExists, resolveDocsLink, rewriteDocsHref } from "../../src/site/docs_markdown.js";

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

  it("D-117 resolves a link to a non-page file against its source file, to the path the file is served at", () => {
    expect(rewrite("./diagram.svg")).toBe("/catalog/docs/ops/diagram.svg");
    expect(rewrite("../files/archive.tar.gz?dl=1#x")).toBe("/catalog/docs/files/archive.tar.gz?dl=1#x");
    expect(rewrite("/docs/img/a.png")).toBe("/catalog/docs/img/a.png");
  });

  it("leaves external, protocol-relative, mailto, #-only and empty hrefs alone", () => {
    for (const href of [
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

describe("resolveDocsLink", () => {
  const resolve = (href: string, file = "ops/run.md") => resolveDocsLink(href, file, "/");

  it("names the docs target a link checks: a page by route, a file by path", () => {
    expect(resolve("./m1.md").target).toEqual({ kind: "page", path: "ops/m1" });
    expect(resolve("./m1").target).toEqual({ kind: "page", path: "ops/m1" });
    expect(resolve("./index.md").target).toEqual({ kind: "page", path: "ops" });
    expect(resolve("../index.md").target).toEqual({ kind: "page", path: "" });
    expect(resolve("..").target).toEqual({ kind: "page", path: "" });
    expect(resolve("./pic.png#x").target).toEqual({ kind: "file", path: "ops/pic.png" });
    expect(resolve("./my%20notes.md").target).toEqual({ kind: "page", path: "ops/my notes" });
  });

  it("D-125 rewrites a root-relative /docs/ link like a relative one: a .md spelling gets its route", () => {
    expect(resolve("/docs/guide/install.md#x")).toEqual({ href: "/docs/guide/install/#x", target: { kind: "page", path: "guide/install" } });
    expect(resolve("/docs/guide/index.md").href).toBe("/docs/guide/");
    expect(resolve("/docs/guide").href).toBe("/docs/guide/");
    expect(resolve("/docs/files/a.zip").href).toBe("/docs/files/a.zip");
    expect(resolve("/docs/index.md").href).toBe("/docs/");
  });

  it("checks a root-relative link only below /docs/", () => {
    expect(resolve("/docs/guide/").target).toEqual({ kind: "page", path: "guide" });
    expect(resolve("/docs/").target).toEqual({ kind: "page", path: "" });
    expect(resolve("/docs/img/a.png").target).toEqual({ kind: "file", path: "img/a.png" });
    expect(resolve("/p/acme/tool/")).toEqual({ href: "/p/acme/tool/" });
    expect(resolve("/docsy/")).toEqual({ href: "/docsy/" });
  });

  it("names no target for a link left alone or one it cannot decode", () => {
    expect(resolve("https://example.org/")).toEqual({ href: "https://example.org/" });
    expect(resolve("#top")).toEqual({ href: "#top" });
    expect(resolve("./100%.md")).toEqual({ href: "./100%.md" });
  });
});

describe("docsMarkdownPlugin", () => {
  const docsDir = join("/work", "site", "docs");
  const render = async (
    markdown: string,
    file: string | undefined,
    features = {},
    dir = docsDir,
    publicDir = join("/work", "site", "public"),
  ): Promise<string> => {
    const processor = await createSatteriMarkdownProcessor({
      hastPlugins: [docsMarkdownPlugin(dir, "/catalog/", publicDir)],
      features,
    });
    const fileURL = file === undefined ? undefined : pathToFileURL(file);
    return (await processor.render(markdown, fileURL === undefined ? undefined : { fileURL })).code;
  };

  const temps: string[] = [];
  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  /**
   * A real site tree: `docs` files in `<root>/docs`, and `public` files in `<root>/public` (the built site's
   * public directory, where the copied assets and the consumer's own files sit).
   */
  const siteWith = async (docs: string[], publicFiles: string[] = []): Promise<{ dir: string; publicDir: string }> => {
    const root = await mkdtemp(join(tmpdir(), "catalog-docs-md-"));
    temps.push(root);
    for (const [base, files] of [["docs", docs], ["public", publicFiles]] as const) {
      for (const file of files) {
        await mkdir(dirname(join(root, base, file)), { recursive: true });
        await writeFile(join(root, base, file), "x");
      }
    }
    return { dir: join(root, "docs"), publicDir: join(root, "public") };
  };

  it("rewrites the links of a document inside the docs directory", async () => {
    const { dir, publicDir } = await siteWith(["ops/a.md", "ops/b.md", "e/index.md"]);
    const html = await render("[a](./b.md#c) [d](/docs/e/) [f](https://example.org/)", join(dir, "ops", "a.md"), {}, dir, publicDir);
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

  it("D-122 opens an external link in a new tab with rel=noreferrer, and no other link", async () => {
    const html = await render(
      "[a](https://example.org/) [b](HTTP://example.org/) [c](//cdn.example.org/x) [d](mailto:a@b.c) [e](#top)",
      join(docsDir, "a.md"),
    );
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(5);
    const external = anchors.filter((tag) => /href="(?:https?:|HTTP:|\/\/)/i.test(tag));
    expect(external).toHaveLength(3);
    for (const tag of external) expect(tag).toMatch(/target="_blank"[^>]*rel="noreferrer"|rel="noreferrer"[^>]*target="_blank"/);
    for (const tag of anchors.filter((t) => !external.includes(t))) expect(tag).not.toMatch(/target=|rel=/);
  });

  it("D-123 gives every heading a permalink anchor to its own id, named for it, with no text of its own", async () => {
    const html = await render("# Title\n\n## Install the CLI\n\n### Install the CLI\n\n###### Deep", join(docsDir, "a.md"));
    expect(html).toContain('<h1 id="title">Title<a class="header-anchor" href="#title" aria-label="Permalink to “Title”"></a></h1>');
    expect(html).toContain('<h2 id="install-the-cli">Install the CLI<a class="header-anchor" href="#install-the-cli"');
    // A repeated heading takes the next id (github-slugger), and its anchor follows.
    expect(html).toContain('<h3 id="install-the-cli-1">Install the CLI<a class="header-anchor" href="#install-the-cli-1"');
    expect(html).toContain('<h6 id="deep">Deep<a class="header-anchor" href="#deep"');
  });

  it("D-123 keeps an id the author already set and anchors to it", async () => {
    const html = await render('<h2 id="mine">Own id</h2>', join(docsDir, "a.md"), { rawHtml: true });
    expect(html).toContain('<h2 id="mine">Own id<a class="header-anchor" href="#mine"');
  });

  it("D-117 resolves an image like a link: against its file, under base, past Astro's image pipeline", async () => {
    const { dir, publicDir } = await siteWith(["guide/a.md"], ["docs/guide/pic.png"]);
    const html = await render(
      "![a](./pic.png) ![b](/img/b.png) ![c](//cdn.example.org/c.png) ![d](https://example.org/d.png)",
      join(dir, "guide", "a.md"),
      {},
      dir,
      publicDir,
    );
    expect(html).toContain('src="/catalog/docs/guide/pic.png"');
    expect(html).toContain('src="/catalog/img/b.png"');
    expect(html).toContain('src="//cdn.example.org/c.png"');
    expect(html).toContain('src="https://example.org/d.png"');
    expect(html).not.toContain("__ASTRO_IMAGE_");
  });

  it("D-125 fails the render on a link to a docs page that does not exist, naming the file and the link", async () => {
    const { dir, publicDir } = await siteWith(["a.md", "guide/index.md", "b/index.md"], ["docs/guide/pic.png"]);
    const ok = "[p](./guide/) [q](./guide/index.md) [r](./b) [s](./guide/pic.png) [t](/docs/guide/) [u](/p/acme/tool/) [v](https://x.example/dead.md)";
    expect(await render(ok, join(dir, "a.md"), {}, dir, publicDir)).toContain('href="/catalog/docs/guide/pic.png"');
    const dead = (markdown: string, file = "a.md") => render(markdown, join(dir, file), {}, dir, publicDir);
    await expect(dead("[x](./missing.md)")).rejects.toThrow('docs: a.md links to "./missing.md", which is not a page in the docs directory');
    await expect(dead("[x](./guide/gone.png)")).rejects.toThrow(/not a file in the docs directory/);
    await expect(dead("![x](./guide/gone.png)")).rejects.toThrow(/links to ".\/guide\/gone.png"/);
    await expect(dead("[x](/docs/nowhere/)", "guide/index.md")).rejects.toThrow(/guide\/index\.md links to "\/docs\/nowhere\/"/);
  });

  it("D-125 holds a link to what the copy leaves behind to be dead: a dot-file, a .mdx or .md source as a file, a dot-directory page", async () => {
    // `.env`, `notes.mdx` and `.draft/x.md` exist in the docs directory but `copyDocsAssets` carries none of them.
    const { dir, publicDir } = await siteWith(["a.md", ".env", "notes.mdx", ".draft/x.md", "dir/.hidden.png"]);
    const dead = (markdown: string) => render(markdown, join(dir, "a.md"), {}, dir, publicDir);
    await expect(dead("[x](./.env)")).rejects.toThrow(/not a file/);
    await expect(dead("[x](./dir/.hidden.png)")).rejects.toThrow(/not a file/);
    await expect(dead("[x](./notes.mdx)")).rejects.toThrow(/not a file/);
    await expect(dead("[x](./.draft/x.md)")).rejects.toThrow(/not a page/);
  });

  it("D-125 passes a root-relative /docs/ link to a file the consumer's publicDir serves there", async () => {
    const { dir, publicDir } = await siteWith(["a.md"], ["docs/report.pdf", "docs/dl/.well-known"]);
    const html = await render("[r](/docs/report.pdf) [w](/docs/dl/.well-known)", join(dir, "a.md"), {}, dir, publicDir);
    expect(html).toContain('href="/catalog/docs/report.pdf"');
    expect(html).toContain('href="/catalog/docs/dl/.well-known"');
  });

  it("D-125 rewrites a root-relative /docs/ link to a .md source to its route, and checks the page", async () => {
    const { dir, publicDir } = await siteWith(["a.md", "guide/install.md"]);
    expect(await render("[x](/docs/guide/install.md#pin)", join(dir, "a.md"), {}, dir, publicDir)).toContain(
      'href="/catalog/docs/guide/install/#pin"',
    );
    await expect(render("[x](/docs/guide/gone.md)", join(dir, "a.md"), {}, dir, publicDir)).rejects.toThrow(/not a page/);
  });

  it("sits out a document outside the docs directory and one with no file", async () => {
    expect(await render("[a](./b.md)", join("/work", "site", "other", "a.md"))).toContain('href="./b.md"');
    expect(await render("[a](./b.md)", undefined)).toContain('href="./b.md"');
  });
});

describe("docsTargetExists", () => {
  const temps: string[] = [];
  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const tree = async (): Promise<{ docs: string; publicDir: string; root: string }> => {
    const root = await mkdtemp(join(tmpdir(), "catalog-docs-exists-"));
    temps.push(root);
    for (const file of ["docs/index.md", "docs/one.md", "docs/two/index.md", "docs/.hid/p.md", "public/docs/img/a.png", "secret.md", "secret.txt"]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), "x");
    }
    await mkdir(join(root, "docs", "adir.md"));
    return { docs: join(root, "docs"), publicDir: join(root, "public"), root };
  };

  it("finds a page as <path>.md or <path>/index.md, the root page as index.md, and a file under <publicDir>/docs", async () => {
    const { docs, publicDir } = await tree();
    const exists = (kind: "page" | "file", path: string) => docsTargetExists(docs, publicDir, { kind, path });
    expect(exists("page", "")).toBe(true);
    expect(exists("page", "one")).toBe(true);
    expect(exists("page", "two")).toBe(true);
    expect(exists("page", "three")).toBe(false);
    expect(exists("page", "adir")).toBe(false); // a directory is not a page
    expect(exists("file", "img/a.png")).toBe(true);
    expect(exists("file", "img/b.png")).toBe(false);
    expect(exists("file", "img")).toBe(false); // a directory is not a file
  });

  it("D-125 finds no page under a dot-directory, which scanDocs skips", async () => {
    const { docs, publicDir } = await tree();
    expect(docsTargetExists(docs, publicDir, { kind: "page", path: ".hid/p" })).toBe(false);
  });

  it("D-125 never probes outside its roots: a decoded .. , a backslash or a NUL is a miss, not a lookup", async () => {
    const { docs, publicDir } = await tree();
    for (const path of ["../secret", "a/../../secret", "..", "a\\..\\secret", "x\0y"]) {
      expect(docsTargetExists(docs, publicDir, { kind: "page", path }), path).toBe(false);
    }
    for (const path of ["../secret.txt", "../../secret.txt", "img/../../../secret.txt", ".."]) {
      expect(docsTargetExists(docs, publicDir, { kind: "file", path }), path).toBe(false);
    }
  });
});
