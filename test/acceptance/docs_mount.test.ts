/**
 * C-020 / S-010: the consumer `docs` mount, asserted on the built `root` site
 * (docs fixture: `index.md`, `guide/{index,getting-started,install}.md`,
 * `reference/cli.md` and one `reference/notes.mdx`). An `index.md` is served at
 * its directory route — `/docs/` and `/docs/guide/`, never `/docs/index/` — as
 * VitePress did. Page paths, heading ids from the Sätteri
 * processor (incl. the generated id of the `{#custom-anchor}` heading), sidebar
 * order, `docsNav` header links, VitePress-only syntax shown as text, and the
 * `.mdx` file never mounted.
 *
 * Ports the docs-mount rows of the old `site_header_real_build` suite:
 * nested docs pages render under /docs/** and the header carries the docsNav
 * links. "No `docs` set, no /docs/** output" lives in `layout.test.ts` (the
 * `catalog` site has no docs).
 *
 * Links in the docs are rewritten to the built routes (`docs_markdown.ts`);
 * asserted at base `/` and at `/catalog/`.
 *
 * The parity rows of the theme-port ledger (D-108 to D-125, D-175) are asserted
 * here on the same build: outline, drawer, frame, fences, anchors, assets.
 *
 * Needs the `root` and `rootbase` sites; `ACCEPT_CONFIG=root,rootbase` is enough.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { symlink } from "node:fs/promises";
import { createProject, listTree, readHtml, runBuild, site, type Project } from "./helpers.js";

/** Route (below `docs/`) of every mounted page; `""` is the docs root. */
const PAGES = [
  "",
  "guide",
  "guide/getting-started",
  "guide/install",
  "guide/untitled",
  "reference/cli",
  "reference/release notes",
] as const;

/** The text of every stylesheet a built page links, joined: the page's own and the theme's. */
async function pageCss(siteDir: string, doc: Document): Promise<string> {
  const hrefs = [...doc.querySelectorAll("link[rel='stylesheet']")].map((link) => link.getAttribute("href")!);
  return (await Promise.all(hrefs.map((href) => readFile(join(siteDir, href), "utf8")))).join("\n");
}

