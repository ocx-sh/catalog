#!/usr/bin/env node
/**
 * Measures, in a real browser, what the catalog costs to BUILD at corporate
 * size — the half of the page's cost Lighthouse's category scores do not
 * isolate and no DOM emulator can see at all.
 *
 * The grid and the table share no element types, so switching view unmounts
 * every card and mounts every row: there is no node for Vue to reuse, and
 * each item is not just a card but a `CopyContextMenu` (four reka-ui
 * components and a computed building seven actions) around one. jsdom and
 * happy-dom lay nothing out, so a timing taken there measures the component
 * patch and none of the style, layout, paint or resource work that dominates
 * it — the exact vacuous green `quality-core.md` warns about.
 *
 * Three timings, at 4x CPU throttle so a fast desktop reports something a
 * mid-range laptop would recognise:
 *
 *   - cards -> table, and table -> cards: click to next paint.
 *   - a stored table view on arrival: navigation to the first painted row.
 *     This is the worst of the three, because it pays the fetch, the
 *     hydration and the mount together.
 *
 * Budgets below are MEASURED medians plus a margin, not aspirations. A
 * regression that doubles the mount cost reds this; ordinary run-to-run
 * variance does not. Re-measure and re-ratchet when the theme changes — and
 * never raise one to make a regression pass.
 *
 * ## Measured (Chromium 152, 4x throttle, 252 packages)
 *
 *                        no bound   + card paint bound   + window   budget
 *   cards -> table         1748ms               1255ms     194ms    240ms
 *   table -> cards         1305ms                773ms     198ms    250ms
 *   stored table view      2224ms               1592ms     522ms    800ms
 *
 * table -> cards was 371ms until `PackageTable` stopped handing every row a
 * fresh copy-actions array per render (every row re-rendered on every
 * growth and on the switch); cached per package, it is 198ms.
 *
 * Both halves were measured separately, because they bound different work
 * and either one alone is a third of the answer. `content-visibility` on
 * `.package-card` takes ~30-40% off by keeping off-screen cards out of
 * layout and paint — and every component is still built. `useWindowedList`
 * takes another 50-85% off what is left by not building them.
 *
 * The CARD only. The table row is a `subgrid` item, and `content-visibility`
 * implies layout containment at all times, under which Chromium resolves
 * `grid-template-columns` to `none` and stacks every cell on its own line.
 * It shipped that way once, with timings that looked better (214ms for
 * table -> cards) because a table that is not a table is cheaper to lay out.
 * The numbers above are for a working one.
 *
 * The table above is a desktop. The BUDGETS are set from the machine that
 * gates — CI's ubuntu-latest runner, about 1.8x slower on the same site:
 *
 *                        CI median   budget
 *   cards -> table          348ms     440ms
 *   table -> cards          357ms     450ms
 *   stored table view      1146ms    1450ms
 *
 * A ~25% margin over the CI median. At these magnitudes a fixed percentage
 * is the honest margin: one slow frame is a much larger share of 350ms than
 * of 1748ms. A desktop passes these by a wide margin, which is fine — the
 * gate lives in CI, and a local run is for reading the numbers. The red
 * state is still reachable there: unbounded, the same runner would report
 * roughly 3000/2300/4000ms, and losing just the row-actions cache (371ms
 * locally for table -> cards) lands around 670ms.
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

/**
 * Milliseconds, at 4x CPU throttle, over the `--bulk 250` site, on CI's
 * runner. See the docblock: measured median there, then a ~25% margin.
 */
const BUDGET = {
  "cards -> table": 440,
  "table -> cards": 450,
  "stored table view": 1450,
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

/** Click a toolbar view button and return the time to the next painted frame. */
function timeSwitch(page, title) {
  return page.evaluate(async (buttonTitle) => {
    const button = document.querySelector(`.view-toggle button[title="${buttonTitle}"]`);
    if (!button) throw new Error(`no view-toggle button titled ${buttonTitle}`);
    const started = performance.now();
    button.click();
    // Vue patches on a microtask, so the first frame callback runs after the
    // DOM is committed; the second runs after the browser has painted it.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return performance.now() - started;
  }, title);
}

/** The median, which is what a threshold should be read against — one slow
 *  run on a loaded machine should not become the number. */
function median(values_) {
  const sorted = [...values_].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

  const samples = { "cards -> table": [], "table -> cards": [], "stored table view": [] };
  let packages = 0;
  try {
    for (let run = 0; run < runs; run++) {
      // A fresh context per run, because the last thing each run does is
      // STORE a table view — carried into the next run, the landing page
      // would open on the table and the cards timing would have nothing to
      // wait for.
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const cdp = await page.createCDPSession();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

      // A stored view is read before the first grid paint, so it has to be
      // written on this origin BEFORE the measured load. The first visit is
      // also where the two switch timings are taken.
      await page.goto(`${origin}/`, { waitUntil: "networkidle0" });
      await page.waitForSelector(".package-card", { timeout: 30_000 });
      packages = await page.evaluate(() => {
        const meta = document.querySelector(".result-meta")?.textContent ?? "";
        return Number(meta.match(/\d+/)?.[0] ?? 0);
      });

      samples["cards -> table"].push(await timeSwitch(page, "Table view"));
      samples["table -> cards"].push(await timeSwitch(page, "Card view"));

      // Back to the table, and leave it stored for the reload below.
      await timeSwitch(page, "Table view");
      await page.evaluateOnNewDocument(() => {
        window.__firstRow = new Promise((done) => {
          const observer = new MutationObserver(() => {
            if (!document.querySelector(".table-row")) return;
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())));
          });
          // The document itself, not `documentElement` — this script runs
          // before any of the page does, when there is no `<html>` yet.
          observer.observe(document, { childList: true, subtree: true });
        });
      });
      await page.evaluate(() => localStorage.setItem("ocx-catalog-view", '"table"'));
      await page.reload({ waitUntil: "domcontentloaded" });
      samples["stored table view"].push(await page.evaluate(() => window.__firstRow));

      await context.close();
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
      `  ${ok ? "ok  " : "FAIL"} ${name.padEnd(18)} ${value.toFixed(0).padStart(6)}ms  ` +
        `(budget ${budget}ms; runs ${taken.map((t) => t.toFixed(0)).join(", ")})`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Over budget: ${failures.join(", ")}.\n` +
        "The catalog builds every package it shows, so this grows with the\n" +
        "catalog. Check what a card mounts before raising the number.",
    );
  }
  console.log("\nthe catalog builds within budget at corporate size");
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
