/**
 * Theme-port parity rows asserted on built sites: what the 0.5.x Vue UI did and the Astro site must still do, where a
 * built page can tell. The behaviours that need a browser (a first paint, a live OS scheme change, a toast, a computed
 * style) are the `D-xxx` checks of `scripts/quality-interaction.mjs`.
 *
 * Rows: D-085 (the README provenance menu), D-064 and D-112 (the code-fence copy script ships on the README and the docs page), D-131 (the toaster root
 * is on every page), D-126 (one current header link, the longest prefix), D-137 (external header and footer links),
 * D-141 (a header menu is never empty).
 *
 * Needs `root` (neutral chrome, a docs mount, external nav and footer links) and `catalog` (ocx chrome, base
 * `/catalog/`), plus two own builds for the nested docs navigation and a header with nothing but the catalog link.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, htmlRoutes, pageScripts, readHtml, runBuild, site, type Project } from "./helpers.js";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

/** The code of every module script the page loads (and what they import statically), joined. */
async function scriptCode(siteDir: string, urlPath: string, base: string): Promise<string> {
  const doc = await readHtml(siteDir, urlPath);
  return (await pageScripts(siteDir, doc, base)).scripts.map((script) => script.code).join("\n");
}

describe("D-064 D-112 the code-fence copy script reaches the pages with prose code", () => {
  const cases = [
    { name: "root" as const, base: "/", readme: "/tools/modern/", docs: "/docs/guide/getting-started/" },
    { name: "catalog" as const, base: "/catalog/", readme: "/tools/modern/", docs: null },
  ];
  for (const c of cases) {
    it(`D-064 D-112 ${c.name}: a README page and (with a docs mount) a docs page load the script that adds 'Copy code'`, async () => {
      const readme = await scriptCode(site(c.name), c.readme, c.base);

      expect(readme).toContain("ocx-prose-copy");
      expect(readme).toContain("Copy code");
      expect(readme).toContain("code block");
      if (c.docs !== null) expect(await scriptCode(site(c.name), c.docs, c.base)).toContain("ocx-prose-copy");
    });
  }

  it("D-064 D-112 the script ships only where prose fences are: the landing page and the 404 load none of it", async () => {
    for (const c of [{ name: "root" as const, base: "/" }, { name: "catalog" as const, base: "/catalog/" }])
      for (const path of ["/", "/404.html"]) {
        const code = await scriptCode(site(c.name), path, c.base);

        expect(code, `${c.name} ${path}`).not.toContain("ocx-prose-copy");
        expect(code, `${c.name} ${path}`).not.toContain("Copy code");
      }
  });

  it("D-064 the README and the docs article sit in .ocx-prose, which the script enhances; the README still holds a pre", async () => {
    const readme = await readHtml(site("root"), "/tools/modern/");
    const docs = await readHtml(site("root"), "/docs/guide/getting-started/");

    expect(readme.querySelectorAll(".ocx-prose.readme-content pre").length).toBeGreaterThan(0);
    expect(docs.querySelectorAll("article.ocx-prose pre").length).toBeGreaterThan(0);
  });

  it("D-064 D-112 the buttons are added at run time: the sanitised README holds none of its own", async () => {
    // The script inserts them at load (a screen-reader user has no hover to summon a button); the sanitiser forbids `button`.
    const readme = await readHtml(site("root"), "/tools/modern/");

    expect(readme.querySelectorAll(".readme-content button")).toHaveLength(0);
  });
});

