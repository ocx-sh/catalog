/**
 * The package detail page on built sites (T.4; C-009, C-013, C-014, C-015,
 * C-037, C-041, C-042, S-007, S-020): every listed field is in the HTML with
 * no script run (the pages are parsed by jsdom with scripts off), hostile
 * README and hostile metadata come out inert, owners link per source or fall
 * back to plain text, a missing README is a pane and not a failure, and the
 * island root carries the DOM contract of `client/versions.ts`.
 *
 * Needs the `root` and `catalog` sites (`ACCEPT_CONFIG=root,catalog`). The
 * fixture packages are described in `test/fixtures/site/README` terms: index-a
 * is the root source (bare routes, wire tree at `/p`), index-b the `index-b`
 * label (routes under `index-b/`, wire tree at `/index/index-b/p`).
 *
 * Ported 0.5.x wiring rows (the old files are deleted by P-purge):
 *  - deprecation_banner_href  -> "deprecated" + "unsafe supersededBy" below, and test/site/model/detail.test.ts
 *  - detail_page_annotations  -> "license, source and revision" below
 *  - detail_page_wire_base    -> "wire base" below and test/site/model/detail.test.ts
 *  - owner_url                -> "owners" below and test/site/lib/ownerUrl.test.ts
 *  - readme_pane              -> "README" below and test/site/lib/readmeRender.test.ts
 *  - yanked_status            -> "yanked" below
 *  - copy_link_route          -> test/site/client/versions.test.ts ("Copy link")
 *  - layout_route_split       -> no async route components exist; the detail page is one static HTML file ("complete without JS")
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_CAS_ASSET_BYTES } from "../../src/sources/mirror.js";
import { createProject, pageScripts, readHtml, runBuild, site, siteLog, type CliResult, type Project, type SiteName } from "./helpers.js";

const BASE: Readonly<Record<"root" | "catalog", string>> = { root: "/", catalog: "/catalog/" };

interface CatalogJson {
  readonly packages: readonly { readonly name: string; readonly logoUrl: string | null }[];
}

async function catalogJson(name: SiteName): Promise<CatalogJson> {
  return JSON.parse(await readFile(join(site(name), "data/catalog/catalog.json"), "utf8")) as CatalogJson;
}

const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const rows = (document: Document): Map<string, Element> =>
  new Map([...document.querySelectorAll("[data-metadata] dd[data-field]")].map((dd) => [dd.getAttribute("data-field") ?? "", dd]));
const installCommands = (document: Document): string[] =>
  [...document.querySelectorAll("[data-install] .install-command")].map((el) => text(el));
const tags = (document: Document): string[] =>
  [...document.querySelectorAll("[data-versions-list] [data-tag]")].map((el) => el.getAttribute("data-tag") ?? "");

/** No element anywhere carries an event-handler attribute and no URL attribute holds a script scheme. */
function expectInert(document: Document, where: string): void {
  for (const el of document.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) {
      expect(attr.startsWith("on"), `${where}: <${el.localName} ${attr}>`).toBe(false);
    }
  }
  for (const el of document.querySelectorAll("[href],[src],[action],[formaction]")) {
    for (const attr of ["href", "src", "action", "formaction"]) {
      expect(el.getAttribute(attr) ?? "", `${where}: <${el.localName} ${attr}>`).not.toMatch(/^\s*(?:javascript|data|vbscript):/i);
    }
  }
}

