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
  it("the brand links home and shows the wordmark, not the ocx mark", async () => {
    const doc = await readHtml(site("root"), "/");

    expect(brandLink(doc).getAttribute("href")).toBe("/");
    expect(brandLink(doc).getAttribute("aria-label")).toBe("fixture.ocx.test home");
    expect(brandLink(doc).textContent?.trim()).toBe("fixture.ocx.test");
    expect(brandLink(doc).querySelector("img, svg")).toBeNull();
  });

  it.each(["/", "/404.html", "/docs/guide/getting-started/"])(
    "%s: header nav is docsNav then nav[], the footer is footer.links[]; external links stay absolute",
    async (path) => {
      const doc = await readHtml(site("root"), path);

      expect(headerNav(doc)).toEqual([
        { text: "Guide", href: "/docs/guide/getting-started/" },
        { text: "CLI", href: "/docs/reference/cli/" },
        { text: "Source", href: "https://github.com/ocx-sh/catalog" },
      ]);
      expect(footerLinks(doc)).toEqual([{ text: "Index", href: "https://index.ocx.sh" }]);
    },
  );

  it("a package page carries the same chrome", async () => {
    const [route] = (await htmlRoutes(site("root"))).filter((path) => path !== "docs" && !path.startsWith("docs/"));
    const doc = await readHtml(site("root"), `/${route}/`);

    expect(headerNav(doc).map((link) => link.text)).toEqual(["Guide", "CLI", "Source"]);
    expect(doc.querySelector("main#main")).not.toBeNull();
    expect(footerLinks(doc)).toHaveLength(1);
  });

  it("shows no ocx.sh ecosystem menu, section nav or install action", async () => {
    const doc = await readHtml(site("root"), "/");

    expect(doc.querySelector("#ocx-ecosystem-menu, .ocx-mega, [data-ocx-section]")).toBeNull();
    expect(doc.querySelector('nav[aria-label="ocx sections"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("ecosystem");
  });
});

describe("C-021 ocx chrome (catalog fixture, base /catalog/)", () => {
  it("renders the nav.json header: ocx brand, its sections, the catalog one current", async () => {
    const doc = await readHtml(site("catalog"), "/");

    expect(brandLink(doc).getAttribute("aria-label")).toBe("ocx home");
    const sections = [...doc.querySelectorAll("[data-ocx-section]")].map((el) => el.getAttribute("data-ocx-section"));
    expect(sections).toEqual(expect.arrayContaining(themeNav.sections.map((section) => section.id)));
    expect(doc.querySelector('a[data-ocx-section="catalog"]')?.getAttribute("aria-current")).toBe("page");
    expect(doc.querySelector("#ocx-ecosystem-menu")).not.toBeNull();
  });

  it("renders the nav.json footer, not a mirror footer", async () => {
    const doc = await readHtml(site("catalog"), "/");

    expect(footerLinks(doc)).toEqual(themeNav.footer.map((link) => ({ text: link.label, href: link.href })));
  });

  it("the 404 page has the same header", async () => {
    const doc = await readHtml(site("catalog"), "/404.html");

    expect(doc.querySelector('a[data-ocx-section="catalog"]')?.getAttribute("aria-current")).toBe("page");
    expect(doc.querySelector("#ocx-ecosystem-menu")).not.toBeNull();
  });
});

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
      { text: "docs", href: "/catalog/docs/" },
      { text: "Home", href: "/catalog/" },
      { text: "Repo", href: "https://example.test/repo" },
    ]);
    expect(footerLinks(doc)).toEqual([{ text: "Status", href: "/catalog/status/" }]);
  });

  it("an absolute https favicon is rendered as written, not joined onto base", async () => {
    const { out } = await build({ base: "/catalog/", favicon: "https://cdn.example/icon.svg" }, {});
    const icon = (await readHtml(out, "/404.html")).querySelector('link[rel="icon"]');

    expect(icon?.getAttribute("href")).toBe("https://cdn.example/icon.svg");
    expect(icon?.getAttribute("type")).toBe("image/svg+xml");
  });

  it("a favicon that is not an absolute http(s) URL or a root path is a config error (exit 65), not a render crash", async () => {
    const project = await createProject({ favicon: "//cdn.example/icon.svg" }, {});
    projects.push(project);

    const result = await runBuild(project.config, project.out);

    expect(result.code).toBe(65);
    expect(result.stderr).toContain("favicon");
  });

  it("with no docs, nav[] or footer: no docs link, no header nav links, no footer links, the title as brand text", async () => {
    const { out } = await build({ brand: { title: "Plain Catalog" } }, {});
    const doc = await readHtml(out, "/404.html");

    expect(headerNav(doc)).toEqual([]);
    expect(footerLinks(doc)).toEqual([]);
    expect(brandLink(doc).textContent?.trim()).toBe("Plain Catalog");
    expect(brandLink(doc).querySelector("img, svg")).toBeNull();
  });
});
