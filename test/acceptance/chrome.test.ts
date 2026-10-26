/**
 * Chrome (C-021, S-015), asserted on built sites: `neutral` renders the
 * mirror's own brand, nav and footer and no ocx.sh ecosystem menu; `ocx`
 * renders the theme's `nav.json` header and footer. Ports the real-build
 * halves of `brand_install`, `public_org_links`, `site_header` and
 * `site_footer` (the old theme suites) onto the Astro Shell.
 *
 * Needs the `root` (neutral, base `/`) and `catalog` (ocx, base `/catalog/`)
 * sites, plus two own builds for inputs the fixtures do not cover.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, FIXTURE_DIR, htmlRoutes, readHtml, runBuild, site, type Project } from "./helpers.js";

interface Link {
  readonly text: string;
  readonly href: string;
}

const linksOf = (doc: Document, selector: string): Link[] =>
  [...doc.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => ({
    text: (a.textContent ?? "").trim(),
    href: a.getAttribute("href") ?? "",
  }));

const headerNav = (doc: Document): Link[] => linksOf(doc, 'nav.ocx-header__nav[aria-label="Main"] a');
const footerLinks = (doc: Document): Link[] => linksOf(doc, "footer.ocx-footer .ocx-footer__links a");
const brandLink = (doc: Document): HTMLAnchorElement => doc.querySelector<HTMLAnchorElement>("a.ocx-header__brand")!;

interface OcxNav {
  readonly sections: readonly { id: string; label: string; href?: string }[];
  readonly footer: readonly { label: string; href: string }[];
}
const themeNav = JSON.parse(
  await readFile(createRequire(import.meta.url).resolve("@ocx-sh/theme/nav.json"), "utf8"),
) as OcxNav;

describe("C-021 neutral chrome (root fixture, base /)", () => {
  it("D-140 the brand links home, shows the wordmark, and shows the OCX mark when no logo is configured", async () => {
    const doc = await readHtml(site("root"), "/");

    expect(brandLink(doc).getAttribute("href")).toBe("/");
    expect(brandLink(doc).getAttribute("aria-label")).toBe("fixture.ocx.test home");
    expect(brandLink(doc).textContent?.trim()).toBe("fixture.ocx.test");
    expect(brandLink(doc).querySelector("img")?.getAttribute("src")).toMatch(/^\/_astro\/logo\.[\w-]+\.svg$/);
  });

  it.each(["/", "/404.html", "/docs/guide/getting-started/"])(
    "D-135 D-138 %s: header nav leads with catalog, then docsNav and nav[]; the footer leads with catalog json, then footer.links[]; external links stay absolute",
    async (path) => {
      const doc = await readHtml(site("root"), path);

      expect(headerNav(doc)).toEqual([
        { text: "catalog", href: "/" },
        { text: "Guide", href: "/docs/guide/getting-started/" },
        { text: "CLI", href: "/docs/reference/cli/" },
        { text: "Source", href: "https://github.com/ocx-sh/catalog" },
      ]);
      expect(footerLinks(doc)).toEqual([
        { text: "catalog json", href: "/data/catalog/catalog.json" },
        { text: "Index", href: "https://index.ocx.sh" },
      ]);
    },
  );

  it("a package page carries the same chrome", async () => {
    const [route] = (await htmlRoutes(site("root"))).filter((path) => path !== "docs" && !path.startsWith("docs/"));
    const doc = await readHtml(site("root"), `/${route}/`);

    expect(headerNav(doc).map((link) => link.text)).toEqual(["catalog", "Guide", "CLI", "Source"]);
    expect(doc.querySelector("main#main")).not.toBeNull();
    expect(footerLinks(doc)).toHaveLength(2);
  });

  it("D-142 the skip link and main#main are on the catalog and a package page, not only the 404", async () => {
    const [route] = (await htmlRoutes(site("root"))).filter((path) => path !== "docs" && !path.startsWith("docs/"));

    for (const path of ["/", `/${route}/`]) {
      const doc = await readHtml(site("root"), path);
      expect(doc.querySelector("a.ocx-skip")?.getAttribute("href"), path).toBe("#main");
      expect(doc.querySelector("main#main"), path).not.toBeNull();
    }
  });

  it("D-138 the catalog link is current on a package detail page, and on a docs page only the docs link is", async () => {
    const [route] = (await htmlRoutes(site("root"))).filter((path) => path !== "docs" && !path.startsWith("docs/"));
    const current = async (path: string) =>
      [...(await readHtml(site("root"), path)).querySelectorAll('nav.ocx-header__nav[aria-label="Main"] a[aria-current="page"]')].map(
        (a) => a.textContent?.trim(),
      );

    expect(await current(`/${route}/`)).toEqual(["catalog"]);
    expect(await current("/docs/guide/getting-started/")).toEqual(["Guide"]);
  });

  it("D-138 the catalog link is never current on a docs page no docsNav link prefixes (the docs root, an unlisted page)", async () => {
    const currentLinks = async (path: string) =>
      [...(await readHtml(site("root"), path)).querySelectorAll('nav.ocx-header__nav[aria-label="Main"] a[aria-current="page"]')].map(
        (a) => a.textContent?.trim(),
      );

    expect(await currentLinks("/docs/")).toEqual([]);
    expect(await currentLinks("/docs/guide/install/")).toEqual([]);
  });

  it("D-142 on a docs page only the longest matching prefix is current, not the catalog link beside it", async () => {
    const currentLinks = async (path: string) =>
      [...(await readHtml(site("root"), path)).querySelectorAll('nav.ocx-header__nav[aria-label="Main"] a[aria-current="page"]')].map(
        (a) => a.textContent?.trim(),
      );

    expect(await currentLinks("/")).toEqual(["catalog"]);
    expect(await currentLinks("/docs/guide/getting-started/")).toEqual(["Guide"]);
  });

  it("D-142 an external header link opens in a new tab with noopener noreferrer and the external icon", async () => {
    const doc = await readHtml(site("root"), "/");
    const source = doc.querySelector('nav.ocx-header__nav[aria-label="Main"] a[href="https://github.com/ocx-sh/catalog"]');

    expect(source?.getAttribute("target")).toBe("_blank");
    expect(source?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(source?.querySelector("svg")).not.toBeNull();
  });

  it("D-005 D-110 the landing page takes the wide column; a 404 keeps the prose column", async () => {
    const width = async (path: string) => (await readHtml(site("root"), path)).querySelector("main#main")?.getAttribute("data-width");

    expect(await width("/")).toBe("wide");
    expect(await width("/404.html")).toBe("prose");
  });

  it("D-136 the page carries the catalog's generated timestamp for the footer stamp, not a catalog.json fetch", async () => {
    const doc = await readHtml(site("root"), "/");

    expect(doc.querySelector('meta[name="ocx-generated"]')?.getAttribute("content")).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(doc.querySelector('link[href$="catalog.json"]')).toBeNull();
  });

  it("D-136 the page ships the script that stamps the footer: one bundle reads ocx-generated, finds .ocx-footer and words 'updated'", async () => {
    const doc = await readHtml(site("root"), "/");
    const inline = [...doc.querySelectorAll("script:not([src])")].map((el) => el.textContent ?? "");
    const linked = [...doc.querySelectorAll("script[src]")].map((el) => el.getAttribute("src")!);
    const bodies = [...inline, ...(await Promise.all(linked.map((src) => readFile(join(site("root"), src), "utf8"))))];

    expect(bodies.some((body) => body.includes("ocx-generated") && body.includes(".ocx-footer") && body.includes("updated "))).toBe(true);
  });

  it("shows no ocx.sh ecosystem menu, section nav or install action", async () => {
    const doc = await readHtml(site("root"), "/");

    expect(doc.querySelector("#ocx-ecosystem-menu, .ocx-mega, [data-ocx-section]")).toBeNull();
    expect(doc.querySelector('nav[aria-label="ocx sections"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("ecosystem");
  });
});

describe("C-021 ocx chrome (catalog fixture, base /catalog/)", () => {
  it("the ocx header carries data-nav-rev, which the theme's /_shell/ sync reads; neutral chrome has none", async () => {
    expect((await readHtml(site("catalog"), "/")).querySelector("[data-nav-rev]")?.getAttribute("data-nav-rev")).toMatch(/^[0-9a-f]+$/);
    expect((await readHtml(site("root"), "/")).querySelector("[data-nav-rev]")).toBeNull();
  });

  it("renders the nav.json header: ocx brand, its sections, the catalog one current", async () => {
    const doc = await readHtml(site("catalog"), "/");

    expect(brandLink(doc).getAttribute("aria-label")).toBe("ocx home");
    const sections = [...doc.querySelectorAll("[data-ocx-section]")].map((el) => el.getAttribute("data-ocx-section"));
    expect(sections).toEqual(expect.arrayContaining(themeNav.sections.map((section) => section.id)));
    expect(doc.querySelector('a[data-ocx-section="catalog"]')?.getAttribute("aria-current")).toBe("page");
    expect(doc.querySelector("#ocx-ecosystem-menu")).not.toBeNull();
  });

  it("D-135 the nav.json footer links stay, and the catalog json pointer follows them with its tooltip", async () => {
    const doc = await readHtml(site("catalog"), "/");
    const pointer = doc.querySelector<HTMLAnchorElement>('footer.ocx-footer a[href="/catalog/data/catalog/catalog.json"]');

    expect(footerLinks(doc)).toEqual([
      ...themeNav.footer.map((link) => ({ text: link.label, href: link.href })),
      { text: "catalog json", href: "/catalog/data/catalog/catalog.json" },
    ]);
    expect(pointer?.getAttribute("title")).toBe("This site's own rendered view model — not the index wire format");
  });

  it("D-158 the page has exactly one rel=icon, the ocx default when no favicon is configured", async () => {
    const doc = await readHtml(site("catalog"), "/");

    expect([...doc.querySelectorAll('link[rel="icon"]')].map((el) => el.getAttribute("href"))).toEqual([
      "/catalog/favicon.svg",
    ]);
  });

  it("D-139 with no docs mount, the ocx header has no link to a docs mount", async () => {
    for (const path of ["/", "/404.html"]) {
      const doc = await readHtml(site("catalog"), path);
      expect(doc.querySelector('header a[href="/catalog/docs/"]'), path).toBeNull();
    }
  });

  it("the 404 page has the same header", async () => {
    const doc = await readHtml(site("catalog"), "/404.html");

    expect(doc.querySelector('a[data-ocx-section="catalog"]')?.getAttribute("aria-current")).toBe("page");
    expect(doc.querySelector("#ocx-ecosystem-menu")).not.toBeNull();
  });
});

async function iconHrefs(out: string): Promise<(string | null)[]> {
  return [...(await readHtml(out, "/404.html")).querySelectorAll('link[rel="icon"]')].map((el) => el.getAttribute("href"));
}

describe("C-021 neutral chrome from own builds", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  async function build(extra: Record<string, unknown>, files: Record<string, string>): Promise<{ out: string }> {
    const project = await createProject(extra, files);
    projects.push(project);
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);
    return { out: project.out };
  }

  it("under a sub-path: the brand logo, the auto docs link, nav[] and footer.links[] join base; absolute links do not", async () => {
    const logo = await readFile(join(FIXTURE_DIR, "../quality-index/brand/logo.svg"), "utf8");
    const { out } = await build(
      {
        base: "/catalog/",
        brand: { title: "Acme Packages", wordmark: "packages.acme.example", logo: "./brand/acme-logo.svg" },
        docs: "./docs",
        nav: [
          { text: "Home", link: "/" },
          { text: "Repo", link: "https://example.test/repo" },
        ],
        footer: { links: [{ text: "Status", link: "/status/" }] },
      },
      { "brand/acme-logo.svg": logo, "docs/intro.md": "# Intro\n" },
    );
    const doc = await readHtml(out, "/404.html");

    // The wordmark is brand.wordmark, not brand.title (the two differ here).
    expect(brandLink(doc).textContent?.trim()).toBe("packages.acme.example");
    expect(brandLink(doc).getAttribute("href")).toBe("/catalog/");
    expect(brandLink(doc).getAttribute("aria-label")).toBe("packages.acme.example home");
    expect(brandLink(doc).querySelector("img")?.getAttribute("src")).toBe("/catalog/acme-logo.svg");
    expect(await readFile(join(out, "acme-logo.svg"), "utf8")).toBe(logo);
    expect(headerNav(doc)).toEqual([
      { text: "catalog", href: "/catalog/" },
      { text: "docs", href: "/catalog/docs/" },
      { text: "Home", href: "/catalog/" },
      { text: "Repo", href: "https://example.test/repo" },
    ]);
    expect(footerLinks(doc)).toEqual([
      { text: "catalog json", href: "/catalog/data/catalog/catalog.json" },
      { text: "Status", href: "/catalog/status/" },
    ]);
  });

  it("D-158 an absolute https favicon is rendered as written, not joined onto base, and replaces the ocx default", async () => {
    const { out } = await build({ base: "/catalog/", favicon: "https://cdn.example/icon.svg", chrome: "ocx", brand: undefined }, {});
    const icon = (await readHtml(out, "/404.html")).querySelector('link[rel="icon"]');


    expect(icon?.getAttribute("href")).toBe("https://cdn.example/icon.svg");
    expect(await iconHrefs(out)).toEqual(["https://cdn.example/icon.svg"]);
  });

  it("a favicon that is not an absolute http(s) URL or a root path is a config error (exit 65), not a render crash", async () => {
    const project = await createProject({ favicon: "//cdn.example/icon.svg" }, {});
    projects.push(project);

    const result = await runBuild(project.config, project.out);

    expect(result.code).toBe(65);
    expect(result.stderr).toContain("favicon");
  });

  it("with a docs mount, the ocx header still has no docs link: the ecosystem menu (nav.json) carries it", async () => {
    const { out } = await build({ chrome: "ocx", base: "/catalog/", docs: "./docs", brand: undefined }, { "docs/intro.md": "# Intro\n" });

    for (const path of ["/", "/404.html", "/docs/intro/"]) {
      const doc = await readHtml(out, path);
      expect([...doc.querySelectorAll("header a")].some((a) => a.textContent?.trim() === "docs" && a.getAttribute("href") === "/catalog/docs/"), path).toBe(false);
    }
  });

  it("with no docs, nav[] or footer: only the catalog header link and the catalog json footer link; the title as brand text with the OCX mark", async () => {
    const { out } = await build({ brand: { title: "Plain Catalog" } }, {});
    const doc = await readHtml(out, "/404.html");

    expect(headerNav(doc)).toEqual([{ text: "catalog", href: "/" }]);
    expect(footerLinks(doc)).toEqual([{ text: "catalog json", href: "/data/catalog/catalog.json" }]);
    expect(brandLink(doc).textContent?.trim()).toBe("Plain Catalog");
    expect(brandLink(doc).querySelector("img")?.getAttribute("src")).toMatch(/^\/_astro\/logo\.[\w-]+\.svg$/);
  });
});
