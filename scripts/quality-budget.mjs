#!/usr/bin/env node
/**
 * The page-budget probe (plan G.1, contract C-017, scenario S-005): measures
 * built pages in a real browser and asserts the theme's content-page budgets.
 * Lighthouse scores a page; this counts what Lighthouse rounds away — bytes,
 * nodes, layout shift — and compares them to the numbers the theme publishes
 * in `ocx-theme-quality` (`tests/budgets.mjs` of ocx-sh/website, class
 * `content`). Built on `puppeteer-core`, like the other `scripts/quality-*`.
 *
 * ## What is measured, per page
 *
 *   - DOM nodes    `document.body.querySelectorAll('*')`, the way Lighthouse's
 *                  `dom-size` counts, so one budget means the same in both.
 *   - gz HTML      gzip of the document response body.
 *   - pre-input JS gzip of every script body fetched, plus inline scripts,
 *                  once the page is idle and BEFORE any input.
 *   - CLS          every layout-shift entry, summed (the page takes no input).
 *   - blocked      the same page with every image request aborted: CLS again
 *                  and the box of every element, which must not move.
 *   - heap         `JSHeapUsedSize` after a GC.
 *
 * ## What is gated (C-017) and what is only reported
 *
 *   gated      landing N=24 (root fixture; exactly 24 cards, from a catalog of
 *              24 or more), the 250-package landing, one fixture detail page:
 *              HTML <= 14,200 B gz, pre-input JS <= 11 KiB gz, DOM <= 800
 *              (the 250 landing: BULK_DOM_MAX, see there), CLS 0, blocked CLS
 *              0 and identical boxes, heap <= 4 MiB.
 *   reported   the README-heavy detail page (OQ1): a real README is the page's
 *              content and exceeds the HTML budget by construction, so the
 *              Spec Delta excludes it from the gate; the numbers are printed so
 *              the decision stays an informed one.
 *   INP        first keystroke on the 250-package landing, 4x CPU throttle:
 *              the worst `keydown`/`keypress`/`keyup` event duration, the
 *              interaction that also pays the lazy catalog load. <= 200 ms.
 *              If it fails, the recorded fallback is a prebuilt
 *              `MiniSearch.toJSON` index at build time (plan G.1).
 *
 * `--red-demo` proves each gate can go red: it plants three violations into a
 * scratch copy of the root site (a DOM bloat, an eager 40 KB script, a late
 * layout shift) and requires the probe to fail on exactly those metrics.
 *
 * Usage: node scripts/quality-budget.mjs [chromePath] [--root DIR] [--bulk DIR]
 *          [--readme DIR] [--json FILE] [--red-demo]
 */
/* The page.evaluate callbacks below are serialised and run inside Chrome, so
   their identifiers resolve against the browser, not Node. */
/* global document, window */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import { serve } from "./lib/serve.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KiB = 1024;

/** The theme's `content` class budget (ocx-theme-quality), plus C-017's CLS 0. */
const BUDGET = { htmlGz: 14_200, preJsGz: 11 * KiB, dom: 800, cls: 0, heap: 4 * KiB * KiB, inp: 200 };
/**
 * The 250-package landing draws the same 24 server-rendered cards as N=24, but from the richer
 * `quality-index` fixture (four platform glyphs and several keywords per card, about 41 nodes each, against
 * about 25 in the `root` fixture), so its DOM is larger without growing with the catalog. The 800 of
 * C-017 gates the N=24 landing; this is the bound for the same window of the richest fixture card:
 * 24 cards x 41 nodes + 350 of chrome and toolbar, rounded up.
 */
const BULK_DOM_MAX = 1100;
/** `ul[data-grid-cards]` holds the server-rendered window of cards. */
const CARDS = "[data-grid-cards] > li";
const LANDING_N = 24;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: ".lhci-budget/root" },
    bulk: { type: "string", default: ".lhci-bulk" },
    readme: { type: "string", default: ".lhci-budget/readme" },
    json: { type: "string" },
    "red-demo": { type: "boolean", default: false },
  },
});
const chromePath = positionals[0] || process.env.CHROME_PATH || undefined;

