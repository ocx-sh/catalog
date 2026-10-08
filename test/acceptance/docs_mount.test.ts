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
 * Needs the `root` and `rootbase` sites; `ACCEPT_CONFIG=root,rootbase` is enough.
 */
import { describe, expect, it } from "vitest";
import { listTree, readHtml, site } from "./helpers.js";

/** Route (below `docs/`) of every mounted page; `""` is the docs root. */
const PAGES = ["", "guide", "guide/getting-started", "guide/install", "reference/cli"] as const;

describe("C-020 docs mount on the root site", () => {
  it("renders one page per .md file at docs/<slug>/ and none for the .mdx file", async () => {
    const files = await listTree(site("root"));
    const docsPages = files.filter((path) => path.startsWith("docs/")).sort();
    expect(docsPages).toEqual(PAGES.map((slug) => (slug === "" ? "docs/index.html" : `docs/${slug}/index.html`)).sort());
    expect(files.some((path) => path.includes("notes"))).toBe(false);
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
      label: section.querySelector("h2")?.textContent,
      links: [...section.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
    }));
    expect(groups).toEqual([
      { label: undefined, links: [["Documentation", "/docs/"]] },
      {
        label: "guide",
        links: [
          ["Guide overview", "/docs/guide/"],
          ["Getting started", "/docs/guide/getting-started/"],
          ["Installing packages", "/docs/guide/install/"],
        ],
      },
      { label: "reference", links: [["CLI reference", "/docs/reference/cli/"]] },
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
    [...(await readHtml(site(siteName), route)).querySelectorAll(".ocx-prose a")].map((a) => a.getAttribute("href")!);

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
      "./diagram.svg",
    ]);
  });

  it("resolves a link of the docs root page against its file", async () => {
    expect(await hrefs("rootbase", "/docs/")).toEqual(["/catalog/docs/guide/getting-started/"]);
  });
});