describe.each(["root", "catalog"] as const)("detail pages on the %s site", (name) => {
  const base = BASE[name];

  it("renders every package with its h1, name, breadcrumb and the island root, from the HTML alone (C-013, S-007)", async () => {
    const dir = site(name);
    const { packages } = await catalogJson(name);
    expect(packages.length).toBeGreaterThanOrEqual(24);
    for (const pkg of packages) {
      const route = pkg.name.startsWith("index-a/") ? pkg.name.slice("index-a/".length) : pkg.name;
      const document = await readHtml(dir, `/${route}/`);
      const article = document.querySelector("article[data-package]");
      expect(article?.getAttribute("data-package"), route).toBe(pkg.name);
      expect(text(document.querySelector("article h1")), route).not.toBe("");
      expect(text(document.querySelector("article .identity-name code")), route).toBe(pkg.name);
      expect(document.querySelector("nav[aria-label='Breadcrumbs'] a")?.getAttribute("href"), route).toBe(base);
      expect(document.querySelector("[data-readme]"), route).not.toBeNull();
      expect(document.querySelector(`[data-versions][data-base='${base}']`), route).not.toBeNull();
    }
  });

  it("tools/modern: license, source and revision from the latest tag's annotations", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const fields = rows(document);
    expect(text(fields.get("license"))).toBe("MIT");
    const source = fields.get("source")?.querySelector("a");
    expect(source?.getAttribute("href")).toBe("https://github.com/ocx-contrib/tools-modern");
    expect(source?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(text(fields.get("revision"))).toMatch(/^[0-9a-f]{40}$/);
    expect(text(fields.get("tags"))).toBe("5");
  });

  it("tools/modern: the install card lists the four flavors for the bare qualified name, i.e. latest", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    expect(installCommands(document)).toEqual([
      "$ ocx add index-a/tools/modern",
      "$ ocx --global add index-a/tools/modern",
      "$ ocx package exec index-a/tools/modern",
      "$ ocx package install index-a/tools/modern",
    ]);
    expect(document.querySelectorAll("[data-install] [data-zag-root='clipboard']")).toHaveLength(4);
    expect(document.querySelector("[data-install]")?.textContent).not.toContain(":");
  });

  it("owners: the top-level ownerUrl template, else the GitHub default", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const owner = document.querySelector("[data-metadata] [data-owner]");
    expect(owner?.localName).toBe("a");
    expect(owner?.getAttribute("href")).toBe(name === "catalog" ? "https://forge.example/ocx-bot" : "https://github.com/ocx-bot");
    expect(text(owner)).toBe("@ocx-bot");
  });

  it("logos are <img> with intrinsic width and height at the mirrored CAS path; no wire SVG is inlined (C-015)", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const logo = document.querySelector<HTMLImageElement>(".identity img");
    expect(logo?.getAttribute("src")).toMatch(
      new RegExp(`^${base}p/tools/modern/o/sha256/654ab3d0743d7f788d1509052e057fce9ff6f980b9491d6635eff51a06327b55\\.svg$`),
    );
    expect(logo?.getAttribute("width")).toBe("56");
    expect(logo?.getAttribute("height")).toBe("56");
    expect(document.querySelector("svg.tile, .tile svg")).toBeNull();
  });

  it("a package without a logo gets a monogram tile, not an image", async () => {
    const { packages } = await catalogJson(name);
    const bare = packages.find((pkg) => pkg.logoUrl === null);
    expect(bare, "a fixture package without a logo").toBeDefined();
    const route = (bare?.name ?? "").replace(/^index-a\//, "");
    const document = await readHtml(site(name), `/${route}/`);
    expect(document.querySelector(".identity img")).toBeNull();
    expect(text(document.querySelector(".identity .tile-monogram"))).toMatch(/^[A-Z0-9]{1,2}$/);
  });

  it("deprecated: the banner carries the message and a superseded-by link built by packageHref", async () => {
    const document = await readHtml(site(name), "/legacy/oldtool/");
    const banner = document.querySelector("[data-banner='deprecated']");
    expect(text(banner)).toContain("Superseded by tools/modern, which covers every oldtool workflow.");
    expect(banner?.querySelector("[data-superseded-by] a")?.getAttribute("href")).toBe(`${base}tools/modern/`);
    expect(document.querySelector("[data-banner='yanked']")).toBeNull();
  });

  it("yanked: the yanked banner replaces the deprecation banner", async () => {
    const document = await readHtml(site(name), "/legacy/husk/");
    expect(text(document.querySelector("[data-banner='yanked']"))).toContain("withdrawn");
    expect(document.querySelector("[data-banner='deprecated']")).toBeNull();
  });

  it("tools/flaky: a yanked tag is not listed", async () => {
    const document = await readHtml(site(name), "/tools/flaky/");
    expect(tags(document)).not.toContain("yanked");
    expect(tags(document).length).toBeGreaterThan(0);
  });

  it("tools/many-tags: the newest 20 tags are in the HTML, the rest sit behind the island's show-all button (C-016)", async () => {
    const document = await readHtml(site(name), "/tools/many-tags/");
    expect(tags(document)).toHaveLength(20);
    expect(new Set(tags(document)).size).toBe(20);
    expect(document.querySelector<HTMLButtonElement>("[data-versions-more]")?.hidden).toBe(false);
    expect(text(document.querySelector("#versions-heading"))).toBe("Versions · 25");
    const template = document.querySelector<HTMLTemplateElement>("template[data-versions-tag]");
    expect(template?.content.querySelector("[data-tag] [data-tag-name], [data-tag][data-tag-name]")).not.toBeNull();
  });

  it("a package with few tags hides the show-all button", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    expect(document.querySelector<HTMLButtonElement>("[data-versions-more]")?.hidden).toBe(true);
  });

  it("the versions island root carries the DOM contract", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const root = document.querySelector<HTMLElement>("[data-versions]");
    expect(root?.dataset).toMatchObject({ base, ns: "tools", pkg: "modern", wireBase: "", name: "index-a/tools/modern" });
    expect(root?.querySelector("[data-zag-root='menu'] [data-versions-list]")).not.toBeNull();
    expect(root?.querySelector("[data-versions-preview][role='status'][hidden]")).not.toBeNull();
    expect(root?.querySelector("[data-versions-status][aria-live]")).not.toBeNull();
    const menuValues = [...root!.querySelectorAll("[role='menuitem']")].map((el) => el.getAttribute("data-value"));
    expect(menuValues).toEqual([
      "Copy identifier",
      "Copy tag",
      "Copy link",
      "Add to project",
      "Add globally",
      "Run without installing",
      "Install package",
    ]);
  });

  it("every package link goes through packageHref: hrefs start with the base", async () => {
    const document = await readHtml(site(name), "/legacy/oldtool/");
    for (const anchor of document.querySelectorAll("article a[href^='/']")) {
      expect(anchor.getAttribute("href")?.startsWith(base), anchor.outerHTML).toBe(true);
    }
  });
});