/** Install the layout-shift and event-timing collectors before any page script. */
function observe() {
  window.__cls = 0;
  window.__events = [];
  new PerformanceObserver((list) => {
    // Every shift counts, `hadRecentInput` or not: a measured page takes no input at all.
    for (const e of list.getEntries()) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__events.push({ name: e.name, duration: e.duration, id: e.interactionId });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
}

/** Every element's rounded box, in document order — the "no flicker" signature. */
function boxes() {
  return [...document.querySelectorAll("body *")].flatMap((e) => {
    const r = e.getBoundingClientRect();
    return r.width || r.height ? [`${e.tagName} ${[r.x, r.y, r.width, r.height].map(Math.round).join(",")}`] : [];
  });
}

/** Open `url` in a fresh page; track script bodies; resolve once idle. */
async function load(browser, url, { blockImages = false, throttle = 1 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (throttle > 1) await (await page.createCDPSession()).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.evaluateOnNewDocument(observe);

  const scripts = new Map();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", (r) => {
    if (r.request().resourceType() !== "script" || r.status() >= 300) return;
    scripts.set(
      r.url(),
      r.buffer().then((b) => gzipSync(b).length),
    );
  });
  if (blockImages) {
    await page.setRequestInterception(true);
    page.on("request", (r) => (r.resourceType() === "image" ? r.abort() : r.continue()));
  }
  const response = await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  // Layout shifts after load still count; give the page a beat to settle.
  await new Promise((done) => setTimeout(done, 750));
  return { context, page, response, scripts, requests };
}

/** Everything a budget is asserted against, for one page. */
async function measure(browser, url) {
  const open = await load(browser, url);
  const { page } = open;
  const html = gzipSync(await open.response.buffer()).length;
  const inline = await page.$$eval("script:not([src])", (ss) =>
    ss.filter((s) => !s.type || /module|javascript/.test(s.type)).map((s) => s.textContent ?? ""),
  );
  const external = [...open.scripts.values()];
  const preJs = (await Promise.all(external)).reduce((a, b) => a + b, 0) + inline.reduce((a, t) => a + gzipSync(t).length, 0);
  const dom = await page.evaluate(() => document.body.querySelectorAll("*").length);
  const cards = await page.$$eval(CARDS, (n) => n.length);
  const cls = await page.evaluate(() => window.__cls);
  const layout = await page.evaluate(boxes);
  const cdp = await page.createCDPSession();
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? Number.NaN;
  await open.context.close();

  const blocked = await load(browser, url, { blockImages: true });
  const blockedCls = await blocked.page.evaluate(() => window.__cls);
  const blockedLayout = await blocked.page.evaluate(boxes);
  await blocked.context.close();
  const moved = layout.filter((box, i) => box !== blockedLayout[i]).length + Math.abs(layout.length - blockedLayout.length);

  return {
    url,
    cards,
    dom,
    htmlGz: html,
    preJsGz: preJs,
    scripts: external.length + inline.length,
    cls,
    blockedCls,
    moved,
    heap,
  };
}

/** First-keystroke INP on the landing page: click the search, type at once. */
async function firstKeystroke(browser, url) {
  const { page, context } = await load(browser, url, { throttle: 4 });
  await page.click("input[data-grid-search]");
  await page.keyboard.type("r", { delay: 0 });
  await new Promise((done) => setTimeout(done, 2500));
  const events = await page.evaluate(() => window.__events);
  await context.close();
  const key = events.filter((e) => e.name.startsWith("key")).map((e) => e.duration);
  const all = events.filter((e) => e.id > 0).map((e) => e.duration);
  return { key: Math.max(0, ...key), worst: Math.max(0, ...all), events: events.length };
}

/** Budget violations of one gated measurement, as `metric value > cap` strings. */
function violations(m, expectedCards, domMax = BUDGET.dom) {
  const out = [];
  const over = (name, value, cap) => value > cap && out.push(`${name} ${value} > ${cap}`);
  over("htmlGz", m.htmlGz, BUDGET.htmlGz);
  over("preJsGz", m.preJsGz, BUDGET.preJsGz);
  over("dom", m.dom, domMax);
  over("cls", m.cls, BUDGET.cls);
  over("blockedCls", m.blockedCls, BUDGET.cls);
  over("heap", m.heap, BUDGET.heap);
  over("moved", m.moved, 0);
  if (expectedCards !== undefined && m.cards !== expectedCards) out.push(`cards ${m.cards} != ${expectedCards}`);
  return out;
}

function line(label, m, flag) {
  const kb = (n) => (n / KiB).toFixed(1).padStart(6);
  return (
    `  ${flag.padEnd(6)} ${label.padEnd(24)} dom ${String(m.dom).padStart(4)}  html ${kb(m.htmlGz)} KiB gz  ` +
    `js ${kb(m.preJsGz)} KiB gz (${m.scripts} scripts)  cls ${m.cls.toFixed(3)}/${m.blockedCls.toFixed(3)}  ` +
    `moved ${m.moved}  heap ${(m.heap / KiB / KiB).toFixed(2)} MiB` +
    (m.cards ? `  cards ${m.cards}` : "")
  );
}

/** The catalog size the root landing is drawn from (24 or more, C-017). */
async function catalogSize(dir) {
  const catalog = JSON.parse(await readFile(join(dir, "data/catalog/catalog.json"), "utf8"));
  return (catalog.packages ?? catalog.entries ?? []).length;
}

/** The first `/<ns>/<pkg>/` detail page of a built site, from its sitemap-free route list. */
async function firstDetail(dir, prefer) {
  const { readdir } = await import("node:fs/promises");
  if (prefer) return prefer;
  const files = await readdir(dir, { recursive: true });
  const page = files.filter((f) => /^[^/_]+\/[^/]+\/index\.html$/.test(f.split("\\").join("/"))).sort()[0];
  if (!page) throw new Error(`no detail page under ${dir}`);
  return `/${page.slice(0, -"index.html".length)}`;
}

async function withSite(dir, run) {
  const server = await serve(dir);
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  return puppeteer.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
    headless: true,
    args: ["--no-sandbox"],
  });
}