describe("D-085 the README provenance menu", () => {
  const cases = [
    { name: "root" as const, base: "/", path: "/tools/modern/" },
    { name: "catalog" as const, base: "/catalog/", path: "/tools/modern/" },
  ];
  for (const c of cases) {
    it(`D-085 ${c.name}: a package with a README offers Copy digest, Copy URL and Copy fetch command, for that README's own path`, async () => {
      const doc = await readHtml(site(c.name), c.path);
      const menu = doc.querySelector<HTMLElement>("[data-readme-provenance]");
      const href = menu?.dataset.path ?? "";
      const items = Object.fromEntries(
        [...(menu?.querySelectorAll('[data-part="item"]') ?? [])].map((item) => [item.getAttribute("data-value"), { label: item.textContent?.trim(), text: item.getAttribute("data-copy-text") }]),
      );

      expect(href).toMatch(new RegExp(`^${c.base}p/tools/modern/o/sha256/[a-f0-9]{64}\\.md$`));
      expect(items).toEqual({
        digest: { label: "Copy digest", text: `sha256:${href.slice(-67, -3)}` },
        url: { label: "Copy URL", text: href },
        curl: { label: "Copy fetch command", text: `curl -sL ${href}` },
      });
    });
  }

  it("D-085 the README path the menu names is a file the site mirrors", async () => {
    const doc = await readHtml(site("root"), "/tools/modern/");
    const href = doc.querySelector<HTMLElement>("[data-readme-provenance]")?.dataset.path ?? "";

    expect(await readFile(join(site("root"), href), "utf8")).toContain("ocx pull tools/modern");
  });

  it("D-085 a package with no README has no provenance menu, only the 'unavailable' note", async () => {
    const doc = await readHtml(site("catalog"), "/index-b/hostile/noreadme/");

    expect(doc.querySelector("[data-readme-unavailable]")).not.toBeNull();
    expect(doc.querySelector("[data-readme-provenance]")).toBeNull();
  });
});

describe("D-131 the copy-confirmation toaster is on every page", () => {
  for (const name of ["root", "catalog"] as const) {
    it(`D-131 ${name}: every page carries one polite toaster region`, async () => {
      const routes = await htmlRoutes(site(name));
      const missing: string[] = [];
      for (const route of [...routes, "404.html"]) {
        const doc = await readHtml(site(name), route === "404.html" ? "/404.html" : `/${route}/`);
        const roots = doc.querySelectorAll('[data-zag-root="toast"]');
        if (roots.length !== 1 || roots[0]?.getAttribute("aria-live") !== "polite") missing.push(route);
      }

      expect(routes.length).toBeGreaterThan(5);
      expect(missing).toEqual([]);
    });
  }
});

describe("D-137 an external header or footer link opens in a new tab", () => {
  const external = (doc: Document, scope: string) =>
    [...doc.querySelectorAll<HTMLAnchorElement>(`${scope} a[href^="http"]`)].map((a) => ({
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
      icon: a.querySelector('svg[data-icon="external"]') !== null,
    }));

  it("D-137 root: the header nav, the mobile menu and the footer links carry target, rel and the external icon", async () => {
    const doc = await readHtml(site("root"), "/");

    for (const scope of ["nav.ocx-header__nav", "#ocx-header-menu", "footer.ocx-footer"]) {
      const links = external(doc, scope);
      expect(links.length, scope).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.target, `${scope} ${link.href}`).toBe("_blank");
        expect(link.rel, `${scope} ${link.href}`).toBe("noopener noreferrer");
        expect(link.icon, `${scope} ${link.href}`).toBe(true);
      }
    }
  });

  it("D-137 root: an internal link opens in the same tab with no icon", async () => {
    const doc = await readHtml(site("root"), "/");
    const internal = [...doc.querySelectorAll<HTMLAnchorElement>('nav.ocx-header__nav a[href^="/"], footer.ocx-footer a[href^="/"]')];

    expect(internal.length).toBeGreaterThan(0);
    for (const a of internal) {
      expect(a.getAttribute("target"), a.href).toBeNull();
      expect(a.querySelector('svg[data-icon="external"]'), a.href).toBeNull();
    }
  });
});

describe("D-141 a header menu is never a dead control", () => {
  /** Every built page whose header offers a menu button: how many links its menu lists. */
  async function menuLinks(siteDir: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const route of await htmlRoutes(siteDir)) {
      const doc = await readHtml(siteDir, `/${route}/`);
      if (doc.querySelector("button.ocx-header__menu")) counts.set(route, doc.querySelectorAll("#ocx-header-menu a").length);
    }
    return counts;
  }

  for (const name of ["root", "catalog"] as const) {
    it(`D-141 ${name}: a page with a menu button lists at least one link in it`, async () => {
      const counts = await menuLinks(site(name));

      expect(counts.size).toBeGreaterThan(5);
      expect([...counts].filter(([, links]) => links === 0)).toEqual([]);
    });
  }

  it("D-141 a neutral site with no nav, footer or docs still lists the catalog link behind its menu button", async () => {
    const project = await createProject();
    projects.push(project);
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);

    const doc = await readHtml(project.out, "/");

    expect(doc.querySelector("button.ocx-header__menu")).not.toBeNull();
    expect([...doc.querySelectorAll("#ocx-header-menu a")].map((a) => a.getAttribute("href"))).toEqual(["/"]);
  });
});