describe("hostile packages on the catalog site (C-014, C-041, S-020)", () => {
  const BASE_ = BASE.catalog;

  it("hostile/readme: the README renders inert, links per policy, images with a no-referrer policy", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/readme/");
    const readme = document.querySelector(".readme-content");
    expect(readme).not.toBeNull();
    expect(readme?.querySelectorAll("script, svg, math, style, iframe, object, embed, form, noscript")).toHaveLength(0);
    expect(readme?.querySelector("[style]")).toBeNull();
    expectInert(document, "hostile/readme");
    // README links: only absolute http(s) survive; `//x`, `/x`, `./x` and `javascript:` are plain text.
    const links = [...(readme?.querySelectorAll("a") ?? [])];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/ok"]);
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
    expect(text(readme)).toContain("protocol-relative");
    expect(text(readme)).toContain("root-relative");
    expect(text(readme)).toContain("dot-relative");
    const image = readme?.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://evil.example/pixel.png");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.getAttribute("loading")).toBe("lazy");
  });

  it("hostile/metadata: description, banner, tags, keywords and owner login render as inert text", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/metadata/");
    expectInert(document, "hostile/metadata");
    // The payload would have created these elements if it had been parsed as markup.
    expect(document.querySelector("article img[src='x']")).toBeNull();
    expect(document.querySelector("article img[onerror]")).toBeNull();
    expect(text(document.querySelector(".identity-description"))).toContain("</script><img src=x onerror=alert(1)> ${process.env.SECRET}");
    expect(text(document.querySelector("[data-banner-message]"))).toContain("title: pwned");
    expect(tags(document)).toEqual(expect.arrayContaining(["</script>", "<img src=x onerror=alert(1)>", "${tag}", '"quoted"', "line\n---"]));
    const keywords = [...document.querySelectorAll("[data-keyword]")];
    expect(keywords.map((a) => text(a))).toEqual(expect.arrayContaining(["</script>", "${keyword}", "<img src=x onerror=alert(1)>"]));
    for (const keyword of keywords) {
      expect(keyword.getAttribute("href")).toMatch(new RegExp(`^${BASE_}\\?q=[A-Za-z0-9%._~()!*'-]*$`));
    }
    const owners = [...document.querySelectorAll("[data-owner]")];
    expect(owners.map((owner) => text(owner))).toContain('@"><img src=x onerror=alert(1)>');
    // No `javascript:` upstream URL becomes a link.
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(document.querySelector("[data-field='source'] a[href^='javascript']")).toBeNull();
  });

  it("hostile/metadata: an unsafe supersededBy shows as text and is never a link", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/metadata/");
    const superseded = document.querySelector("[data-superseded-by]");
    expect(superseded).not.toBeNull();
    expect(superseded?.querySelector("a")).toBeNull();
    expect(text(superseded)).toContain("title: pwned");
  });

  it("owners: the source's own ownerUrl template links the owner, a login that breaks the URL is plain text", async () => {
    const readme = await readHtml(site("catalog"), "/index-b/hostile/readme/");
    const linked = readme.querySelector("[data-metadata] [data-owner]");
    expect(linked?.localName).toBe("a");
    const href = linked?.getAttribute("href") ?? "";
    expect(href.startsWith("https://ocx-bot.forge.test/u?next=")).toBe(true);
    expect(href).not.toMatch(/[<>"\s]/);
    expect(href).not.toContain("forge.example");

    const hostile = await readHtml(site("catalog"), "/index-b/hostile/ownerlink/");
    const plain = hostile.querySelector("[data-metadata] [data-owner]");
    expect(plain?.localName).toBe("span");
    expect(text(plain)).toBe("@not/a-host");
    expect(hostile.querySelector("[data-metadata] [data-field='owners'] a")).toBeNull();
  });

  it("wire base: a non-root source's island root and logo use /index/<label>/p (C-016)", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/readme/");
    const root = document.querySelector<HTMLElement>("[data-versions]");
    expect(root?.dataset).toMatchObject({ base: BASE_, ns: "hostile", pkg: "readme", wireBase: "index/index-b", name: "index-b/hostile/readme" });
    expect(document.querySelector(".identity img")?.getAttribute("src")).toMatch(
      /^\/catalog\/index\/index-b\/p\/hostile\/readme\/o\/sha256\/b30aa38b14a5242481bd0fab2ec6005ddebcc0946cd4f9f1356b2b7c86bcbadf\.svg$/,
    );
  });

  it("hostile/noreadme: the README pane says unavailable, the build exited 0 and logged no fault (C-037)", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/noreadme/");
    expect(text(document.querySelector("[data-readme-unavailable]"))).toBe("README unavailable.");
    expect(document.querySelector(".readme-content")).toBeNull();
    expect(document.querySelector("article h1")).not.toBeNull();
    const log = siteLog("catalog");
    expect(log.code).toBe(0);
    expect(log.stderr).not.toMatch(/README for .* unavailable/);
  });
});

