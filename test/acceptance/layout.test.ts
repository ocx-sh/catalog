/**
 * C-004 output layout, asserted on built sites (S-001): `index.html`,
 * `404.html`, `<route>/index.html`, `data/catalog/catalog.json`,
 * `index/<label>/**`, `_headers`, `publicDir`, `brand.logo`, sitemap and
 * default `robots.txt` only with `siteUrl` (a `publicDir` `robots.txt` wins),
 * every favicon `href` resolving to a file, mirrored files byte-equal, the same
 * path set for base `/` and `/catalog/`, and the mirror never overwriting an
 * existing output path (except `catalog.json`).
 *
 * Needs the `root`, `rootbase` and `catalog` sites (`ACCEPT_CONFIG` unset).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProject,
  FIXTURE_DIR,
  htmlRoutes,
  listTree,
  normalizeAssetPath,
  readHtml,
  runBuild,
  site,
  type Project,
  type SiteName,
} from "./helpers.js";

const BASE: Readonly<Record<SiteName, string>> = { root: "/", rootbase: "/catalog/", catalog: "/catalog/" };

const DOCS_ROUTES: Readonly<Record<SiteName, readonly string[]>> = {
  root: ["docs", "docs/guide", "docs/guide/getting-started", "docs/guide/install", "docs/reference/cli"],
  rootbase: ["docs", "docs/guide", "docs/guide/getting-started", "docs/guide/install", "docs/reference/cli"],
  catalog: [],
};

interface CatalogJson {
  readonly indexes: readonly { readonly name: string; readonly root: boolean }[];
  readonly packages: readonly { readonly name: string }[];
}

/** The routes a catalog must render: bare for the root source, `<label>/<ns>/<pkg>` otherwise. */
async function expectedRoutes(siteDir: string): Promise<string[]> {
  const catalog = JSON.parse(await readFile(join(siteDir, "data/catalog/catalog.json"), "utf8")) as CatalogJson;
  const rootLabel = catalog.indexes.find((index) => index.root)?.name;
  return catalog.packages
    .map((pkg) => (rootLabel !== undefined && pkg.name.startsWith(`${rootLabel}/`) ? pkg.name.slice(rootLabel.length + 1) : pkg.name))
    .sort();
}

describe("C-004 layout of the fixture sites", () => {
  it.each(["root", "rootbase", "catalog"] as const)("%s: the fixed files exist and every package has a route page", async (name) => {
    const dir = site(name);
    const files = await listTree(dir);

    for (const path of [
      "index.html",
      "404.html",
      "_headers",
      "config.json",
      "data/catalog/catalog.json",
      "robots.txt",
      "sitemap-index.xml",
      "sitemap-0.xml",
    ]) {
      expect(files, `${name}: ${path}`).toContain(path);
    }
    expect(files.some((path) => path.startsWith("index/index-a/p/"))).toBe(true);
    expect(files.some((path) => path.startsWith("p/"))).toBe(true);

    const routes = await expectedRoutes(dir);
    expect(routes.length).toBeGreaterThanOrEqual(24);
    // Package routes and docs routes are compared separately: `docs/**` pages
    // exist exactly when the config sets `docs` (root and rootbase do).
    const rendered = await htmlRoutes(dir);
    const isDocs = (route: string) => route === "docs" || route.startsWith("docs/");
    expect(rendered.filter((route) => !isDocs(route))).toEqual(routes);
    expect(rendered.filter(isDocs).sort()).toEqual([...DOCS_ROUTES[name]].sort());
  });

  it("catalog: a non-root source's packages render under their label, the root source's bare", async () => {
    const routes = await htmlRoutes(site("catalog"));
    expect(routes).toContain("cloud/helm-lite");
    expect(routes).toContain("index-b/hostile/metadata");
    expect(routes).not.toContain("index-a/cloud/helm-lite");
  });

  it("the path set is identical for base / and /catalog/ once _astro hashes are normalised", async () => {
    const [atRoot, atBase] = await Promise.all([listTree(site("root")), listTree(site("rootbase"))]);
    expect(atBase.map(normalizeAssetPath)).toEqual(atRoot.map(normalizeAssetPath));
    // The comparison must not be vacuous: hashed assets exist and really are normalised.
    expect(atRoot.some((path) => path.startsWith("_astro/"))).toBe(true);
    expect(atRoot.map(normalizeAssetPath).some((path) => /^_astro\/[^/]+\.[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(path))).toBe(false);
  });

  /** Every `<link rel~=icon>` of the home, 404 and a detail page names a file the site ships. */
  async function expectFaviconsResolve(name: SiteName): Promise<void> {
    const dir = site(name);
    const base = BASE[name];
    const files = new Set(await listTree(dir));
    for (const page of ["/", "/404.html", "/cloud/helm-lite/"]) {
      const document = await readHtml(dir, page);
      const hrefs = [...document.querySelectorAll("link[rel~='icon']")].map((link) => link.getAttribute("href") ?? "");
      expect(hrefs.length, `${name} ${page}: an icon link`).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href.startsWith(base), `${name} ${page}: ${href} starts with ${base}`).toBe(true);
        expect(files, `${name} ${page}: ${href}`).toContain(href.slice(base.length));
      }
    }
  }

  it.each(["root", "rootbase"] as const)("%s: every favicon href resolves to a file under the base", expectFaviconsResolve);

  // The theme Shell links `<base>favicon.svg` under `chrome: "ocx"` and ships no file
  // there; `assemblePublic` copies the theme's exported logo when the consumer has none.
  it("catalog (chrome ocx): every favicon href resolves to a file under the base", () => expectFaviconsResolve("catalog"));

  it("root and rootbase: the consumer robots.txt wins over the default one", async () => {
    const consumer = await readFile(join(FIXTURE_DIR, "public-fixture/robots.txt"));
    expect(consumer.toString()).toContain("Sitemap: https://fixture.ocx.test/sitemap.xml");
    for (const name of ["root", "rootbase"] as const) {
      expect(Buffer.compare(await readFile(join(site(name), "robots.txt")), consumer), name).toBe(0);
    }
  });

  it("catalog: no publicDir, so the default robots.txt points at the base-prefixed sitemap", async () => {
    const robots = await readFile(join(site("catalog"), "robots.txt"), "utf8");
    expect(robots).toBe("User-agent: *\nAllow: /\n\nSitemap: https://fixture.ocx.test/catalog/sitemap-index.xml\n");
    expect(await readFile(join(site("catalog"), "sitemap-index.xml"), "utf8")).toContain("https://fixture.ocx.test/catalog/sitemap-0.xml");
  });

  it("root: mirrored wire files are byte-equal at the root and under index/<label>/", async () => {
    const dir = site("root");
    const sourceDir = join(FIXTURE_DIR, "index-a");
    const wireFiles = await listTree(sourceDir);
    expect(wireFiles.length).toBeGreaterThan(50);
    for (const path of wireFiles) {
      const original = await readFile(join(sourceDir, path));
      expect(Buffer.compare(await readFile(join(dir, path)), original), `/${path}`).toBe(0);
      expect(Buffer.compare(await readFile(join(dir, "index/index-a", path)), original), `/index/index-a/${path}`).toBe(0);
    }
  });

  it("root: publicDir files are copied byte-equal", async () => {
    const favicon = await readFile(join(FIXTURE_DIR, "public-fixture/favicon.svg"));
    expect(Buffer.compare(await readFile(join(site("root"), "favicon.svg")), favicon)).toBe(0);
  });
});

