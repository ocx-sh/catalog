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
 *     on a detail page it mounts the versions copy menu and never fetches it;
 *   - a state-bearing cold URL (`?q=`) boots at load, fetches `catalog.json`
 *     once without any interaction, and shifts nothing (CLS 0);
 *   - the palette is lazy, `Mod+K` opens it, and a query reaches a package;
 *   - the grid's "+N more" popover still opens after the lazy mount;
 *   - the theme-port parity rows only a browser can tell (`parityChecks`): copy
 *     buttons and toasts (D-064, D-085, D-112, D-131, D-143, D-166), a missing
 *     clipboard (D-084), the version menu's right click (D-083), the colour
 *     scheme (D-127, D-132, D-133, D-134), the narrow header menu (D-141) and the
 *     base styles and tokens (D-161, D-163, D-168, D-169);
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
  const entries = (await readdir(dir)).filter((n) => /^(CatalogGrid|Palette|VersionList|CopyMenu)\.astro_astro_type_script.*\.js$/.test(n));
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
async function newPage(browser, { touch = false, blockFonts = false, origin = undefined } = {}) {
  // One context per page: the grid remembers a view or sort in web storage (D-170), and a shared context would hand
  // one gate's remembered choice to the next gate's "bare landing".
  const context = await browser.createBrowserContext();
  // A copy gate reads the clipboard back: the origin it serves from is granted both directions.
  if (origin !== undefined) await context.overridePermissions(origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await context.newPage();
  page.once("close", () => void context.close());
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

    // --- detail: nothing before interaction; the versions copy menu mounts on it, never catalog.json
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
      await sleep(SETTLE_MS);
      // Hover is a first input: the detail entry imports detail.js (and its static chunks) then. The copy menu's own chunks stay out.
      const detailScript = (await readdir(join(dist, "_astro"))).filter((n) => /^detail\..*\.js$/.test(n));
      const detailGraph = await closure(dist, detailScript);
      const menuRequests = islandRequests(eager).filter((f) => !detailGraph.has(f));
      check(name, "detail, hover: the copy menu stays unloaded until a tag is focused or right-clicked", menuRequests.length === 0, menuRequests.join(", "));
      await ctx.page.focus("[data-versions] button[data-tag]");
      await ctx.page.waitForSelector('[data-versions] [data-zag-root="copy-menu"][data-zag-state="live"]', { timeout: 10_000 });
      await sleep(SETTLE_MS);
      check(name, "detail, first interaction: the versions copy menu loads its chunk (control)", islandRequests(eager).length > 0, islandRequests(eager).join(", "));
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

    // --- chrome: the 404 block is centred between header and footer (D-128), the footer carries its stamp (D-136) ---
    {
      const ctx = await newPage(browser);
      await ctx.page.setViewport({ width: 1280, height: 1400 });
      await open(ctx, origin, `${base}404.html`, log);
      /** Distance between the centre of the 404 block (code to back link) and the centre of `<main>`, in px. */
      const offset = () =>
        ctx.page.evaluate(() => {
          const rect = (el) => el.getBoundingClientRect();
          const main = rect(document.querySelector("main"));
          const top = rect(document.querySelector(".not-found-code"));
          const bottom = rect(document.querySelector(".not-found-link"));
          return Math.abs((top.top + bottom.bottom) / 2 - (main.top + main.bottom) / 2);
        });
      const centred = await offset();
      check(name, "D-128 the 404 block is vertically centred in main on a tall viewport", centred <= 4, `${centred.toFixed(1)}px off`);
      const { main, footerGap } = await ctx.page.evaluate(() => ({
        main: document.querySelector("main").getBoundingClientRect().bottom,
        footerGap: document.querySelector(".ocx-shell__footer").getBoundingClientRect().top,
      }));
      check(name, "D-128 main fills the space down to the footer", Math.abs(main - footerGap) <= 1, `${main} vs ${footerGap}`);
      // Control: the page's own rule removed, the block sits at the top, so the measure above can go red.
      await ctx.page.addStyleTag({
        content: "main:has(> .not-found){display:block !important}.not-found{flex:none !important;min-block-size:0 !important}",
      });
      const uncentred = await offset();
      check(name, "D-128 control: without the rule the 404 block is not centred", uncentred > 40, `${uncentred.toFixed(1)}px off`);
      await mark("404: no CSP violation or console error", ctx);
      await ctx.page.close();
    }
    {
      const ctx = await newPage(browser);
      await open(ctx, origin, base, log);
      const footer = await ctx.page.$eval(".ocx-footer", (el) => el.textContent);
      const generated = await ctx.page.$eval('meta[name="ocx-generated"]', (el) => el.content).catch(() => null);
      check(name, "D-136 control: the page carries a generated timestamp", generated !== null, `${generated}`);
      check(name, "D-136 the footer shows its 'updated …' stamp", /updated (just now|\d+[mhd] ago)/.test(footer), footer.replace(/\s+/g, " ").trim());
      await ctx.page.close();
    }

    await parityChecks(browser, site, dist, origin, log);

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

/** Whether a toast titled exactly `title` is on screen within 5 s. */
const toastShown = (page, title) =>
  page
    .waitForFunction(
      (wanted) => [...document.querySelectorAll('[data-zag-root="toast"] [data-part="title"]')].some((el) => el.textContent === wanted),
      { timeout: 5_000 },
      title,
    )
    .then(() => true, () => false);
const readClipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
/** The clipboard once it holds something other than the marker, or the marker after 3 s. */
async function copiedText(page) {
  for (let waited = 0; waited < 3_000; waited += 100) {
    const text = await readClipboard(page);
    if (text !== "(nothing copied)") return text;
    await sleep(100);
  }
  return "(nothing copied)";
}
/** Puts a marker on the clipboard, so a copy that never happens cannot read as one. */
const clearClipboard = (page) => page.evaluate(() => navigator.clipboard.writeText("(nothing copied)"));
const storage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const scheme = (page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: document.documentElement.classList.contains("dark") }));
const prefersScheme = (page, value) => page.emulateMediaFeatures([{ name: "prefers-color-scheme", value }]);

