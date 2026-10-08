/**
 * Dev/build parity (C-006, C-023, C-024, S-004): ONE `root` config run through
 * `ocx-catalog build` (the harness's `site("root")`) and through a live
 * `ocx-catalog dev` over a tmp copy of the same inputs, compared over real HTTP.
 *
 * Same routes, same chrome and footer, same docs pages, same `publicDir`,
 * same bytes for `_headers` and `catalog.json` and for every other file the
 * build copies out of the wire tree. The 0.5.x `dev` omitted `catalog.json`
 * (and `_headers`); here both come out of the one `emitCatalogTree` call, so a
 * divergence is a failing byte compare, not a surprise. HTML is compared on
 * what a reader and a crawler see (landmarks, links, head metadata, `<main>`
 * text) because the two renderers legitimately differ in asset URLs and in
 * where styles are injected.
 *
 * The fixture is `base: "/"`; the base-prefixed `_headers` rules (C-006) are
 * proven against `catalog`/`rootbase` in `dev.test.ts` and `base_containment`.
 * Run: `ACCEPT_CONFIG=root npx vitest run test/acceptance/dev_parity.test.ts`.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freePort, get, startDev, until, type Session } from "./dev_session.js";
import { FIXTURE_DIR, htmlRoutes, listTree, site } from "./helpers.js";

/** What a visitor and a crawler get from a page, minus asset URLs and inline script/style. */
function summary(html: string) {
  const doc = new JSDOM(html).window.document;
  const links = (selector: string) =>
    [...doc.querySelectorAll(`${selector} a[href]`)].map(
      (a) => `${(a.textContent ?? "").replace(/\s+/g, " ").trim()} -> ${a.getAttribute("href")}`,
    );
  const main = doc.querySelector("main");
  main?.querySelectorAll("script, style, template").forEach((el) => el.remove());
  return {
    title: doc.title,
    landmarks: [...doc.querySelectorAll("header, nav, main, aside, footer")].map((el) => `${el.tagName}.${el.className}`),
    header: links("header"),
    footer: links("footer"),
    sidebar: links("aside, nav.docs-sidebar"),
    head: [...doc.querySelectorAll("head meta[name], head meta[property], head link[rel=icon], head link[rel=canonical]")].map(
      (el) => el.outerHTML,
    ),
    // Theme components number their ids per render (`ocx-ui-dialog-5`), and a dev server's counter keeps counting across requests.
    headings: [...doc.querySelectorAll("h1, h2, h3")].map(
      (el) => `${el.tagName} ${el.id.replace(/-\d+:/, "-N:")} ${el.textContent?.trim()}`,
    ),
    main: (main?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
}

const routeUrl = (route: string): string => (route === "" ? "/" : `/${route}/`);

describe("dev serves what build builds (root fixture)", () => {
  let root: string;
  let docsFile: string;
  let session: Session;
  let origin: string;
  let dist: string;

  const page = async (route: string): Promise<string> => {
    const reply = await get(`${origin}${routeUrl(route)}`);
    expect(reply.status, `dev ${routeUrl(route)}`).toBe(200);
    return reply.body;
  };
  const built = (route: string): Promise<string> => readFile(join(dist, route === "" ? "" : route, "index.html"), "utf8");

  beforeAll(async () => {
    dist = site("root");
    root = await realpath(await mkdtemp(join(tmpdir(), "ocx-accept-parity-")));
    const project = join(root, "proj");
    await mkdir(project, { recursive: true });
    for (const name of ["index-a", "docs-fixture", "public-fixture", "root.config.json"]) {
      await cp(join(FIXTURE_DIR, name), join(project, name), { recursive: true });
    }
    docsFile = join(project, "docs-fixture", "guide", "getting-started.md");
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    session = startDev(join(project, "root.config.json"), port);
    await until("the banner", session, () => (session.stdout().includes("serving") ? true : undefined));
  }, 120_000);

  afterAll(async () => {
    if (session !== undefined && session.child.exitCode === null) session.child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  });

  it("answers 200 on every route the build emits, and 404 off them", async () => {
    const routes = ["", ...(await htmlRoutes(dist))];
    expect(routes.length).toBeGreaterThan(25); // control: landing, package details and the docs mount, not a stub

    for (const route of routes) await page(route);

    expect((await get(`${origin}/no/such/package/`)).status).toBe(404);
  });

  it("renders the same chrome, footer, head metadata and content on the landing, a detail page and a docs page", async () => {
    for (const route of ["", "tools/modern", "docs/guide/getting-started"]) {
      expect(summary(await page(route)), route || "/").toEqual(summary(await built(route)));
    }
    // Control: the summary sees the chrome it is meant to compare.
    const landing = summary(await built(""));
    expect(landing.footer).toContain("Index -> https://index.ocx.sh");
    expect(landing.header).toContain("Guide -> /docs/guide/getting-started/");
  });

  it("renders every docs page the same", async () => {
    const docs = (await htmlRoutes(dist)).filter((route) => route.startsWith("docs/"));
    expect(docs.length).toBeGreaterThan(2);

    for (const route of docs) expect(summary(await page(route)), route).toEqual(summary(await built(route)));
  });

  it("serves every non-HTML file of the build byte for byte: publicDir, _headers, catalog.json, the wire mirror", async () => {
    const files = (await listTree(dist)).filter(
      (path) => !path.endsWith(".html") && !path.startsWith("_astro/") && !path.startsWith("sitemap-"),
    );
    // Control: each class named in the title is in the compared set.
    for (const expected of ["_headers", "data/catalog/catalog.json", "favicon.svg", "robots.txt", "config.json"]) {
      expect(files).toContain(expected);
    }
    expect(files.some((path) => path.startsWith("p/"))).toBe(true);

    const mismatched: string[] = [];
    for (const path of files) {
      const response = await fetch(`${origin}/${path}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status !== 200 || !bytes.equals(await readFile(join(dist, path)))) mismatched.push(path);
    }

    expect(mismatched).toEqual([]);
  });

  it("serves an edited docs file without a restart", async () => {
    const pid = session.child.pid;
    const marker = "Edited while the dev server was running.";
    expect((await page("docs/guide/getting-started")).includes(marker)).toBe(false);

    await writeFile(docsFile, `${await readFile(docsFile, "utf8")}\n${marker}\n`);

    await until("the edited docs page", session, async () => {
      const reply = await get(`${origin}/docs/guide/getting-started/`);
      return reply.status === 200 && reply.body.includes(marker) ? true : undefined;
    });
    expect(session.child.pid).toBe(pid);
    expect(session.child.exitCode).toBeNull();
  });
});