describe("C-020 docs mount on the root site", () => {
  it("renders one page per .md file at docs/<slug>/ and none for the .mdx file", async () => {
    const files = await listTree(site("root"));
    const docsPages = files.filter((path) => path.startsWith("docs/") && path.endsWith("index.html")).sort();
    expect(docsPages).toEqual(PAGES.map((slug) => (slug === "" ? "docs/index.html" : `docs/${slug}/index.html`)).sort());
    expect(files.some((path) => path.includes("reference/notes"))).toBe(false);
  });

  it("serves index.md at its directory, never under an /index/ route", async () => {
    const files = await listTree(site("root"));
    expect(files.some((path) => path.startsWith("docs/index/") || path.startsWith("docs/guide/index/"))).toBe(false);

    const root = await readHtml(site("root"), "/docs/");
    expect(root.querySelector("main .ocx-prose h1")?.textContent).toBe("Documentation");
    expect(root.title).toContain("Documentation");
    const guide = await readHtml(site("root"), "/docs/guide/");
    expect(guide.querySelector("main .ocx-prose h1")?.textContent).toBe("Guide overview");
    expect(guide.title).toContain("Guide overview");
  });

  it("renders the body inside .ocx-prose with the title as the document title", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const prose = document.querySelector("main .ocx-prose");
    expect(prose?.querySelector("h1")?.textContent).toBe("Getting started");
    expect(document.title).toContain("Getting started");
  });

  it("gives headings the Sätteri ids, the {#custom-anchor} heading included", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const ids = [...document.querySelectorAll(".ocx-prose h1, .ocx-prose h2")].map((h) => `${h.tagName}#${h.id}`);
    expect(ids).toEqual([
      "H1#getting-started",
      "H2#install-the-cli",
      // Sätteri does not read `{#custom-anchor}`: the suffix is text and part of the generated id.
      "H2#pull-a-package-custom-anchor",
    ]);
    const cli = await readHtml(site("root"), "/docs/reference/cli/");
    expect([...cli.querySelectorAll(".ocx-prose h2")].map((h) => h.id)).toEqual(["options", "exit-codes"]);
  });

  it("shows VitePress-only syntax as text instead of interpreting it", async () => {
    const getting = await readHtml(site("root"), "/docs/guide/getting-started/");
    expect(getting.querySelector("#pull-a-package-custom-anchor")?.textContent).toBe("Pull a package {#custom-anchor}");

    const install = await readHtml(site("root"), "/docs/guide/install/");
    const prose = install.querySelector(".ocx-prose");
    expect(prose?.textContent).toContain("::: details Why a store?");
    expect(prose?.querySelector("details")).toBeNull();
    // `<span v-pre>` is raw HTML the processor passes through: no Vue runs, so the span is an
    // inert element and its braces are literal text.
    expect(prose?.textContent).toContain("A literal {{ not-interpolated }} stays inert text.");
    expect(prose?.querySelector("span[v-pre]")?.textContent).toBe("{{ not-interpolated }}");
  });

  it("lists the pages in the sidebar by directory, then order, and marks the current page", async () => {
    const document = await readHtml(site("root"), "/docs/guide/install/");
    const nav = document.querySelector("nav[aria-label='Documentation']");
    const groups = [...(nav?.querySelectorAll("section") ?? [])].map((section) => ({
      label: section.querySelector("h2")?.textContent?.trim(),
      labelHref: section.querySelector("h2 a")?.getAttribute("href"),
      links: [...section.querySelectorAll("li a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
    }));
    expect(groups).toEqual([
      { label: undefined, labelHref: undefined, links: [["Documentation", "/docs/"]] },
      {
        label: "guide",
        // D-119: the group heading links to the section index page.
        labelHref: "/docs/guide/",
        links: [
          ["Guide overview", "/docs/guide/"],
          ["Getting started", "/docs/guide/getting-started/"],
          ["Installing packages", "/docs/guide/install/"],
          ["The untitled page with a link", "/docs/guide/untitled/"],
        ],
      },
      {
        label: "reference",
        labelHref: undefined,
        links: [
          ["CLI reference", "/docs/reference/cli/"],
          ["Release notes", "/docs/reference/release%20notes/"],
        ],
      },
    ]);
    expect(nav?.querySelector("[aria-current='page']")?.getAttribute("href")).toBe("/docs/guide/install/");
    expect(nav?.querySelectorAll("[aria-current]").length).toBe(1);
  });

  it("marks an index page current in its own sidebar entry", async () => {
    for (const [route, href] of [["/docs/", "/docs/"], ["/docs/guide/", "/docs/guide/"]] as const) {
      const nav = (await readHtml(site("root"), route)).querySelector("nav[aria-label='Documentation']");
      expect([...(nav?.querySelectorAll("[aria-current='page']") ?? [])].map((a) => a.getAttribute("href"))).toEqual([href]);
    }
  });

  it("carries the docsNav links in the header of a docs page", async () => {
    const document = await readHtml(site("root"), "/docs/reference/cli/");
    const header = document.querySelector("header")!;
    const links = new Map([...header.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]));
    expect(links.get("Guide")).toBe("/docs/guide/getting-started/");
    expect(links.get("CLI")).toBe("/docs/reference/cli/");
  });

  it("does not copy the docs source markdown into the output", async () => {
    const files = await listTree(site("root"));
    expect(files.some((path) => /^docs\/.*\.mdx?$/.test(path) || path.endsWith("cli.md") || path.endsWith(".mdx"))).toBe(false);
  });
});