describe("a project build (README faults, platforms)", () => {
  const readmePath = "index/p/acme/gadget/o/sha256/694faac6a65dce1b6f72c71b1af336a7328f39fc83c60bdb75151bbd87ef71b0.md";
  let project: Project;
  let result: CliResult;

  beforeAll(async () => {
    project = await createProject({}, { [readmePath]: "x".repeat(MAX_CAS_ASSET_BYTES + 1) });
    result = await runBuild(project.config, project.out);
  });
  afterAll(() => project.dispose());

  it("an oversized README is an unavailable pane plus one warning naming the package; the build exits 0 and its sibling READMEs render (C-037)", async () => {
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr.match(/README for ".*acme\/gadget" unavailable/g)).toHaveLength(1);
    const gadget = await readHtml(project.out, "/acme/gadget/");
    expect(text(gadget.querySelector("[data-readme-unavailable]"))).toBe("README unavailable.");
    const bat = await readHtml(project.out, "/sharkdp/bat/");
    expect(bat.querySelector(".readme-content")).not.toBeNull();
    expect(bat.querySelector("[data-readme-unavailable]")).toBeNull();
  });

  it("the platform card lists the latest tag's OS set as glyph chips (C-013)", async () => {
    const gadget = await readHtml(project.out, "/acme/gadget/");
    const platforms = [...gadget.querySelectorAll("[data-platforms] .ocx-platform[data-os]")].map((el) => el.getAttribute("data-os"));
    expect(platforms).toEqual(["linux", "darwin", "windows"]);
    expect(gadget.querySelector("[data-platforms] .ocx-platform[data-os='linux']")?.getAttribute("title")).toBe("Linux (amd64, arm64)");
  });
});

describe.each([
  ["root", "/"],
  ["catalog", "/catalog/"],
] as const)("C-011 detail page on the %s site: the versions island is wired but nothing of it loads before interaction", (name, base) => {
  it("ships the module script that mounts [data-versions] on the theme's lazy mount, no modulepreload and no catalog.json in the HTML", async () => {
    const dir = site(name);
    const { scripts, preloads, mentionsCatalog } = await pageScripts(dir, await readHtml(dir, "/tools/many-tags/"), base);

    const island = scripts.filter(({ code }) => code.includes("[data-versions]") && code.includes("zagState"));
    expect(island, "a page script that mounts the island on the theme's lazy mount").toHaveLength(1);
    expect(preloads).toBe(0);
    expect(mentionsCatalog).toBe(false);
  });

  it("the versions root carries data-zag-root so an early click on 'show all versions' can be replayed", async () => {
    const dir = site(name);
    const doc = await readHtml(dir, "/tools/many-tags/");
    expect(doc.querySelector("[data-versions]")?.getAttribute("data-zag-root")).toBe("versions");
  });
});