/**
 * The behaviours the 0.5.x UI had that the theme now owns (D-xxx rows of `defects_ocx_theme_port.md`): copy feedback,
 * the version copy menu, the colour scheme, the header and the base styles. Only a browser can tell: a first paint, a
 * live OS scheme change, a focus-free right click, a toast, a computed style.
 */
async function parityChecks(browser, { name, base }, dist, origin, log) {
  const detailPath = `${base}tools/modern/`;
  const docsPath = `${base}docs/guide/getting-started/`;
  const hasDocs = await readdir(join(dist, "docs")).then(() => true, () => false);

  // --- copy: a README fence, a docs fence, the detail page's own copy targets, the toast ---------------
  await guarded(name, async () => {
    const ctx = await newPage(browser, { origin });
    await open(ctx, origin, detailPath, log);
    const fence = ".readme-content pre";
    const buttons = await ctx.page.$$eval(`${fence} button.ocx-prose-copy`, (b) => b.length);
    const fences = await ctx.page.$$eval(fence, (p) => p.length);
    check(name, "D-064 control: the README has code fences", fences > 0, `${fences}`);
    check(name, "D-064 every README code fence carries a 'Copy code' button", buttons === fences, `${buttons} of ${fences}`);
    const code = await ctx.page.$eval(`${fence} code`, (el) => el.textContent.replace(/\n$/, ""));
    await clearClipboard(ctx.page);
    await ctx.page.click(`${fence} button.ocx-prose-copy`);
    check(name, "D-064 clicking a README fence's button toasts 'Copied — code block'", await toastShown(ctx.page, "Copied — code block"));
    check(name, "D-064 the README fence's code, not the button, is on the clipboard", (await copiedText(ctx.page)) === code, JSON.stringify(await readClipboard(ctx.page)));
    const copied = () => ctx.page.$eval(`${fence} button.ocx-prose-copy`, (b) => b.hasAttribute("data-copied"));
    check(name, "D-064 the button reads copied right after the click", await copied());

    // Re-copy restarts the 1500 ms window (D-166): 2000 ms after the first click is 1000 ms after the second.
    await sleep(1000);
    await ctx.page.click(`${fence} button.ocx-prose-copy`);
    await sleep(1000);
    check(name, "D-166 a second copy inside the window restarts it (still copied 2000 ms after the first click)", await copied());
    await sleep(800);
    check(name, "D-166 control: 1800 ms after the last copy the button reads idle again", !(await copied()));

    // One toast, replaced by the newest copy (D-143): two copies in a row leave one on screen, 2000 ms long.
    await ctx.page.click(`${fence} button.ocx-prose-copy`);
    await sleep(400);
    await ctx.page.click(`${fence} button.ocx-prose-copy`);
    await sleep(700);
    const toasts = await ctx.page.$$eval('[data-zag-root="toast"] [data-part="root"]', (roots) =>
      roots.map((r) => ({ open: r.dataset.state === "open", duration: r.style.getPropertyValue("--duration") })),
    );
    check(name, "D-143 two copies in a row leave one toast showing", toasts.filter((t) => t.open).length === 1, JSON.stringify(toasts));
    check(name, "D-143 a copy toast lasts 2000 ms", toasts.every((t) => t.duration === "2000ms"), JSON.stringify(toasts));
    await mark_(ctx, name, "D-064 README fence copy: no CSP violation or console error");
    await ctx.page.close();
  });
  await guarded(name, async () => {
    // D-085: the README's provenance menu copies its digest, its absolute URL and a `curl -sL` command.
    const ctx = await newPage(browser, { origin });
    await open(ctx, origin, detailPath, log);
    const readme = await ctx.page.$eval("[data-readme-provenance]", (el) => el.dataset.path);
    const digest = `sha256:${/([a-z0-9]{64})\.md$/.exec(readme)?.[1]}`;
    const absolute = `${origin}${readme}`;
    check(name, "D-085 control: the README names its wire file", readme.startsWith(`${base}p/`) && digest.length === 71, readme);
    for (const [label, expected, title] of [
      ["Copy digest", digest, "Copied — README digest"],
      ["Copy URL", absolute, "Copied — README URL"],
      ["Copy fetch command", `curl -sL ${absolute}`, "Copied — fetch command"],
    ]) {
      await clearClipboard(ctx.page);
      await ctx.page.click("[data-readme-provenance] [data-part='trigger']");
      await ctx.page.waitForFunction(() => document.querySelector("[data-readme-provenance] [data-part='content'][data-state='open']") !== null, { timeout: 5_000 }).catch(() => {});
      const item = await ctx.page.evaluateHandle((wanted) => [...document.querySelectorAll("[data-readme-provenance] [role='menuitem']")].find((i) => i.textContent.trim() === wanted) ?? null, label);
      if (item.asElement()) await item.asElement().click();
      const written = await copiedText(ctx.page);
      check(name, `D-085 '${label}' puts ${expected === digest ? "the digest" : "the absolute " + (label === "Copy URL" ? "URL" : "fetch command")} on the clipboard`, written === expected, `${JSON.stringify(written)} vs ${JSON.stringify(expected)}`);
      check(name, `D-085 '${label}' toasts '${title}'`, await toastShown(ctx.page, title));
      await sleep(300);
    }
    await mark_(ctx, name, "D-085 README provenance menu: no CSP violation or console error");
    await ctx.page.close();
  });
  if (hasDocs) {
    await guarded(name, async () => {
      const ctx = await newPage(browser, { origin });
      await open(ctx, origin, docsPath, log);
      const fences = await ctx.page.$$eval(".ocx-prose pre", (p) => p.length);
      const buttons = await ctx.page.$$eval(".ocx-prose pre button.ocx-prose-copy", (b) => b.length);
      check(name, "D-112 control: the docs page has code fences", fences > 0, `${fences}`);
      check(name, "D-112 every docs code fence carries a 'Copy code' button", buttons === fences, `${buttons} of ${fences}`);
      const inline = await ctx.page.$$eval(".ocx-prose code", (els) => els.filter((el) => el.closest("pre") === null).length);
      const stray = await ctx.page.$$eval(".ocx-prose button.ocx-prose-copy", (b) => b.filter((el) => el.closest("pre") === null).length);
      check(name, "D-112 control: the docs page has inline code outside any fence", inline > 0, `${inline}`);
      check(name, "D-112 inline code outside a fence gets no 'Copy code' button", stray === 0, `${stray}`);
      const code = await ctx.page.$eval(".ocx-prose pre code", (el) => el.textContent.replace(/\n$/, ""));
      await clearClipboard(ctx.page);
      await ctx.page.click(".ocx-prose pre button.ocx-prose-copy");
      check(name, "D-112 clicking a docs fence's button toasts 'Copied — code block'", await toastShown(ctx.page, "Copied — code block"));
      check(name, "D-112 the docs fence's code is on the clipboard", (await copiedText(ctx.page)) === code, JSON.stringify(await readClipboard(ctx.page)));
      await mark_(ctx, name, "D-112 docs fence copy: no CSP violation or console error");
      await ctx.page.close();
    });
  }
  await guarded(name, async () => {
    const ctx = await newPage(browser, { origin });
    await open(ctx, origin, detailPath, log);
    const pkg = await ctx.page.$eval("[data-detail]", (el) => el.dataset.package);
    const targets = [
      ["package-name badge", "[data-name-copy]", "Copied — package name", pkg],
      ["tag", "[data-versions] [data-tag]", /^Copied — :.+ identifier$/, null],
      ["install command", "[data-install-copy]", /^Copied — .+/, null],
    ];
    for (const [label, selector, title, text] of targets) {
      await clearClipboard(ctx.page);
      await ctx.page.click(selector);
      const shown = await ctx.page
        .waitForFunction(
          (wanted, isRe) => {
            const titles = [...document.querySelectorAll('[data-zag-root="toast"] [data-part="title"]')].map((el) => el.textContent);
            return titles.some((t) => (isRe ? new RegExp(wanted).test(t) : t === wanted));
          },
          { timeout: 5_000 },
          title instanceof RegExp ? title.source : title,
          title instanceof RegExp,
        )
        .then(() => true, () => false);
      check(name, `D-131 copying the ${label} on a detail page toasts a confirmation`, shown);
      const written = await copiedText(ctx.page);
      check(name, `D-131 the ${label} copy reaches the clipboard`, text === null ? written !== "(nothing copied)" : written === text, JSON.stringify(written));
      await sleep(1700); // past the copied guard, so the next target is a fresh click
    }
    await ctx.page.close();
  });
  await guarded(name, async () => {
    // D-084: no async clipboard (an insecure context) is harmless: a 'Copy failed' toast, no thrown error.
    const ctx = await newPage(browser);
    await ctx.page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await open(ctx, origin, detailPath, log);
    await ctx.page.click("[data-name-copy]");
    check(name, "D-084 without an async clipboard a copy toasts 'Copy failed'", await toastShown(ctx.page, "Copy failed"));
    check(name, "D-084 the badge is not left marked copied, ready for another try", !(await ctx.page.$eval("[data-name-copy]", (el) => el.hasAttribute("data-copied"))));
    const bad = await violations(ctx);
    check(name, "D-084 no uncaught error from the failed copy", bad.length === 0, bad.join(" | "));
    await ctx.page.close();
  });

  // --- the version list's copy menu: tags only, early right-click kept (D-083) ---------------------------
  await guarded(name, async () => {
    const ctx = await newPage(browser, { origin });
    await open(ctx, origin, detailPath, log);
    const menu = () => ctx.page.$eval("[data-versions] .ocx-copy-menu, .rail-card .ocx-copy-menu", (el) => el.dataset.zagState);
    check(name, "D-083 control: the version menu has not started before the first right click", (await menu()) === "idle");
    // Empty space inside the card: the point right of the last tag's row, bottom corner of the card.
    const gap = await ctx.page.$eval("[data-versions]", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.right - 6, y: r.bottom - 6, onTag: !!document.elementFromPoint(r.right - 6, r.bottom - 6)?.closest("[data-tag]") };
    });
    check(name, "D-083 control: the probe point is empty space", !gap.onTag, JSON.stringify(gap));
    await ctx.page.evaluate(() => {
      window.__ctxPrevented = [];
      document.addEventListener("contextmenu", (e) => window.__ctxPrevented.push(e.defaultPrevented));
    });
    await ctx.page.mouse.click(gap.x, gap.y, { button: "right" });
    await sleep(500);
    const open1 = await ctx.page.$$eval(".ocx-copy-menu [data-part='content'][data-state='open']", (c) => c.length);
    const prevented = await ctx.page.evaluate(() => window.__ctxPrevented);
    check(name, "D-083 a right click on empty space opens no menu and leaves the browser's own", open1 === 0 && prevented.length === 1 && prevented[0] === false, `open=${open1} prevented=${prevented}`);

    // A right click on a tag, before anything started the menu: it still opens, on that tag.
    const tags = await ctx.page.$$eval("[data-versions] [data-tag]", (t) => t.map((el) => el.dataset.tag));
    const third = tags[Math.min(2, tags.length - 1)];
    const pkg = await ctx.page.$eval("[data-detail]", (el) => el.dataset.package);
    await ctx.page.click(`[data-versions] [data-tag="${third}"]`, { button: "right" });
    const opened = await ctx.page
      .waitForFunction(() => document.querySelector(".ocx-copy-menu [data-part='content'][data-state='open']") !== null, { timeout: 5_000 })
      .then(() => true, () => false);
    check(name, "D-083 a right click on a tag before the island is live opens the menu", opened);
    await clearClipboard(ctx.page);
    const item = await ctx.page.evaluateHandle(() =>
      [...document.querySelectorAll(".ocx-copy-menu [data-part='content'][data-state='open'] [role='menuitem']")].find((i) => /Copy identifier/.test(i.textContent)) ?? null,
    );
    if (item.asElement()) await item.asElement().click();
    const identifier = await copiedText(ctx.page);
    check(name, "D-083 'Copy identifier' on a menu opened early copies that tag, not null", identifier === `${pkg}:${third}`, `${JSON.stringify(identifier)} vs ${pkg}:${third}`);
    await ctx.page.close();
  });

  // --- the colour scheme: class, stored choice, live OS changes, the glyph (D-127, D-132, D-133, D-134) ---
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await prefersScheme(ctx.page, "dark");
    await open(ctx, origin, base, log);
    check(name, "D-127 in dark the page carries both data-theme=dark and the .dark class", JSON.stringify(await scheme(ctx.page)) === JSON.stringify({ theme: "dark", dark: true }), JSON.stringify(await scheme(ctx.page)));
    await ctx.page.addStyleTag({ content: ".dark{--ocx-color-bg:rgb(1, 2, 3)}" });
    // The body fades its background over 0.15s: read it once the fade is over.
    const bg = async () => {
      await sleep(400);
      return ctx.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    };
    const darkBg = await bg();
    check(name, "D-127 a consumer's `.dark { --ocx-… }` block applies in dark", darkBg === "rgb(1, 2, 3)", darkBg);
    await prefersScheme(ctx.page, "light");
    await ctx.page.waitForFunction(() => document.documentElement.dataset.theme === "light", { timeout: 5_000 });
    const lightBg = await bg();
    check(name, "D-127 control: in light the .dark class is gone and the same block does nothing", !(await scheme(ctx.page)).dark && lightBg === "rgb(246, 247, 249)", `${JSON.stringify(await scheme(ctx.page))} ${lightBg}`);
    await ctx.page.close();
  });
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await prefersScheme(ctx.page, "light");
    await open(ctx, origin, base, log);
    await ctx.page.evaluate(() => {
      localStorage.removeItem("starlight-theme");
      localStorage.setItem("vitepress-theme-appearance", "dark");
    });
    await ctx.page.reload({ waitUntil: "networkidle0" });
    check(name, "D-132 a 0.5.x visitor's stored dark choice still wins over a light OS", (await scheme(ctx.page)).theme === "dark", JSON.stringify(await scheme(ctx.page)));
    check(name, "D-132 the choice moves to the new key and the old one is dropped", (await storage(ctx.page, "starlight-theme")) === "dark" && (await storage(ctx.page, "vitepress-theme-appearance")) === null);
    await ctx.page.evaluate(() => localStorage.clear());
    await ctx.page.reload({ waitUntil: "networkidle0" });
    check(name, "D-132 control: with no stored choice a light OS gets the light page", (await scheme(ctx.page)).theme === "light", JSON.stringify(await scheme(ctx.page)));
    await ctx.page.close();
  });
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await prefersScheme(ctx.page, "light");
    await open(ctx, origin, base, log);
    const theme = async () => (await scheme(ctx.page)).theme;
    const follows = (value) => ctx.page.waitForFunction((v) => document.documentElement.dataset.theme === v, { timeout: 3_000 }, value).then(() => true, () => false);
    const toggle = ".ocx-header__tools [data-ocx-theme]";
    await prefersScheme(ctx.page, "dark");
    check(name, "D-133 with no stored choice the page follows an OS change to dark, live", await follows("dark"), await theme());
    await ctx.page.click(toggle); // dark -> light: not the OS value, pinned
    await follows("light"); // the flip runs inside a view transition
    check(name, "D-133 clicking to a scheme other than the OS's pins it", (await theme()) === "light" && (await storage(ctx.page, "starlight-theme")) === "light", `${await theme()} ${await storage(ctx.page, "starlight-theme")}`);
    await prefersScheme(ctx.page, "light");
    await prefersScheme(ctx.page, "dark");
    await sleep(500);
    check(name, "D-133 control: a pinned choice ignores OS changes", (await theme()) === "light");
    await ctx.page.click(toggle); // light -> dark: the OS value, back to auto
    await follows("dark");
    check(name, "D-133 clicking back to the OS's own scheme returns to auto", (await theme()) === "dark" && (await storage(ctx.page, "starlight-theme")) === "auto", `${await theme()} ${await storage(ctx.page, "starlight-theme")}`);
    await prefersScheme(ctx.page, "light");
    check(name, "D-133 after auto the page follows the OS again", await follows("light"), await theme());
    await ctx.page.close();
  });
  for (const [osScheme, glyph] of [["light", "sun"], ["dark", "moon"]]) {
    await guarded(name, async () => {
      // The page scripts are held back, so only the head script and the stylesheet decide what the button shows.
      const ctx = await newPage(browser);
      await ctx.page.setRequestInterception(true);
      ctx.page.on("request", (req) => (new URL(req.url()).pathname.endsWith(".js") ? req.abort() : req.continue()));
      await prefersScheme(ctx.page, osScheme);
      await ctx.page.goto(`${origin}${base}`, { waitUntil: "load" });
      const shown = await ctx.page.$$eval(".ocx-header__tools [data-ocx-theme] .ocx-ui-cycle-button__state", (icons) =>
        icons.filter((i) => getComputedStyle(i).opacity === "1" && getComputedStyle(i).visibility === "visible").map((i) => i.dataset.icon),
      );
      check(name, `D-134 ${osScheme}: with no script running the toggle shows the ${glyph} (the state, theme 0.2.0), and only that`, shown.length === 1 && shown[0] === glyph, JSON.stringify(shown));
      await ctx.page.close();
    });
  }

  // --- the header: a menu that is never dead; external links ----------------------------------------
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await ctx.page.setViewport({ width: 390, height: 844 });
    await open(ctx, origin, base, log);
    const menuButton = await ctx.page.$("button.ocx-header__menu");
    check(name, "D-141 control: the narrow header has its menu button", menuButton !== null);
    if (menuButton) {
      await menuButton.click();
      await sleep(300);
      const links = await ctx.page.$$eval("#ocx-header-menu a", (a) => a.filter((el) => el.getBoundingClientRect().width > 0).length);
      check(name, "D-141 the menu a narrow header offers is not empty", links > 0, `${links} visible links`);
    }
    await ctx.page.close();
  });

  // --- base styles: box model, body, links, buttons, tokens (D-163, D-168, D-169, D-161) --------------------
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await open(ctx, origin, base, log);
    const probe = await ctx.page.evaluate(() => {
      const main = document.querySelector("main");
      const text = (tag, attrs = "") => {
        const el = document.createElement(tag);
        el.textContent = "probe";
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        main.prepend(el);
        return el;
      };
      const div = text("div");
      const link = text("a", { href: "#probe", id: "probe-link" });
      const button = text("button", { id: "probe-button" });
      const swatch = text("div");
      swatch.style.color = "var(--ocx-color-accent-fg)";
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      const resolved = (v) => {
        swatch.style.color = `var(${v})`;
        return getComputedStyle(swatch).color;
      };
      return {
        divBox: getComputedStyle(div).boxSizing,
        beforeBox: getComputedStyle(div, "::before").boxSizing,
        fontSize: body.fontSize,
        lineHeight: body.lineHeight,
        smoothing: body.getPropertyValue("-webkit-font-smoothing"),
        transition: body.transitionDuration,
        link: { color: getComputedStyle(link).color, decoration: getComputedStyle(link).textDecorationLine, accent: resolved("--ocx-color-accent-fg"), hover: resolved("--ocx-color-accent-hover") },
        button: { font: getComputedStyle(button).fontFamily, size: getComputedStyle(button).fontSize, bodyFont: body.fontFamily },
        tokens: { drawerClose: root.getPropertyValue("--ocx-z-drawer-close").trim(), shimmer: root.getPropertyValue("--ocx-duration-shimmer").trim(), textBase: root.getPropertyValue("--ocx-text-base").trim(), durationBase: root.getPropertyValue("--ocx-duration-base").trim() },
      };
    });
    check(name, "D-163 a bare element is border-box", probe.divBox === "border-box" && probe.beforeBox === "border-box", `${probe.divBox} ${probe.beforeBox}`);
    check(name, "D-168 body text is 13px at line-height 1.5", probe.fontSize === "13px" && probe.lineHeight === "19.5px", `${probe.fontSize} / ${probe.lineHeight}`);
    check(name, "D-168 body text is antialiased", probe.smoothing === "antialiased", probe.smoothing);
    check(name, "D-168 the scheme fade is 0.15s", probe.transition.split(",").every((d) => d.trim() === "0.15s"), probe.transition);
    check(name, "D-169 a bare link in <main> is the accent colour with no underline", probe.link.color === probe.link.accent && probe.link.decoration === "none", JSON.stringify(probe.link));
    check(name, "D-169 control: the accent and its hover colour are distinct", probe.link.accent !== probe.link.hover, JSON.stringify(probe.link));
    check(name, "D-169 a button inherits the body font", probe.button.font === probe.button.bodyFont && probe.button.size === probe.fontSize, JSON.stringify(probe.button));
    await ctx.page.hover("#probe-link");
    const hover = await ctx.page.$eval("#probe-link", (el) => getComputedStyle(el).color);
    check(name, "D-169 a bare link takes the accent-hover colour on hover", hover === probe.link.hover, `${hover} vs ${probe.link.hover}`);
    check(name, "D-161 the consumer-overridable tokens exist: drawer close layer, shimmer, base size, base duration", probe.tokens.drawerClose === "45" && probe.tokens.shimmer === "1.6s" && probe.tokens.textBase === "13px" && Number.parseFloat(probe.tokens.durationBase) === 0.15, JSON.stringify(probe.tokens));
    await ctx.page.close();
  });
  // --- footer rule: one hairline edge to edge, never a band beside the footer box ------------------------------
  await guarded(name, async () => {
    const ctx = await newPage(browser);
    await ctx.page.setViewport({ width: 1600, height: 900 });
    await open(ctx, origin, base, log);
    // Paint, not computed style (a spread shadow and its clip path): a 1px column beside the footer box, from well
    // above it to its bottom, read back through a canvas. Exactly one short run may differ from the page colour.
    // A viewport as tall as the page: nothing scrolls, so the clip and the rect share one origin.
    await ctx.page.setViewport({ width: 1600, height: await ctx.page.evaluate(() => document.documentElement.scrollHeight) });
    const column = await ctx.page.$eval(".ocx-footer", (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.floor(r.left / 2), y: Math.floor(r.top) - 24, height: Math.ceil(r.height) + 24, left: r.left };
    });
    const png = await ctx.page.screenshot({ encoding: "base64", clip: { x: column.x, y: column.y, width: 1, height: column.height } });
    const rows = await ctx.page.evaluate(async (data) => {
      const img = new window.Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const g = canvas.getContext("2d");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, 1, img.height).data;
      return Array.from({ length: img.height }, (_, i) => `${px[i * 4]},${px[i * 4 + 1]},${px[i * 4 + 2]}`);
    }, png);
    const page = rows[0];
    const off = rows.filter((c) => c !== page).length;
    check(name, "footer: control: the footer sits inside a column, with page background beside it", column.left > 16, `${column.left}`);
    check(name, "footer: the hairline above the footer runs edge to edge", off >= 1, `${off} rows differ from ${page}`);
    check(name, "footer: beside the footer box is page background, not a band of the rule colour", off <= 2, `${off} rows differ from ${page}`);
    await ctx.page.close();
  });
  for (const osScheme of ["light", "dark"]) {
    await guarded(name, async () => {
      // A monogram tile takes its hue from `--ocx-color-monogram-<n>` in both schemes, and a consumer override wins.
      const ctx = await newPage(browser);
      await prefersScheme(ctx.page, osScheme);
      await open(ctx, origin, base, log);
      const tile = '.ocx-logo-tile[data-state="fallback"] .ocx-logo-tile__initials';
      const hue = await ctx.page.$eval('.ocx-logo-tile[data-state="fallback"]', (el) => el.dataset.hue).catch(() => null);
      check(name, `D-161 ${osScheme}: control: the landing page draws a monogram tile`, hue !== null);
      if (hue !== null) {
        const ink = () =>
          ctx.page.evaluate((sel, n) => {
            const probe = document.createElement("i");
            probe.style.color = `var(--ocx-color-monogram-${n})`;
            document.body.append(probe);
            const token = getComputedStyle(probe).color;
            probe.remove();
            return { drawn: getComputedStyle(document.querySelector(sel)).color, token };
          }, tile, hue);
        const before = await ink();
        check(name, `D-161 ${osScheme}: a monogram tile is inked with its --ocx-color-monogram token`, before.drawn === before.token, JSON.stringify(before));
        await ctx.page.addStyleTag({ content: `:root,.dark{--ocx-color-monogram-${hue}:rgb(1, 2, 3)}` });
        const after = await ink();
        check(name, `D-161 ${osScheme}: a consumer override of the monogram token recolours the tile`, after.drawn === "rgb(1, 2, 3)" && after.drawn !== before.drawn, JSON.stringify(after));
      }
      await ctx.page.close();
    });
  }
}

/** Runs one block of checks; a missing element or a timeout there is a FAIL row, not the end of the run. */
async function guarded(site, block) {
  try {
    await block();
  } catch (error) {
    check(site, "a parity block ran to its end", false, String(error?.message ?? error).split("\n")[0]);
  }
}

/** `mark` for a context outside `runSite`. */
const mark_ = (ctx, site, message) => violations(ctx).then((bad) => check(site, message, bad.length === 0, bad.join(" | ")));

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