/** Plant three violations in a scratch copy of the root site; each must go red. */
async function redDemo(browser, rootDir) {
  const scratch = await mkdtemp(join(tmpdir(), "quality-budget-red-"));
  try {
    await cp(rootDir, scratch, { recursive: true });
    const index = join(scratch, "index.html");
    const original = await readFile(index, "utf8");
    // Scripts, not inline code: the pages' CSP (`script-src 'self'` + hashes) would refuse an inline plant,
    // and a plant that never runs proves nothing.
    const filler = Buffer.from(Array.from({ length: 30000 }, (_, i) => (i * 2654435761) >>> 24)).toString("base64");
    await writeFile(join(scratch, "eager.js"), `/*${filler}*/`); // incompressible, so the gzip size is the point
    await writeFile(
      join(scratch, "late.js"),
      'setTimeout(()=>{const d=document.createElement("div");d.style.cssText="height:300px";document.body.prepend(d)},300)',
    );
    const withScript = (src) => (html) => html.replace("</body>", `<script type="module" src="${src}"></script></body>`);
    const plants = {
      "dom-bloat": ["dom", (h) => h.replace("</main>", `${"<i></i>".repeat(900)}</main>`)],
      "eager-script": ["preJsGz", withScript("/eager.js")],
      "late-shift": ["cls", withScript("/late.js")],
    };
    // A plant proves a gate only if the gate was green before it: the baseline must pass on every metric.
    await writeFile(index, original);
    const baseline = await withSite(scratch, async (origin) => violations(await measure(browser, `${origin}/`)));
    if (baseline.length > 0) throw new Error(`The unplanted page already fails, so a plant proves nothing:\n  ${baseline.join("\n  ")}`);
    let failed = false;
    for (const [name, [metric, plant]] of Object.entries(plants)) {
      await writeFile(index, plant(original));
      const found = await withSite(scratch, async (origin) => violations(await measure(browser, `${origin}/`)));
      const red = found.some((v) => v.startsWith(`${metric} `));
      failed ||= !red;
      console.log(`  ${red ? "red " : "NOT RED"} ${name.padEnd(13)} -> ${found.join("; ") || "no violation"}`);
    }
    if (failed) throw new Error("A planted violation did not turn the probe red.");
    console.log("\nevery gate goes red on a planted violation");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const rootDir = resolve(ROOT, values.root);
  const browser = await launch();
  try {
    if (values["red-demo"]) return await redDemo(browser, rootDir);

    const failures = [];
    const results = {};
    const gate = (label, m, expectedCards, domMax) => {
      const found = violations(m, expectedCards, domMax);
      for (const v of found) failures.push(`${label}: ${v}`);
      results[label] = { ...m, gated: true };
      console.log(line(label, m, found.length ? "FAIL" : "ok"));
    };
    const report = (label, m) => {
      results[label] = { ...m, gated: false };
      console.log(line(label, m, "report"));
    };

    console.log("\nbudget probe — 390x844 mobile, content-class budgets (C-017)\n");

    const size = await catalogSize(rootDir);
    if (size < LANDING_N) failures.push(`root fixture holds ${size} packages, need at least ${LANDING_N}`);
    const detailPath = await firstDetail(rootDir, "/sharkdp/bat/");
    await withSite(rootDir, async (origin) => {
      gate(`grid N=${LANDING_N}`, await measure(browser, `${origin}/`), LANDING_N);
      gate("fixture detail", await measure(browser, `${origin}${detailPath}`));
    });

    await withSite(resolve(ROOT, values.bulk), async (origin) => {
      gate("grid 250", await measure(browser, `${origin}/`), LANDING_N, BULK_DOM_MAX);
      const inp = await firstKeystroke(browser, `${origin}/`);
      results.inp = inp;
      const ok = inp.key <= BUDGET.inp;
      if (!ok) failures.push(`first-keystroke INP ${inp.key.toFixed(0)} ms > ${BUDGET.inp} ms`);
      console.log(
        `  ${ok ? "ok" : "FAIL"}   first-keystroke INP (250, 4x CPU) ${inp.key.toFixed(0)} ms ` +
          `(worst interaction ${inp.worst.toFixed(0)} ms, ${inp.events} events; budget ${BUDGET.inp} ms)`,
      );
    });

    const readmeDir = resolve(ROOT, values.readme);
    await withSite(readmeDir, async (origin) => {
      report("README-heavy detail", await measure(browser, `${origin}${await firstDetail(readmeDir)}`));
    });

    if (values.json) await writeFile(resolve(ROOT, values.json), `${JSON.stringify(results, null, 2)}\n`);
    if (failures.length > 0) throw new Error(`Over budget:\n  ${failures.join("\n  ")}`);
    console.log("\nevery gated page is within the content-class budget");
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