describe("docs links are rewritten to the built routes", () => {
  const hrefs = async (siteName: "root" | "rootbase", route: string): Promise<string[]> =>
    [...(await readHtml(site(siteName), route)).querySelectorAll(".ocx-prose a:not(.header-anchor)")].map(
      (a) => a.getAttribute("href")!,
    );

  it.each([
    ["root", "/"],
    ["rootbase", "/catalog/"],
  ] as const)("resolves each link form of a directory-route page at base %s", async (siteName, base) => {
    expect(await hrefs(siteName, "/docs/guide/getting-started/")).toEqual([
      `${base}docs/guide/install/#pinning-versions`,
      `${base}docs/guide/install/`,
      `${base}docs/reference/cli/?tab=flags#options`,
      `${base}docs/guide/`,
      `${base}docs/`,
      `${base}docs/guide/`,
      "https://example.org/spec",
      "mailto:docs@example.org",
      "#install-the-cli",
      `${base}docs/guide/diagram.svg`,
      `${base}docs/guide/sample.txt`,
    ]);
  });

  it("resolves a link of the docs root page against its file", async () => {
    expect(await hrefs("rootbase", "/docs/")).toEqual(["/catalog/docs/guide/getting-started/"]);
  });
});

describe("docs mount: content pipeline (D-116 D-117 D-120 D-121 D-122 D-123 D-175)", () => {
  it("D-116 titles a page without frontmatter title from its first H1, the sidebar label and og:title too", async () => {
    const document = await readHtml(site("root"), "/docs/guide/untitled/");
    expect(document.title).toBe("The untitled page with a link | Site Fixture Catalog");
    expect(document.querySelector("meta[property='og:title']")?.getAttribute("content")).toContain("The untitled page with a link");
    expect(document.querySelector("nav[aria-label='Documentation'] [aria-current='page']")?.textContent?.trim()).toBe(
      "The untitled page with a link",
    );
  });

  it("D-120 makes a frontmatter description the page's meta description, og:description included", async () => {
    const cli = await readHtml(site("root"), "/docs/reference/cli/");
    expect(cli.querySelector("meta[name='description']")?.getAttribute("content")).toBe("Every ocx command and its flags.");
    expect(cli.querySelector("meta[property='og:description']")?.getAttribute("content")).toBe("Every ocx command and its flags.");
    const guide = await readHtml(site("root"), "/docs/guide/");
    expect(guide.querySelector("meta[name='description']")?.getAttribute("content")).toBe(
      "A committed fixture site for the ocx-catalog build tests.",
    );
  });

  it("D-121 mounts a page whose file name carries a space, linked with the name percent-encoded", async () => {
    const notes = await readHtml(site("root"), "/docs/reference/release%20notes/".replace("%20", " "));
    expect(notes.title).toContain("Release notes");
    const cli = await readHtml(site("root"), "/docs/reference/cli/");
    expect(cli.querySelector(".ocx-prose a[href$='release%20notes/']")?.getAttribute("href")).toBe("/docs/reference/release%20notes/");
  });

  it("D-117 carries the docs tree's images and downloads to the same path under docs/, and points a relative image at them", async () => {
    const files = await listTree(site("root"));
    expect(files).toContain("docs/guide/diagram.svg");
    expect(files).toContain("docs/guide/sample.txt");
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const src = document.querySelector<HTMLImageElement>(".ocx-prose img[alt='A grey square']")?.getAttribute("src");
    expect(src).toBe("/docs/guide/diagram.svg");
    expect(files).toContain(src!.slice(1));
  });

  it("D-117 serves the carried files under base too", async () => {
    const files = await listTree(site("rootbase"));
    expect(files).toContain("docs/guide/sample.txt");
    const document = await readHtml(site("rootbase"), "/docs/guide/getting-started/");
    expect(document.querySelector(".ocx-prose img[alt='A grey square']")?.getAttribute("src")).toBe("/catalog/docs/guide/diagram.svg");
  });

  it("D-122 opens external links in a new tab with rel=noreferrer; internal, mailto and #fragment links stay as they are", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const spec = document.querySelector<HTMLAnchorElement>(".ocx-prose a[href='https://example.org/spec']")!;
    expect(spec.getAttribute("target")).toBe("_blank");
    expect(spec.getAttribute("rel")).toBe("noreferrer");
    for (const href of ["mailto:docs@example.org", "#install-the-cli", "/docs/guide/install/"]) {
      const link = document.querySelector(`.ocx-prose a[href^='${href}']`)!;
      expect(link.hasAttribute("target"), href).toBe(false);
      expect(link.hasAttribute("rel"), href).toBe(false);
    }
  });

  it("D-123 gives every heading a permalink anchor to its own id, with an accessible name", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const headings = [...document.querySelectorAll(".ocx-prose :is(h1, h2, h3, h4, h5, h6)")];
    expect(headings.map((h) => h.tagName)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6", "H2"]);
    for (const heading of headings) {
      const anchor = heading.querySelector("a.header-anchor");
      expect(anchor?.getAttribute("href"), heading.id).toBe(`#${heading.id}`);
      expect(anchor?.getAttribute("aria-label")).toMatch(/^Permalink to “.+”$/);
      expect(anchor?.textContent).toBe("");
    }
  });

  it("D-175 highlights a fence with the theme's code colours as CSS variables, never a colour literal", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const pre = document.querySelector<HTMLElement>(".ocx-prose pre")!;
    expect(pre.getAttribute("data-language")).toBe("sh");
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("style")).toContain("background-color:var(--ocx-color-code-bg)");
    const spans = [...pre.querySelectorAll("code span[style]")].map((span) => span.getAttribute("style")!);
    expect(spans.length).toBeGreaterThan(1);
    for (const style of [...spans, pre.getAttribute("style")!]) {
      expect(style).toMatch(/var\(--ocx-color-code-[a-z]+\)/);
      expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
    expect(pre.textContent).toBe("ocx --version");
  });

  it("D-175 leaves VitePress-only syntax unsupported: containers and {#id} stay text", async () => {
    const install = await readHtml(site("root"), "/docs/guide/install/");
    expect(install.querySelector(".ocx-prose")?.textContent).toContain("::: details Why a store?");
    const getting = await readHtml(site("root"), "/docs/guide/getting-started/");
    expect(getting.querySelector("#pull-a-package-custom-anchor")?.textContent).toContain("{#custom-anchor}");
  });
});

