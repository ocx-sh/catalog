#!/usr/bin/env node
/**
 * Interaction gates (G.2; C-011, C-043, S-006, S-021), measured in a real
 * browser over the built fixture sites. jsdom runs no layout, no CSP and no
 * network, so none of these can be proven there.
 *
 * Builds the `root` (base `/`) and `catalog` (base `/catalog/`, `ocx` chrome)
 * fixture sites with the shipped CLI, serves each from a tiny static server
 * that logs every request, and asserts, per site:
 *
 *   - before any pointer / focus / touch: no request for `catalog.json`, and
 *     none for an island chunk (what the grid, palette and versions scripts
 *     reach through a dynamic `import()`, minus the page's own static graph),
 *     on the landing page and on a detail page;
 *   - the first interaction (each of the three kinds, on fresh pages) loads
 *     the island and fetches `catalog.json` exactly once on the landing page;
 *     on a detail page it loads the versions island and never fetches it;
 *   - a state-bearing cold URL (`?q=`) boots at load, fetches `catalog.json`
 *     once without any interaction, and shifts nothing (CLS 0);
 *   - the palette is lazy, `Mod+K` opens it, and a query reaches a package;
 *   - the grid's "+N more" popover still opens after the lazy mount;
 *   - no CSP violation (`securitypolicyviolation` event, console message) and
 *     no failed request on any page of the site, interacted with or not.
 *
 * Every assertion has a control that proves its red state is reachable (the
 * interaction DOES load chunks; the cold URL DOES fetch), so a silent
 * "nothing happened" cannot read as green.
 *
 * Usage: CHROME_PATH=<chrome> node scripts/quality-interaction.mjs [--site root|catalog]
 * Needs `dist/` (npm run build). Heavy: one browser, one page at a time.
 */
/* The page.evaluate callbacks below are serialised and run inside Chrome, so
   their identifiers resolve against the browser, not Node. */
/* global document, window, location, getComputedStyle */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOG_JSON = "/data/catalog/catalog.json";
const SETTLE_MS = 700;

const { values } = parseArgs({ options: { site: { type: "string" } } });
const SITES = [
  { name: "root", base: "/" },
  { name: "catalog", base: "/catalog/" },
].filter((site) => values.site === undefined || values.site === site.name);
if (SITES.length === 0) {
  console.error(`--site ${JSON.stringify(values.site)}: expected root or catalog`);
  process.exit(64);
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};

