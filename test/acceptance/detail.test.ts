/**
 * The package detail page on built sites (T.4; C-009, C-013, C-014, C-015,
 * C-037, C-041, C-042, S-007, S-020): every listed field is in the HTML with
 * no script run (the pages are parsed by jsdom with scripts off), hostile
 * README and hostile metadata come out inert, owners link per source or fall
 * back to plain text, a missing README is a pane and not a failure, the tree
 * lists every tag (yanked ones marked) with no fetch, and the copy menus
 * and their hosts carry the DOM contract of `client/detail.ts`. The variants, `any/any`,
 * variant-only and unusual-name cases need platform data these fixtures do not
 * carry: `detail_tree.test.ts` builds them.
 *
 * Needs the `root` and `catalog` sites (`ACCEPT_CONFIG=root,catalog`). The
 * fixture packages are described in `test/fixtures/site/README` terms: index-a
 * is the root source (bare routes, wire tree at `/p`), index-b the `index-b`
 * label (routes under `index-b/`, wire tree at `/index/index-b/p`).
 *
 * Ported 0.5.x wiring rows (the old files are deleted by P-purge):
 *  - deprecation_banner_href  -> "deprecated" + "unsafe supersededBy" below, and test/site/model/detail.test.ts
 *  - detail_page_annotations  -> "license, source and revision" below
 *  - detail_page_wire_base    -> "wire base" below keeps the logo path; the tree's own fetch is test/site/client/versions.test.ts and "loads what it did not prerender" in detail_island.test.ts
 *  - owner_url                -> "owners" below and test/site/lib/ownerUrl.test.ts
 *  - readme_pane              -> "README" below and test/site/lib/readmeRender.test.ts
 *  - yanked_status            -> "yanked" below
 *  - copy_link_route          -> test/site/client/detail.test.ts ("clicking to copy")
 *  - layout_route_split       -> no async route components exist; the detail page is one static HTML file ("complete without JS")
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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
  [...document.querySelectorAll("[data-install] [data-install-row] .ocx-cmdbar__text")].map((el) => text(el));
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
      expect(document.querySelector("[data-versions] [data-versions-list]"), route).not.toBeNull();
      expect(document.querySelector("article[data-detail]"), route).not.toBeNull();
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
      "ocx add index-a/tools/modern",
      "ocx --global add index-a/tools/modern",
      "ocx package exec index-a/tools/modern",
      "ocx package install index-a/tools/modern",
    ]);
    expect(document.querySelectorAll("[data-install] [data-install-copy]")).toHaveLength(4);
    expect(document.querySelector<HTMLOptionElement>("[data-install-pin] select option[selected]")?.value).toBe("latest");
  });

  it("owners: the top-level ownerUrl template, else the GitHub default", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const owner = document.querySelector("[data-metadata] [data-owner]");
    expect(owner?.localName).toBe("a");
    expect(owner?.getAttribute("href")).toBe(name === "catalog" ? "https://forge.example/ocx-bot" : "https://github.com/ocx-bot");
    expect(text(owner)).toBe("@ocx-bot");
  });

  it("D-077: logos are the theme LogoTile's <img> with intrinsic width and height at the mirrored CAS path; no wire SVG is inlined (C-015)", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const logo = document.querySelector<HTMLImageElement>(".identity .ocx-logo-tile__image");
    expect(logo?.getAttribute("src")).toMatch(
      new RegExp(`^${base}p/tools/modern/o/sha256/654ab3d0743d7f788d1509052e057fce9ff6f980b9491d6635eff51a06327b55\\.svg$`),
    );
    expect(logo?.getAttribute("width")).toBe("56");
    expect(logo?.getAttribute("height")).toBe("56");
    expect(document.querySelector(".identity .ocx-logo-tile")?.getAttribute("data-size")).toBe("xl");
    expect(document.querySelector(".identity .ocx-logo-tile")?.getAttribute("data-state")).toBe("loading");
    expect(document.querySelector(".identity .ocx-logo-tile svg:not(.ocx-icon)")).toBeNull();
  });

  it("a package without a logo gets a monogram tile, not an image", async () => {
    const { packages } = await catalogJson(name);
    const bare = packages.find((pkg) => pkg.logoUrl === null);
    expect(bare, "a fixture package without a logo").toBeDefined();
    const route = (bare?.name ?? "").replace(/^index-a\//, "");
    const document = await readHtml(site(name), `/${route}/`);
    expect(document.querySelector<HTMLImageElement>(".identity .ocx-logo-tile__image")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".identity .ocx-logo-tile")?.getAttribute("data-state")).toBe("fallback");
    expect(text(document.querySelector(".identity .ocx-logo-tile__initials"))).toMatch(/^[A-Z0-9]{1,2}$/);
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

  it("D-054: tools/flaky keeps its yanked tag in the tree, struck through, with the reason and date", async () => {
    const document = await readHtml(site(name), "/tools/flaky/");
    const chip = document.querySelector("[data-tag='0.9.1'][data-yanked]");
    expect(chip?.getAttribute("title")).toBe(
      "Yanked — Crashes on startup. · 2026-02-25 — click to copy identifier · right-click for more",
    );
    expect(tags(document)).toContain("1.0.0");
    expect(text(document.querySelector("#versions-heading"))).toBe("Versions · 3");
    expect(document.querySelector("[data-breakdown] .warn-icon, [data-breakdown] [data-icon='warning']")).not.toBeNull();
    expect(text(document.querySelector("[data-yanked-reason]"))).toContain("0.9.1 yanked — Crashes on startup. · 2026-02-25");
  });

  it("D-079, D-149: tools/many-tags: the prerender is bounded: the newest lines are in the HTML, the oldest are behind Show all", async () => {
    const document = await readHtml(site(name), "/tools/many-tags/");
    const real = new Set(tags(document));
    // 25 tags: `latest` and 24 minor lines, one line past the bound (`SSR_LINES`); the oldest line is left out.
    expect(real.size).toBe(24);
    expect(real.has("latest")).toBe(true);
    expect(real.has("0.24.0")).toBe(true);
    expect(real.has("0.1.0")).toBe(false);
    expect(text(document.querySelector("#versions-heading"))).toBe("Versions · 25");
    expect(text(document.querySelector("[data-row='tags'] dd"))).toBe("25");
    // The cut breakdown fetches the rest when opened (D-149); there is no separate Show all button.
    expect(document.querySelector("[data-versions-more]")).toBeNull();
    expect(document.querySelector("[data-breakdown]")?.hasAttribute("data-lazy")).toBe(true);
    expect(document.querySelectorAll("template[data-tpl]")).toHaveLength(3);
  });

  it("D-149: a package whose whole tree is prerendered has no Show all, no templates, no lazy mark and no preload", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    expect(document.querySelector("[data-versions-more], template[data-tpl], [data-lazy]")).toBeNull();
    expect(document.querySelectorAll("link[href*='_root.json']")).toHaveLength(0);
  });

  it("D-053, D-057: tools/modern: one default row, an alias chain sharing a digest, a major/minor/patch breakdown", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const row = document.querySelector("[data-versions-list] .variant-row");
    expect(text(row?.querySelector(".variant-label"))).toBe("(default)");
    expect([...(row?.querySelectorAll(".alias-chain [data-tag]") ?? [])].map((el) => el.getAttribute("data-tag"))).toEqual([
      "latest",
      "2",
      "2.1",
      "2.1.0",
    ]);
    expect(row?.querySelector(".alias-chain [data-tag='latest']")?.classList.contains("latest")).toBe(true);
    expect(text(row?.querySelector("[data-breakdown] .expand-count"))).toBe("5 more");
    // newest first within the breakdown
    const patches = [...(row?.querySelectorAll("[data-breakdown] .patches [data-tag]") ?? [])].map((el) => el.getAttribute("data-tag"));
    expect(patches).toEqual(["2.1.0", "2.0.0"]);
  });

  it("D-075, D-076: the latest chip names the most precise alias of latest; a deprecated package has none", async () => {
    const modern = await readHtml(site(name), "/tools/modern/");
    expect(text(modern.querySelector("[data-latest]"))).toBe("latest 2.1.0");
    expect(text(modern.querySelector("[data-row='latest'] dd"))).toBe("2.1.0");
    const old = await readHtml(site(name), "/legacy/oldtool/");
    expect(old.querySelector("[data-latest]")).toBeNull();
    expect(old.querySelector("[data-row='latest']")).toBeNull();
  });

  it("D-059: legacy/oldtool: the deprecated package's stray latest is not the install target", async () => {
    const document = await readHtml(site(name), "/legacy/oldtool/");
    const commands = installCommands(document);
    expect(commands).toHaveLength(4);
    for (const command of commands) expect(command).toMatch(/^ocx .*index-a\/legacy\/oldtool:\d/);
    expect([...document.querySelectorAll("[data-versions-list] .alias-chain [data-tag]")].map((el) => el.getAttribute("data-tag"))).not.toContain("latest");
  });

  it("D-056, D-082: the version list is one copy menu in context mode over the tags, with the hint above it", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const root = document.querySelector<HTMLElement>("[data-versions]");
    const menu = root?.querySelector("[data-zag-root='copy-menu'][data-context]");
    expect(menu?.querySelector("[data-versions-list]")).not.toBeNull();
    expect(menu?.hasAttribute("tabindex"), "no wrapper tab stop").toBe(false);
    expect(text(root?.querySelector("[data-versions-hint]"))).toBe("click = copy identifier · right-click = more");
    const items = [...menu!.querySelectorAll("[role='menuitem']")];
    expect(items.map((el) => el.getAttribute("data-value"))).toEqual(["identifier", "tag", "link", "project", "global", "exec", "install"]);
    expect(items.map((el) => text(el))).toEqual([
      "Copy identifier",
      "Copy tag",
      "Copy link",
      "Add to project",
      "Add globally",
      "Run without installing",
      "Install package",
    ]);
  });

  it("D-055, D-056, D-082: every tag is a native button: one Tab stop, Enter and Space click it, and its title names the gestures", async () => {
    const document = await readHtml(site(name), "/tools/many-tags/");
    const chips = [...document.querySelectorAll("[data-versions-list] [data-tag]")];
    expect(chips.length).toBeGreaterThan(20);
    for (const chip of chips) {
      expect(chip.localName, chip.outerHTML).toBe("button");
      expect(chip.getAttribute("type")).toBe("button");
      expect(chip.hasAttribute("tabindex"), chip.outerHTML).toBe(false);
      expect(chip.getAttribute("title"), chip.outerHTML).toMatch(/click to copy identifier · right-click for more$/i);
    }
    expect(document.querySelector("[data-versions-list] [data-tag] [data-tag-name]")).toBeNull();
  });

  it("D-073, D-074: the package name is a button in its own copy menu, and so is every install command", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const badge = document.querySelector("[data-identity] [data-name-copy]");
    expect(badge?.localName).toBe("button");
    expect(badge?.closest("[data-zag-root='copy-menu'][data-context]")).not.toBeNull();
    expect(text(badge?.querySelector("code"))).toBe("index-a/tools/modern");
    const commands = [...document.querySelectorAll("[data-install] [data-install-copy]")];
    expect(commands).toHaveLength(4);
    for (const command of commands) {
      expect(command.querySelector("button.ocx-cmdbar__trigger")).not.toBeNull();
      expect(command.closest("[data-zag-root='copy-menu'][data-context]")).not.toBeNull();
      expect(command.getAttribute("title")).toMatch(/ — click to copy · right-click for more$/);
    }
    expect(document.querySelectorAll("[data-zag-root='copy-menu'][data-context]"), "versions, name badge and install card").toHaveLength(3);
  });

  it("D-052: the metadata registry row shows the physical oci:// repository and copies it without the scheme", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const button = document.querySelector("[data-metadata] [data-row='registry'] button[data-registry-copy]");
    expect(text(button)).toBe("oci://ghcr.io/ocx-contrib/tools/modern");
    expect(button?.getAttribute("data-registry")).toBe("ghcr.io/ocx-contrib/tools/modern");
    expect(button?.getAttribute("title")).toBe("Click to copy physical registry address (without oci://)");
    expect(text(document.querySelector("[data-metadata] dt"))).toBe("registry");
  });

  it("the release table carries one entry per distinct image index and every tag points at one (D-060)", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const releases = [...document.querySelectorAll("[data-releases] [data-release]")];
    expect(releases.length).toBeGreaterThanOrEqual(2);
    expect(releases[0]?.getAttribute("data-license")).toBe("MIT");
    const indexes = new Set(releases.map((el) => el.getAttribute("data-release")));
    for (const chip of document.querySelectorAll("[data-versions-list] [data-tag]")) {
      expect(indexes.has(chip.getAttribute("data-release") ?? ""), chip.outerHTML).toBe(true);
    }
    expect(document.querySelector("[data-releases]")?.getAttribute("data-initial")).toBe("0");
  });

  it("D-070, D-080: identity block: keyword chips, the status stamp and the logo fallback monogram", async () => {
    const modern = await readHtml(site(name), "/tools/modern/");
    expect([...modern.querySelectorAll("[data-identity] [data-keyword]")].map((a) => text(a))).toEqual(["cli", "successor"]);
    expect(modern.querySelector("[data-status-stamp]")).toBeNull();
    // D-077: the monogram is in the markup beneath the logo, so a logo that fails leaves it standing.
    expect(text(modern.querySelector(".identity .ocx-logo-tile__initials"))).toBe("MO");
    const old = await readHtml(site(name), "/legacy/oldtool/");
    expect(text(old.querySelector("[data-status-stamp]"))).toMatch(/deprecated/i);
    const husk = await readHtml(site(name), "/legacy/husk/");
    expect(text(husk.querySelector("[data-status-stamp]"))).toMatch(/yanked/i);
  });

  it("D-081: the layout is responsive — rail between versions and README up to 75em, a stack and centred identity up to 40em", async () => {
    const dir = site(name);
    const document = await readHtml(dir, "/tools/modern/");
    const hrefs = [...document.querySelectorAll("link[rel='stylesheet']")].map((link) => link.getAttribute("href") ?? "");
    const css = (await Promise.all(hrefs.map((href) => readFile(join(dir, href.slice(base.length)), "utf8")))).join("\n");
    const media = (em: number) => new RegExp(`@media\\s*\\((?:max-)?width\\s*(?:<=|:)\\s*${em}em\\)`);
    expect(css).toMatch(media(75));
    expect(css).toMatch(media(40));
    expect(css).toMatch(/grid-template-areas:\s*"versions rail"\s*"readme rail"/);
    expect(css).toMatch(/\.identity[^{]*\{[^}]*text-align:\s*center/);
  });

  it("D-005: the detail page uses the wide content column; D-145: its description names the package", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    expect(document.querySelector("main")?.getAttribute("data-width")).toBe("wide");
    expect(document.querySelector("meta[name='description']")?.getAttribute("content")).toBeTruthy();
  });

  it("D-089: the owners row is always rendered", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    expect(document.querySelector("[data-row='owners']")).not.toBeNull();
  });

  it("D-050, D-051: the upstream disclaimer sits below the identity block, with the Upstream link, and the rail has an upstream row", async () => {
    const document = await readHtml(site(name), "/sharkdp/bat/");
    const disclaimer = document.querySelector("[data-disclaimer]");
    expect(text(disclaimer)).toContain("Unaffiliated mirror of the upstream sharkdp/bat project.");
    const link = disclaimer?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/sharkdp/bat");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(text(link)).toContain("github.com/sharkdp/bat");
    // DOCUMENT_POSITION_FOLLOWING (4): the disclaimer comes after the identity block.
    expect((document.querySelector("[data-identity]")?.compareDocumentPosition(disclaimer!) ?? 0) & 4).toBe(4);
    const row = document.querySelector("[data-row='upstream'] a");
    expect(row?.getAttribute("href")).toBe("https://github.com/sharkdp/bat");
    expect(text(row)).toContain("sharkdp");
  });

  it("D-065: the source link carries the external cue and the key tooltip", async () => {
    const document = await readHtml(site(name), "/tools/modern/");
    const link = document.querySelector("[data-row='source'] a");
    expect(link?.querySelector("[data-icon='external']")).not.toBeNull();
    expect(text(link)).toContain("(opens in a new tab)");
    expect(document.querySelector("[data-row='source'] dt")?.getAttribute("title")).toBe("Repository whose CI built these artifacts");
  });

  it("D-063, D-068: the banners are neutral containers with a warning icon, not landmarks", async () => {
    const old = await readHtml(site(name), "/legacy/oldtool/");
    const banner = old.querySelector("[data-banner='deprecated']");
    expect(banner?.localName).toBe("div");
    expect(banner?.querySelector("[data-icon='warning']")).not.toBeNull();
    expect(old.querySelector("aside[data-banner]")).toBeNull();
    const husk = await readHtml(site(name), "/legacy/husk/");
    expect(husk.querySelector("[data-banner='yanked']")?.localName).toBe("div");
    expect(husk.querySelector("[data-banner='yanked'] [data-icon='warning']")).not.toBeNull();
  });

  it("D-069: the sentence order is 'Deprecated — superseded by <link>. <message>'", async () => {
    const document = await readHtml(site(name), "/legacy/oldtool/");
    const sentence = text(document.querySelector("[data-banner='deprecated']"));
    expect(sentence.indexOf("superseded by")).toBeGreaterThan(sentence.indexOf("Deprecated"));
    expect(sentence.indexOf("Superseded by tools/modern, which covers")).toBeGreaterThan(sentence.indexOf("superseded by"));
  });

  it("D-149: a package with tags past the bound preloads its own _root.json, base-joined, and the mirror holds it", async () => {
    const document = await readHtml(site(name), "/tools/many-tags/");
    const preload = document.querySelector("link[rel='preload'][href*='_root.json']");
    expect(preload?.getAttribute("as")).toBe("fetch");
    expect(preload?.getAttribute("crossorigin")).toBe("anonymous");
    const href = preload?.getAttribute("href") ?? "";
    expect(href).toMatch(new RegExp(`^${base}(index/[^/]+/)?p/tools/many-tags/_root\\.json$`));
    expect(existsSync(join(site(name), href.slice(base.length)))).toBe(true);
    expect([...document.querySelectorAll("link[rel='preload']")].filter((el) => el.getAttribute("as") !== "font")).toHaveLength(1);
  });

  it("D-091, D-093: the page carries the loading and error line, empty until the first interaction, and the mount prefix the fetch needs", async () => {
    const document = await readHtml(site(name), "/tools/many-tags/");
    const status = document.querySelector("[data-versions-status]");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(text(status)).toBe("");
    expect(document.documentElement.outerHTML).not.toContain("Failed to load");
    const root = document.querySelector<HTMLElement>("[data-versions]");
    expect(root?.dataset.base).toBe(base);
    expect(root?.dataset.ns).toBe("tools");
    expect(root?.dataset.pkg).toBe("many-tags");
    expect(root?.dataset.wireBase).toBeDefined();
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

  it("D-179: hostile/readme: the README renders inert, links per policy, images with a no-referrer policy", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/readme/");
    const readme = document.querySelector(".readme-content");
    expect(readme).not.toBeNull();
    expect(readme?.querySelectorAll("script, svg, math, style, iframe, object, embed, form, noscript")).toHaveLength(0);
    expect(readme?.querySelector("[style]")).toBeNull();
    expectInert(document, "hostile/readme");
    // Only targets the mirror holds survive (D-179): the protocol-relative one becomes https, the
    // relative ones and the entity-split `javascript:` are plain text.
    const links = [...(readme?.querySelectorAll("a") ?? [])];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://evil.example/x", "https://example.com/ok"]);
    for (const a of links) expect(a.getAttribute("href")).not.toMatch(/^\s*(?:javascript|data|vbscript):/i);
    expect(links.at(-1)?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
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
    // D-050: the disclaimer is escaped text too, and the hostile `javascript:` upstream URL is plain text.
    const disclaimer = document.querySelector("[data-disclaimer]");
    expect(text(disclaimer)).toContain("title: pwned");
    expect(disclaimer?.querySelector("a")).toBeNull();
    expect(document.querySelectorAll("article script:not([type='module'])")).toHaveLength(0);
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

  it("wire base: a non-root source's logo uses /index/<label>/p and its island root names the qualified package (C-016)", async () => {
    const document = await readHtml(site("catalog"), "/index-b/hostile/readme/");
    expect(document.querySelector("article[data-package]")?.getAttribute("data-package")).toBe("index-b/hostile/readme");
    expect(document.querySelector("[data-identity] img")?.getAttribute("src")).toMatch(
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

  it("D-061, D-072: the platform card is a table over shared architecture columns", async () => {
    const gadget = await readHtml(project.out, "/acme/gadget/");
    const matrix = gadget.querySelector("[data-platforms] [data-platform-matrix]");
    expect(matrix).not.toBeNull();
    const cells = (os: string) => [...(matrix?.querySelectorAll(`[data-os='${os}'] .platform-arch-cell`) ?? [])].map((el) => text(el));
    expect(cells("linux")).toEqual(["amd64", "arm64"]);
    for (const os of ["darwin", "windows"]) expect(cells(os)).toHaveLength(2);
    expect([...(matrix?.querySelectorAll(".platform-row") ?? [])].map((el) => el.getAttribute("data-os"))).toEqual([
      "linux",
      "darwin",
      "windows",
    ]);
  });

  it("D-149: the support-matrix dialog is a shell and a skeleton that names its package's own file", async () => {
    const gadget = await readHtml(project.out, "/acme/gadget/");
    const host = gadget.querySelector("[data-support-matrix]");
    expect(host?.getAttribute("data-support-url")).toBe("/data/catalog/support/acme/gadget.json");
    expect(host?.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(host?.querySelector("[data-matrix-table]")?.getAttribute("aria-busy")).toBe("true");
    expect(host?.querySelector("[data-matrix-skeleton]")?.hasAttribute("hidden")).toBe(false);
    const { rows } = JSON.parse(await readFile(join(project.out, "data/catalog/support/acme/gadget.json"), "utf8")) as { rows: unknown[] };
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe.each([
  ["root", "/"],
  ["catalog", "/catalog/"],
] as const)("C-011 detail page on the %s site: the islands are wired but nothing of them fetches", (name, base) => {
  it("ships the module script that mounts [data-detail] eagerly and the theme's copy-menu mount; no modulepreload and no catalog.json link or script", async () => {
    const dir = site(name);
    const doc = await readHtml(dir, "/tools/many-tags/");
    const { scripts, preloads } = await pageScripts(dir, doc, base);

    const lazy = scripts.filter(({ code }) => code.includes("copy-menu") && code.includes("zagState"));
    expect(lazy.length, "a page script that mounts the copy menus on the theme's lazy mount").toBeGreaterThan(0);
    const eager = scripts.filter(({ code }) => code.includes("[data-detail]"));
    expect(eager, "a page script that mounts the detail script").toHaveLength(1);
    expect(preloads).toBe(0);
    // The chrome may LINK to catalog.json; the page must not load it.
    expect(doc.querySelector("link[href*='catalog.json'], script[src*='catalog.json']")).toBeNull();
    for (const { code } of scripts) expect(code).not.toContain("_root.json");
  });

  it("D-149: the support-matrix rows are a lazy chunk: no page script reads the dialog's file, a built chunk the trigger imports does", async () => {
    const dir = site(name);
    const doc = await readHtml(dir, "/tools/many-tags/");
    const { scripts } = await pageScripts(dir, doc, base);
    for (const { code } of scripts) expect(code).not.toContain("supportUrl");

    const chunks = await readdir(join(dir, "_astro"));
    const holders: string[] = [];
    for (const chunk of chunks.filter((file) => file.endsWith(".js")))
      if ((await readFile(join(dir, "_astro", chunk), "utf8")).includes("supportUrl")) holders.push(chunk);
    expect(holders, "a chunk that draws the support matrix").toHaveLength(1);
  });
});