describe("docs mount: frame, outline, drawer (D-108 D-109 D-110 D-111 D-113 D-114 D-115 D-118 D-124)", () => {
  it("D-108 lists the page's h2 and h3 headings as the 'On this page' outline, two-tier, as a labelled nav", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const nav = document.querySelector(".docs__outline nav")!;
    const name = document.getElementById(nav.getAttribute("aria-labelledby")!)?.textContent;
    expect(name).toBe("On this page");
    expect([...nav.querySelectorAll("li")].map((li) => [li.getAttribute("data-depth"), li.querySelector("a")!.getAttribute("href")])).toEqual([
      ["2", "#install-the-cli"],
      ["3", "#verify-the-install"],
      ["2", "#pull-a-package-custom-anchor"],
    ]);
    expect(nav.textContent).not.toContain("Getting started");
    expect(nav.textContent).not.toContain("Fine print");
  });

  it("D-108 renders no outline, on desktop or in the drawer, for a page with no h2 or h3", async () => {
    const document = await readHtml(site("root"), "/docs/guide/");
    expect(document.querySelector(".docs__outline")).toBeNull();
    expect(document.querySelector(".docs nav.ocx-toc")).toBeNull();
  });

  it("D-108 shows the outline column from 75rem, sticky under the header, 180px wide", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toContain("--docs-outline:180px");
    expect(css).toMatch(/@media \(width>=75rem\)\{[^@]*\.docs__outline\[[^\]]*\]\{[^}]*display:block[^}]*position:sticky/);
  });

  it("D-109 folds the sidebar and outline into a modal 'Contents' drawer, opened by a labelled button", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const drawer = document.querySelector(".docs__drawer")!;
    const trigger = drawer.querySelector("button[data-part='trigger']")!;
    expect(trigger.textContent?.trim()).toBe("Contents");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const content = drawer.querySelector("[role='dialog']")!;
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(content.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(content.getAttribute("aria-labelledby")!)?.textContent?.trim()).toBe("Docs navigation");
    expect(drawer.querySelector("button[data-part='close-trigger']")?.getAttribute("aria-label")).toBe("Close");
    expect(drawer.querySelector("[data-part='backdrop']")).not.toBeNull();
    expect(drawer.querySelectorAll("nav[aria-label='Documentation'] a").length).toBe(
      document.querySelectorAll(".docs__sidebar nav a").length,
    );
    expect(drawer.querySelector("nav.ocx-toc")).not.toBeNull();
  });

  it("D-109 shows the drawer trigger below 40rem only, the sidebar from 40rem", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toMatch(/\.docs__drawer\[[^\]]*\]\{display:block\}/);
    expect(css).toMatch(/@media \(width>=40rem\)\{[^@]*\.docs__drawer\[[^\]]*\]\{display:none\}/);
    expect(css).toMatch(/\.docs__sidebar\[[^\]]*\],\.docs__outline\[[^\]]*\]\{display:none\}/);
  });

  it("D-109 ships the script that closes the drawer when a link in it is followed, under the page's CSP", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    // Astro inlines a script this small and hashes it into the page's CSP.
    const script = [...document.querySelectorAll("script[type='module']:not([src])")].find((el) =>
      el.textContent?.includes("close-trigger"),
    );
    expect(script).toBeDefined();
    const hash = createHash("sha256").update(script!.textContent!).digest("base64");
    expect(document.querySelector("meta[http-equiv='content-security-policy']")?.getAttribute("content")).toContain(`'sha256-${hash}'`);
  });

  it("D-114 points the skip link at the prose column, so a keyboard user skips the sidebar's links", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const skip = document.querySelector("a.ocx-skip")!;
    expect(skip.getAttribute("href")).toBe("#docs-content");
    const target = document.getElementById("docs-content")!;
    expect(target.tagName).toBe("ARTICLE");
    expect(target.getAttribute("tabindex")).toBe("-1");
    // Tab order is the visual order: the sidebar precedes the prose, the outline and drawer follow it.
    const main = document.querySelector("main#main")!;
    const before = target.compareDocumentPosition(main.querySelector(".docs__sidebar")!);
    expect(before & 2, "sidebar precedes the prose").toBe(2); // DOCUMENT_POSITION_PRECEDING
    for (const after of [".docs__outline", ".docs__drawer"]) {
      expect(target.compareDocumentPosition(main.querySelector(after)!) & 4, after).toBe(4);
    }
  });

  it("D-110 D-118 sets the frame at 250px sidebar | 720px prose | 180px outline, the sidebar sticky with a right border", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(document.querySelector("main#main")?.getAttribute("data-width")).toBe("wide");
    for (const token of ["--docs-sidebar:250px", "--docs-prose:720px", "--docs-outline:180px"]) expect(css).toContain(token);
    expect(css).toMatch(/\.docs__sidebar\[[^\]]*\]\{border-inline-end:var\(--ocx-border-width\) solid var\(--ocx-color-border\)/);
    expect(css).toMatch(/\.docs__sidebar\[[^\]]*\]>nav\{[^}]*position:sticky/);
    expect(css).toMatch(/grid-template-areas:"sidebar content outline"/);
  });

  it("D-111 pads docs fences and scrolls a long line inside the box", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toMatch(/\.docs__content\[[^\]]*\] pre\{padding:var\(--ocx-space-5\);overflow-x:auto\}/);
  });

  it("D-113 clears the sticky header on an anchor jump", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toMatch(/html\{scroll-padding-top:calc\(var\(--ocx-header-height\) \+ var\(--ocx-space-4\)\)\}/);
  });

  it("D-115 marks the current sidebar page with a heavier weight as well as colour", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toMatch(/\.docs-sidebar__link\[[^\]]*\]\[aria-current=page\]\{[^}]*font-weight:var\(--ocx-font-weight-semibold\)/);
  });

  it("D-124 styles h5 and h6 like h4 instead of the browser default", async () => {
    const document = await readHtml(site("root"), "/docs/guide/getting-started/");
    const css = await pageCss(site("root"), document);
    expect(css).toMatch(/\.docs__content\[[^\]]*\] :is\(h5,h6\)\{[^}]*font-size:var\(--ocx-prose-h4\)/);
  });
});