/** Serves `dir` under `base` on loopback and logs every request: `{ path, status }`. */
function serve(dir, base) {
  const log = [];
  const server = createServer(async (req, res) => {
    const path = decodeURI(new URL(req.url, "http://x").pathname);
    let status = 200;
    let body;
    let type = "text/html";
    try {
      if (!path.startsWith(base)) throw new Error("outside the base");
      let file = path.slice(base.length);
      if (file === "" || file.endsWith("/")) file += "index.html";
      if (file.split("/").includes("..")) throw new Error("traversal");
      body = await readFile(join(dir, file));
      type = MIME[extname(file)] ?? "application/octet-stream";
    } catch {
      status = 404;
      body = await readFile(join(dir, "404.html")).catch(() => "not found");
    }
    log.push({ path, status });
    res.writeHead(status, { "content-type": type });
    res.end(body);
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done({ server, log, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

/** Real directory owning `node_modules`: where the CLI's scratch root can resolve `astro` (worktree-safe). */
const cliCwd = async () => dirname(await realpath(join(ROOT, "node_modules")));

async function build(name, out) {
  execFileSync(
    process.execPath,
    [join(ROOT, "dist/cli/index.js"), "build", "--config", join(ROOT, "test/fixtures/site", `${name}.config.json`), "--out", out],
    { cwd: await cliCwd(), stdio: "pipe", encoding: "utf8" },
  );
}

const STATIC_IMPORT = /(?:from|import)\s*["'`]\.\/([^"'`/]+\.js)["'`]/g;
const DYNAMIC_IMPORT = /import\(\s*["'`]\.\/([^"'`/]+\.js)["'`]/g;
const PRELOAD_LIST = /["']_astro\/([^"'/]+\.js)["']/g;

/** `files` plus everything they import statically, transitively. */
async function closure(dist, files) {
  const seen = new Set();
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await readFile(join(dist, "_astro", file), "utf8").catch(() => "");
    for (const m of code.matchAll(STATIC_IMPORT)) queue.push(m[1]);
  }
  return seen;
}

/**
 * The chunks OUR islands load on demand: the targets of the dynamic `import()` in the grid, palette and
 * versions entry scripts (and the preload list Vite attaches to each), with their static dependencies.
 * Derived from the build, not from a name list, so a new lazy import is covered without an edit here.
 */
async function islandChunks(dist) {
  const dir = join(dist, "_astro");
  const entries = (await readdir(dir)).filter((n) => /^(CatalogGrid|Palette|VersionList)\.astro_astro_type_script.*\.js$/.test(n));
  const targets = new Set();
  for (const name of entries) {
    const code = await readFile(join(dir, name), "utf8");
    for (const m of code.matchAll(DYNAMIC_IMPORT)) targets.add(m[1]);
    for (const m of code.matchAll(PRELOAD_LIST)) targets.add(m[1]);
  }
  return closure(dist, targets);
}

/**
 * The page's own static JS graph: the module scripts and modulepreloads in the HTML as built (not the live DOM,
 * where Vite's preload helper adds `modulepreload` links for whatever a script imports at run time), with
 * their static imports.
 */
async function eagerChunks(dist, base, page) {
  const pathname = new URL(page.url()).pathname.slice(base.length);
  const html = await readFile(join(dist, pathname, "index.html"), "utf8");
  const urls = [
    ...html.matchAll(/<script[^>]*type="module"[^>]*\ssrc="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*\shref="([^"]+)"/g),
  ].map((m) => m[1].split("/").pop());
  return closure(dist, urls);
}

const failures = [];
const rows = [];
/**
 * `knownGap` marks a check that fails today because of a recorded library gap: it is reported as XFAIL
 * and does not fail the run, but the day it passes it FAILS ("unexpected pass") so the mark is removed.
 */
function check(site, name, ok, detail = "", knownGap = undefined) {
  const unexpected = knownGap !== undefined && ok;
  const verdict = knownGap !== undefined && !ok ? "XFAIL" : ok && !unexpected ? "PASS" : "FAIL";
  const tail = unexpected
    ? "unexpected pass: the library gap is closed, drop knownGap"
    : [detail, knownGap].filter(Boolean).join("; ");
  const row = `${verdict}  [${site}] ${name}${tail ? `  (${tail})` : ""}`;
  rows.push(row);
  console.log(row);
  if (verdict === "FAIL") failures.push(`[${site}] ${name}${tail ? `: ${tail}` : ""}`);
}

/** A measurement reported on its own line and never asserted. */
function info(site, name, detail) {
  const row = `INFO  [${site}] ${name}  (${detail})`;
  rows.push(row);
  console.log(row);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const jsRequests = (log) => log.filter((r) => r.path.endsWith(".js")).map((r) => r.path.split("/").pop());
const catalogRequests = (log, base) => log.filter((r) => r.path === `${base}${CATALOG_JSON.slice(1)}`).length;

/** A fresh page that records CSP violations, console errors, uncaught errors and layout shifts. */
async function newPage(browser, { touch = false, blockFonts = false } = {}) {
  const page = await browser.newPage();
  if (blockFonts) {
    // Web fonts arriving after first paint reflow text whatever the island does; blocked, a shift is the page's own.
    await page.setRequestInterception(true);
    page.on("request", (req) => (/\.woff2?$/.test(new URL(req.url()).pathname) ? req.abort() : req.continue()));
  }
  if (touch) await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1280, height: 900 });
  const problems = [];
  page.on("console", (msg) => {
    // A failed load is covered by the server log for our own origin; a README may legitimately point at a third party.
    const text = msg.text();
    if ((msg.type() === "error" && !/^Failed to load resource/.test(text)) || /content security policy/i.test(text)) {
      problems.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
    );
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { page, problems };
}

async function violations({ page, problems }) {
  return [...(await page.evaluate(() => window.__csp)), ...problems];
}

async function open(ctx, origin, path, log) {
  log.length = 0;
  await ctx.page.goto(`${origin}${path}`, { waitUntil: "networkidle0" });
  await sleep(SETTLE_MS);
}

/** Every `<dir>/index.html` route of the built site, as URL paths under `base`. */
async function routes(dist, base) {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name === "index.html")
    .map((e) => join(e.parentPath, e.name).slice(dist.length + 1, -"index.html".length))
    .filter((p) => !/^(p|index|data|_astro)\//.test(p))
    .map((p) => `${base}${p}`)
    .sort();
}

async function runSite(browser, site, dist) {
  const { name, base } = site;
  const { server, log, origin } = await serve(dist, base);
  const island = await islandChunks(dist);
  check(name, "control: the build has island chunks to watch", island.size > 0, `${island.size} found`);
  /** JS requested so far that is an island chunk outside the page's own static graph. */
  const islandRequests = (eager) => jsRequests(log).filter((f) => island.has(f) && !eager.has(f));
  /** JS requested so far that the page's HTML does not reach statically. */
  const offGraph = (eager) => jsRequests(log).filter((f) => !eager.has(f));
  const grid = "[data-grid]";
  const mark = (message, ctx) => violations(ctx).then((bad) => check(name, message, bad.length === 0, bad.join(" | ")));
  try {
    // --- landing: nothing before interaction, then each kind of first interaction -------------------
    const interactions = {
      pointer: async ({ page }) => page.hover(`${grid} a[data-card]`),
      focus: async ({ page }) => page.focus(`${grid} input[type="search"]`),
      touch: async ({ page }) => (await page.$(`${grid} input[type="search"]`)).tap(),
      // A real Tab press, repeated until focus enters the grid: the key is how a keyboard user arrives.
      key: async ({ page }) => {
        for (let presses = 0; presses < 40; presses += 1) {
          await page.keyboard.press("Tab");
          if (await page.evaluate(() => !!document.activeElement?.closest("[data-grid]"))) return;
        }
        throw new Error("40 Tab presses never moved focus into the grid");
      },
    };
    for (const [kind, act] of Object.entries(interactions)) {
      const ctx = await newPage(browser, { touch: kind === "touch", blockFonts: true });
      await open(ctx, origin, base, log);
      const eager = await eagerChunks(dist, base, ctx.page);
      check(name, `landing, before ${kind}: no catalog.json request`, catalogRequests(log, base) === 0, `${catalogRequests(log, base)}`);
      check(name, `landing, before ${kind}: no island chunk`, islandRequests(eager).length === 0, islandRequests(eager).join(", "));
      check(name, `landing, before ${kind}: the island is idle`, (await ctx.page.$eval(grid, (el) => el.dataset.zagState ?? "idle")) === "idle");
      if (kind === "pointer") {
        check(name, "landing, before any interaction: no JS beyond the page's static graph", offGraph(eager).length === 0, offGraph(eager).join(", "));
      }

      await act(ctx);
      await ctx.page.waitForSelector(`${grid}[data-zag-state="live"]`, { timeout: 10_000 });
      await ctx.page.waitForFunction(() => document.querySelector("[data-grid-count]").textContent.length > 0);
      await sleep(SETTLE_MS);
      check(name, `landing, first ${kind}: the island loads its chunk (control)`, islandRequests(eager).length > 0, islandRequests(eager).join(", "));
      check(name, `landing, first ${kind}: catalog.json fetched exactly once`, catalogRequests(log, base) === 1, `${catalogRequests(log, base)}`);
      if (kind !== "touch") {
        const cls = await ctx.page.evaluate(() => window.__cls);
        check(name, `landing, first ${kind}: the island taking over shifts nothing (CLS 0)`, cls === 0, `${cls}`);
      }
      await mark(`landing, ${kind}: no CSP violation or console error`, ctx);
      await ctx.page.close();
    }

    // --- landing: what web fonts arriving after first paint cost (the theme's, not asserted) ----------
    {
      const ctx = await newPage(browser);
      await open(ctx, origin, base, log);
      info(name, "landing load with web fonts: CLS", `${await ctx.page.evaluate(() => window.__cls)}`);
      await ctx.page.close();
    }

    // --- landing: the "+N more" popover after the lazy mount --------------------------------------
    {
      const ctx = await newPage(browser);
      await open(ctx, origin, base, log);
      await ctx.page.hover(`${grid} a[data-card]`);
      await ctx.page.waitForSelector(`${grid}[data-zag-state="live"]`, { timeout: 10_000 });
      await ctx.page.waitForSelector("[data-grid-more]:not([hidden])", { timeout: 5_000 }).catch(() => {});
      const shown = (await ctx.page.$("[data-grid-more]:not([hidden])")) !== null;
      check(name, `popover: "+N more" is shown once the grid is live (control)`, shown);
      if (shown) {
        await ctx.page.click("[data-grid-more] [data-part='trigger']");
        const opened = await ctx.page
          .waitForFunction(
            () => {
              const content = document.querySelector("[data-grid-more] [data-part='content']");
              return content && content.dataset.state === "open" && getComputedStyle(content).visibility !== "hidden";
            },
            { timeout: 5_000 },
          )
          .then(() => true, () => false);
        const chips = opened ? await ctx.page.$$eval("[data-grid-more-list] button", (b) => b.length) : 0;
        check(name, `popover: "+N more" opens after the lazy mount and lists the vocabulary`, opened && chips > 0, `open=${opened} chips=${chips}`);
      }
      await ctx.page.close();
    }

    // --- landing: a state-bearing cold URL boots at load, without a shift -------------------------
    for (const [search, viewport] of [
      ["?q=modern", "desktop"],
      ["?sort=name", "desktop"],
      ["?view=table", "desktop"],
      ["?q=modern", "mobile"],
    ]) {
      const label = `cold URL ${search} (${viewport})`;
      const ctx = await newPage(browser, { touch: viewport === "mobile", blockFonts: true });
      await open(ctx, origin, `${base}${search}`, log);
      check(name, `${label}: catalog.json fetched at load, exactly once`, catalogRequests(log, base) === 1, `${catalogRequests(log, base)}`);
      check(name, `${label}: the island is live without an interaction`, (await ctx.page.$eval(grid, (el) => el.dataset.zagState)) === "live");
      const skeletonHidden = await ctx.page.$eval("[data-grid-skeleton]", (el) => el.hidden);
      check(name, `${label}: the skeleton is gone once loaded`, skeletonHidden);
      const cls = await ctx.page.evaluate(() => window.__cls);
      check(name, `${label}: CLS is 0`, cls === 0, `${cls}`);
      if (search === "?q=modern" && viewport === "desktop") {
        const query = await ctx.page.$eval(`${grid} input[type="search"]`, (el) => el.value);
        check(name, `${label}: the search field shows the query`, query === "modern", query);
        await mark(`${label}: no CSP violation or console error`, ctx);
      }
      await ctx.page.close();
    }

    // --- detail: nothing before interaction; the versions island loads on it, never catalog.json ----
    {
      const landing = await newPage(browser);
      await open(landing, origin, base, log);
      const detailPath = await landing.page.$eval(`${grid} a[data-card]`, (a) => new URL(a.href).pathname);
      await landing.page.close();
      const ctx = await newPage(browser);
      await open(ctx, origin, detailPath, log);
      const eager = await eagerChunks(dist, base, ctx.page);
      check(name, "detail, before interaction: no island chunk", islandRequests(eager).length === 0, islandRequests(eager).join(", "));
      check(name, "detail, before interaction: no JS beyond the page's static graph", offGraph(eager).length === 0, offGraph(eager).join(", "));
      check(name, "detail, before interaction: no catalog.json request", catalogRequests(log, base) === 0);
      await ctx.page.hover("[data-versions]");
      await ctx.page.waitForSelector('[data-versions][data-zag-state="live"]', { timeout: 10_000 });
      await sleep(SETTLE_MS);
      check(name, "detail, first interaction: the versions island loads its chunk (control)", islandRequests(eager).length > 0, islandRequests(eager).join(", "));
      check(name, "detail, after interaction: still no catalog.json request", catalogRequests(log, base) === 0);
      await mark("detail: no CSP violation or console error", ctx);
      await ctx.page.close();
    }

    // --- palette: lazy, Mod+K opens it, a query reaches a package -----------------------------------
    {
      const ctx = await newPage(browser);
      await open(ctx, origin, base, log);
      const eager = await eagerChunks(dist, base, ctx.page);
      check(name, "palette, before Mod+K: no island chunk", islandRequests(eager).length === 0, islandRequests(eager).join(", "));
      check(name, "palette, before Mod+K: no catalog.json request", catalogRequests(log, base) === 0);
      await ctx.page.keyboard.down("Control");
      await ctx.page.keyboard.press("k");
      await ctx.page.keyboard.up("Control");
      const opened = await ctx.page
        .waitForFunction(
          () => {
            const content = document.querySelector(".ocx-palette [data-zag-root='dialog'] [data-part='content']");
            return content && content.dataset.state === "open";
          },
          { timeout: 10_000 },
        )
        .then(() => true, () => false);
      check(name, "palette: Mod+K opens the dialog", opened);
      await sleep(SETTLE_MS);
      check(name, "palette: opening it loads the island chunk (control)", islandRequests(eager).length > 0, islandRequests(eager).join(", "));
      check(name, "palette: opening it fetches catalog.json exactly once", catalogRequests(log, base) === 1, `${catalogRequests(log, base)}`);
      await ctx.page.keyboard.type("modern");
      const optionFor = () =>
        ctx.page.evaluateHandle(() => [...document.querySelectorAll(".ocx-palette [role='option']")].find((o) => /tools\/modern/.test(o.textContent)) ?? null);
      await ctx.page.waitForFunction(() => /tools\/modern/.test(document.querySelector(".ocx-palette [role='listbox']")?.textContent ?? ""), { timeout: 10_000 }).catch(() => {});
      const option = (await optionFor()).asElement();
      check(name, "palette: a query lists the matching package", option !== null);
      if (option) {
        await Promise.all([ctx.page.waitForNavigation({ timeout: 10_000 }).catch(() => {}), option.click()]);
        const landed = await ctx.page.evaluate(() => location.pathname);
        check(name, "palette: choosing the package navigates to it under the base", landed.startsWith(base) && landed.endsWith("/tools/modern/"), landed);
      }
      await mark("palette: no CSP violation or console error", ctx);
      await ctx.page.close();
    }

    // --- every page: loads clean (no CSP violation, no failed request) --------------------------------
    {
      const all = await routes(dist, base);
      const dirty = [];
      for (const path of all) {
        const ctx = await newPage(browser);
        await open(ctx, origin, path, log);
        const bad = await violations(ctx);
        const failed = log.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.path}`);
        if (bad.length > 0 || failed.length > 0) dirty.push(`${path}: ${[...bad, ...failed].join(" | ")}`);
        await ctx.page.close();
      }
      check(name, `all ${all.length} pages load without a CSP violation or a failed request`, all.length > 1 && dirty.length === 0, dirty.slice(0, 5).join(" || "));
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
}

async function main() {
  const puppeteer = (await import("puppeteer-core")).default;
  const chromePath = process.env.CHROME_PATH || undefined;
  const scratch = await mkdtemp(join(tmpdir(), "ocx-quality-interaction-"));
  let browser;
  try {
    browser = await puppeteer.launch({
      ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
      headless: true,
      args: ["--no-sandbox"],
    });
    for (const site of SITES) {
      const dist = resolve(scratch, site.name);
      await build(site.name, dist);
      await runSite(browser, site, dist);
    }
  } finally {
    await browser?.close();
    await rm(scratch, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} interaction gate(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${rows.length} interaction checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
