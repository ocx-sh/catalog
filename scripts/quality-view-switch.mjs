#!/usr/bin/env node
/**
 * Measures, in a real browser, what the catalog's view switch costs at
 * corporate size — the half of the page's cost Lighthouse's category scores do
 * not isolate and no DOM emulator can see at all.
 *
 * The landing page ships a window of 24 server-rendered cards; the grid island
 * (`src/site/client/grid.ts`) takes over on first interaction, fetches
 * `catalog.json` once and builds cards or rows from `<template>` clones, one
 * window at a time. The grid and the table share no element types, so
 * switching view replaces every item in the window. jsdom and happy-dom lay
 * nothing out, so a timing taken there measures the patch and none of the
 * style, layout, paint or resource work that dominates it — the vacuous green
 * `quality-core.md` warns about.
 *
 * Three timings, at 4x CPU throttle so a fast desktop reports something a
 * mid-range laptop would recognise, over the `--bulk 250` site:
 *
 *   - first switch (cold): the first click on the table toggle of a page that
 *     has taken no input yet, to the first painted row. It pays the lazy island
 *     chunk, the `catalog.json` fetch and the first build together.
 *   - cards -> table, and table -> cards, warm: click to next paint.
 *   - a table URL (`?view=table`) on arrival: navigation to the first painted
 *     row. The URL carries state, so the island boots at load.
 *
 * Budgets below are the MEASURED medians on the machine that measured them,
 * times two: the CI runner (ubuntu-latest) ran about 1.8x slower than a
 * desktop on this probe's fixture site, and a regression that doubles
 * the work must still red. They are provisional until the first CI run:
 * re-ratchet from that median (plus ~25%), and never raise one to make a
 * regression pass.
 *
 * ## Measured (Chromium 155, 4x throttle, 252 packages, local desktop)
 *
 *                      median   budget
 *   first switch (cold)  306ms    650ms
 *   cards -> table       159ms    350ms
 *   table -> cards       151ms    350ms
 *   table URL on arrival 561ms   1150ms
 *
 * Usage: node scripts/quality-view-switch.mjs [chromePath] [--site DIR] [--runs N]
 */
/* The page.evaluate callbacks below are serialised and run inside Chrome, so
   their identifiers resolve against the browser, not Node. */
/* global document, window, requestAnimationFrame, MutationObserver */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { serve } from "./lib/serve.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Milliseconds, at 4x CPU throttle, over the `--bulk 250` site. See the docblock. */
const BUDGET = {
  "first switch (cold)": 650,
  "cards -> table": 350,
  "table -> cards": 350,
  "table URL on arrival": 1150,
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: "string", default: ".lhci-bulk" },
    runs: { type: "string", default: "3" },
  },
});

const site = resolve(ROOT, values.site);
const runs = Number(values.runs);
const chromePath = positionals[0] || process.env.CHROME_PATH || undefined;

/** The item of the view toggle (a theme `ToggleGroup`) labelled `label`. */
const viewItem = (label) => `[data-grid-view] [role="radio"][aria-label="${label}"]`;

/**
 * Click `selector` with the real mouse (the theme's lazy triggers listen for pointer, focus, key and
 * touch input, not for a synthetic `click()`), then wait until `ready()` holds and two frames have
 * painted. Resolves to the ms from just before the pointer moved to that second frame, so a cold
 * page's first switch includes the chunks and the `catalog.json` the first input starts.
 */
async function timeClick(page, selector, ready) {
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  await page.click(selector);
  return page.evaluate(async (readyBody) => {
    const isReady = new Function(`return (${readyBody})()`);
    const deadline = performance.now() + 15_000;
    while (!isReady()) {
      if (performance.now() > deadline) throw new Error("the view never switched");
      await new Promise((done) => requestAnimationFrame(done));
    }
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return performance.now() - window.__t0;
  }, ready.toString());
}

const rowsShown = () => document.querySelectorAll("[data-grid-table]:not([hidden]) > li").length > 0;
const cardsShown = () => document.querySelectorAll("[data-grid-cards]:not([hidden]) > li").length > 0;

/** The median, which is what a threshold should be read against — one slow
 *  run on a loaded machine should not become the number. */
function median(values_) {
  const sorted = [...values_].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** A page in a fresh context (no stored state) with CPU throttled 4x. */
async function open(browser, url, options = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await (await page.createCDPSession()).send("Emulation.setCPUThrottlingRate", { rate: 4 });
  if (options.firstRow) {
    await page.evaluateOnNewDocument(() => {
      window.__firstRow = new Promise((done) => {
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll("[data-grid-table]:not([hidden]) > li").length === 0) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())));
        });
        // The document itself, not `documentElement` — this script runs
        // before any of the page does, when there is no `<html>` yet.
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
      });
    });
  }
  await page.goto(url, { waitUntil: options.firstRow ? "domcontentloaded" : "networkidle0" });
  return { context, page };
}

async function main() {
  const server = await serve(site);
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const puppeteer = (await import("puppeteer-core")).default;
  // No path handed in (the CI runner has no puppeteer cache to glob): let
  // puppeteer resolve the system Chrome install itself.
  const browser = await puppeteer.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
    headless: true,
    args: ["--no-sandbox"],
  });

  const samples = Object.fromEntries(Object.keys(BUDGET).map((name) => [name, []]));
  let packages = 0;
  try {
    for (let run = 0; run < runs; run++) {
      // A fresh context per sample: the first switch is only "cold" while the
      // page has taken no input, and a fresh context shares no stored state.
      const cold = await open(browser, `${origin}/`);
      samples["first switch (cold)"].push(await timeClick(cold.page, viewItem("Table"), rowsShown));
      // The grid has replaced the server cards with the catalog's own: the
      // count line is the proof that the island took over and the data arrived.
      packages = await cold.page.evaluate(() => Number(document.querySelector("[data-grid-count]")?.textContent?.match(/\d+/)?.[0] ?? 0));
      samples["table -> cards"].push(await timeClick(cold.page, viewItem("Cards"), cardsShown));
      samples["cards -> table"].push(await timeClick(cold.page, viewItem("Table"), rowsShown));
      await cold.context.close();

      const arrival = await open(browser, `${origin}/?view=table`, { firstRow: true });
      samples["table URL on arrival"].push(await arrival.page.evaluate(() => window.__firstRow));
      await arrival.context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\nview-switch probe — ${packages} packages, 4x CPU throttle, median of ${runs}\n`);
  const failures = [];
  for (const [name, taken] of Object.entries(samples)) {
    const value = median(taken);
    const budget = BUDGET[name];
    const ok = value <= budget;
    if (!ok) failures.push(name);
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${name.padEnd(22)} ${value.toFixed(0).padStart(6)}ms  ` +
        `(budget ${budget}ms; runs ${taken.map((t) => t.toFixed(0)).join(", ")})`,
    );
  }
  if (packages < 250) failures.push(`the grid reported ${packages} packages, expected the 250 of --bulk`);
  if (failures.length > 0) {
    throw new Error(
      `Over budget or wrong site: ${failures.join(", ")}.\n` +
        "The grid builds one window of items, so this should not grow with the\n" +
        "catalog. Check what a card or row clones before raising the number.",
    );
  }
  console.log("\nthe catalog switches view within budget at corporate size");
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