describe("docs mount: dead links (D-125)", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  const build = async (page: string, extra: Record<string, string> = {}, config: Record<string, unknown> = {}) => {
    const project = await createProject({ docs: "./docs", ...config }, { "docs/start.md": page, "docs/other.md": "# Other\n", ...extra });
    projects.push(project);
    return runBuild(project.config, project.out);
  };

  it("D-125 fails the build on a link to a docs page that does not exist, naming the file and the link", async () => {
    const result = await build("# Start\n\n[gone](./missing.md)\n");
    expect(result.code, result.stderr).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('docs: start.md links to "./missing.md", which is not a page in the docs directory');
  });

  it("D-125 fails the build on a link to a file that is not in the docs directory", async () => {
    const result = await build("# Start\n\n[gone](./files/archive.zip)\n");
    expect(result.code, result.stderr).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('links to "./files/archive.zip", which is not a file in the docs directory');
  });

  it("D-125 builds when every link resolves, to a page, a nested page, a file or a catalog route", async () => {
    const result = await build("# Start\n\n[a](./other.md) [b](./sub/) [c](./files/archive.zip) [d](/p/acme/tool/) [e](#start)\n", {
      "docs/sub/index.md": "# Sub\n",
      "docs/files/archive.zip": "zip",
    });
    expect(result.code, result.stderr).toBe(0);
  });

  it("D-125 fails the build on a link to a dot-file or a .mdx source, which are never served", async () => {
    for (const link of ["./.env", "./notes.mdx"]) {
      const result = await build(`# Start\n\n[x](${link})\n`, { "docs/.env": "SECRET=1", "docs/notes.mdx": "# n\n" });
      expect(result.code, link).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(`links to "${link}"`);
    }
  });

  it("D-125 passes a root-relative /docs/ link to a file the consumer's publicDir serves, and rewrites a .md spelling", async () => {
    const result = await build("# Start\n\n[r](/docs/report.pdf) [o](/docs/other.md)\n", { "public/docs/report.pdf": "pdf" }, { publicDir: "./public" });
    expect(result.code, result.stderr).toBe(0);
    const document = await readHtml(join(projects[0]!.out), "/docs/start/");
    const hrefs = [...document.querySelectorAll(".ocx-prose a:not(.header-anchor)")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/docs/report.pdf", "/docs/other/"]);
  });

  it("D-117 refuses a symlink in the docs tree with exit 65, naming it, and writes no output", async () => {
    const project = await createProject({ docs: "./docs" }, { "docs/start.md": "# Start\n", "secret.txt": "runner secret" });
    projects.push(project);
    await symlink(join(project.dir, "secret.txt"), join(project.dir, "docs", "leak.txt"));
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("docs: leak.txt is a symbolic link");
    expect(await listTree(project.root).then((files) => files.some((f) => f.startsWith("out/")))).toBe(false);
  });

  it("D-117 refuses an asset that would replace a page, with exit 65", async () => {
    const result = await build("# Start\n", { "docs/other/index.html": "<p>hijack</p>" });
    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("docs: other/index.html would replace the page /docs/other/ in the built site");
  });

  it("D-121 refuses two pages that differ only in case or normalisation, with exit 65", async () => {
    const result = await build("# Start\n", { "docs/Other.md": "# Again\n" });
    expect(result.code, result.stderr).toBe(65);
    expect(result.stderr).toContain("both map to");
  });
});