describe("D-126 the active header link is the longest matching prefix", () => {
  const DOCS_NAV = [
    { text: "Docs", link: "/docs/" },
    { text: "Reference", link: "/docs/reference/" },
    { text: "guide", link: "/docs/guide" },
    { text: "guides", link: "/docs/guides/" },
  ];
  const current = (doc: Document) =>
    [...doc.querySelectorAll('nav.ocx-header__nav a[aria-current="page"]')].map((a) => a.getAttribute("href"));

  async function nestedSite(): Promise<string> {
    const project = await createProject(
      { docs: "./docs", docsNav: DOCS_NAV },
      {
        "docs/index.md": "# Docs\n",
        "docs/reference/cli.md": "# CLI\n",
        "docs/guide.md": "# Guide\n",
        "docs/guides/sub.md": "# Sub\n",
      },
    );
    projects.push(project);
    const result = await runBuild(project.config, project.out);
    expect(result.code, result.stderr).toBe(0);
    return project.out;
  }

  it("D-126 a nested docsNav entry beside its parent: only the deeper one is current, then only the parent", async () => {
    const out = await nestedSite();

    expect(current(await readHtml(out, "/docs/reference/cli/"))).toEqual(["/docs/reference/"]);
    expect(current(await readHtml(out, "/docs/"))).toEqual(["/docs/"]);
  });

  it("D-126 '/docs/guide' and '/docs/guides/' both prefix /docs/guides/sub/: only the longer one is current", async () => {
    const out = await nestedSite();

    expect(current(await readHtml(out, "/docs/guides/sub/"))).toEqual(["/docs/guides/"]);
  });

  it("D-126 the mobile menu marks the same single link", async () => {
    const out = await nestedSite();
    const doc = await readHtml(out, "/docs/reference/cli/");

    expect([...doc.querySelectorAll('#ocx-header-menu a[aria-current="page"]')].map((a) => a.getAttribute("href"))).toEqual(["/docs/reference/"]);
  });
});

/** Every stylesheet the root build ships, joined. */
async function builtCss(): Promise<string> {
  const dir = join(site("root"), "_astro");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".css"));
  return (await Promise.all(names.map((name) => readFile(join(dir, name), "utf8")))).join("\n");
}

describe("D-162 D-164 the theme's typography and motion contract, as built", () => {
  it("D-162: only the 400 and 600 faces of Plex sans and mono are shipped; medium resolves to 400 and bold to 600", async () => {
    const css = await builtCss();
    const plex = [...css.matchAll(/@font-face\{[^}]*font-family:IBM Plex (?:Sans|Mono)[^}]*\}/g)].map((m) => /font-weight:(\d+)/.exec(m[0])?.[1]);
    expect(plex.length).toBeGreaterThan(0);
    expect(new Set(plex)).toEqual(new Set(["400", "600"]));
    expect(css).toMatch(/--ocx-font-weight-medium:400[;}]/);
    expect(css).toMatch(/--ocx-font-weight-bold:600[;}]/);
  });

  it("D-164: under prefers-reduced-motion the --ocx-duration-* tokens are zeroed in the stylesheet", async () => {
    const reduce = /@media \(prefers-reduced-motion:reduce\)\{:root,:root\[data-theme\]\{([^}]*)\}/.exec(await builtCss());
    expect(reduce, "a reduced-motion block over :root").not.toBeNull();
    for (const token of ["fast", "enter", "base", "moderate", "slow", "shimmer"]) expect(reduce![1]).toContain(`--ocx-duration-${token}:0s`);
  });
});