describe("C-004 inputs that change the layout (own builds)", () => {
  const projects: Project[] = [];
  afterEach(async () => {
    await Promise.all(projects.splice(0).map((project) => project.dispose()));
  });

  async function project(extra: Record<string, unknown>, files: Record<string, string> = {}): Promise<Project> {
    const created = await createProject(extra, files);
    projects.push(created);
    return created;
  }

  it("brand.logo lands at its basename; with no siteUrl there is no sitemap and no robots.txt", async () => {
    const logo = await readFile(join(FIXTURE_DIR, "../quality-index/brand/logo.svg"), "utf8");
    const p = await project({ brand: { title: "T", wordmark: "t", logo: "./brand/logo.svg" } }, { "brand/logo.svg": logo });

    const result = await runBuild(p.config, p.out);
    expect(result.code, result.stderr).toBe(0);

    const files = await listTree(p.out);
    expect(await readFile(join(p.out, "logo.svg"), "utf8")).toBe(logo);
    expect(files).not.toContain("robots.txt");
    expect(files.some((path) => path.startsWith("sitemap"))).toBe(false);
  });

  it("the mirror never overwrites a publicDir file: a consumer _headers fails the build and writes no output", async () => {
    const p = await project({ publicDir: "./public" }, { "public/_headers": "/*\n  X-Consumer: 1\n" });

    const result = await runBuild(p.config, p.out);

    expect(result.code).toBe(65);
    expect(result.stderr).toContain('refusing to overwrite "_headers"');
    expect(result.stderr).toContain("remove it from publicDir");
    expect(result.stderr).not.toContain("    at ");
    expect(await readdir(p.root)).toEqual(["proj"]);
  });

  it("brand.logo never overwrites a same-named publicDir file: the build fails with exit 65 and writes no output", async () => {
    const p = await project(
      { publicDir: "./public", brand: { title: "T", logo: "./brand/mark.svg" } },
      { "public/mark.svg": "<svg>consumer</svg>", "brand/mark.svg": "<svg>logo</svg>" },
    );

    const result = await runBuild(p.config, p.out);

    expect(result.code).toBe(65);
    expect(result.stderr).toContain('brand.logo "./brand/mark.svg"');
    expect(await readdir(p.root)).toEqual(["proj"]);
  });

  it("catalog.json is the one mirrored path that replaces a publicDir file: the merged catalog wins", async () => {
    const consumer = '{"consumer":true}';
    const p = await project({ publicDir: "./public" }, { "public/data/catalog/catalog.json": consumer });

    const result = await runBuild(p.config, p.out);

    expect(result.code, result.stderr).toBe(0);
    const built = await readFile(join(p.out, "data/catalog/catalog.json"), "utf8");
    expect(built).not.toBe(consumer);
    expect((JSON.parse(built) as CatalogJson).packages.length).toBe(7);
  });
});
