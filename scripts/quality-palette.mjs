#!/usr/bin/env node
/**
 * Palette gates (D-094..D-107, D-174), measured in a real browser over the built `root` fixture site
 * (base `/`, a docs mount). The behaviour belongs to the theme's `CommandPalette`; what a browser has
 * to prove here is that the catalog wired it up: "/" and Mod+K open it on the right pages, the search
 * source loads on the first open only, packages and docs both answer, and the geometry holds. jsdom
 * runs no layout and no real keyboard, so none of this is provable there.
 *
 * Every check is a `check(...)` whose title starts with its D-id (the parity gate reads them). A
 * negative assertion (not open, no request) is paired with a control that proves the positive state is
 * reachable on the same page, so "nothing happened" cannot read as green.
 *
 * Usage: CHROME_PATH=<chrome> node scripts/quality-palette.mjs
 * Needs `dist/` (npm run build). One browser, one page at a time.
 */
/* The page.evaluate callbacks below are serialised and run inside Chrome, so
   their identifiers resolve against the browser, not Node. */
/* global document, getComputedStyle, KeyboardEvent */
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "./lib/serve.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT = '.ocx-cmdpalette [data-part="content"]';
const INPUT = "[data-cmdpalette-input]";
const OPTIONS = '.ocx-cmdpalette [role="option"]';
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Real directory owning `node_modules`: where the CLI's scratch root can resolve `astro` (worktree-safe). */
const cliCwd = async () => dirname(await realpath(join(ROOT, "node_modules")));

async function build(out) {
  execFileSync(
    process.execPath,
    [join(ROOT, "dist/cli/index.js"), "build", "--config", join(ROOT, "test/fixtures/site/root.config.json"), "--out", out],
    { cwd: await cliCwd(), stdio: "pipe", encoding: "utf8" },
  );
}

const isOpen = (page) =>
  page.evaluate((selector) => {
    const content = document.querySelector(selector);
    return content !== null && !content.hidden && content.dataset.state === "open";
  }, CONTENT);
const waitOpen = (page, want = true) =>
  page
    .waitForFunction(
      (selector, wanted) => {
        const content = document.querySelector(selector);
        return (content !== null && !content.hidden && content.dataset.state === "open") === wanted;
      },
      { timeout: 5_000 },
      CONTENT,
      want,
    )
    .then(() => true, () => false);
const waitOptions = (page, atLeast = 1) =>
  page
    .waitForFunction((selector, n) => document.querySelectorAll(selector).length >= n, { timeout: 10_000 }, OPTIONS, atLeast)
    .then(() => true, () => false);
const chord = async (page) => {
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
};
const selectedIndex = (page) =>
  page.evaluate((selector) => [...document.querySelectorAll(selector)].findIndex((o) => o.getAttribute("aria-selected") === "true"), OPTIONS);

/** A fresh page; the requests it makes are collected in `log`. */
async function newPage(browser, origin, path, { platform } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const log = [];
  page.on("request", (request) => log.push(new URL(request.url()).pathname));
  if (platform !== undefined) {
    await page.evaluateOnNewDocument((value) => {
      Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: value }) });
    }, platform);
  }
  await page.goto(`${origin}${path}`, { waitUntil: "load" });
  return { page, log };
}

async function run(browser, origin) {
  // --- D-094: "/" opens the palette everywhere but the catalog index (the grid claims it there) -----
  for (const path of ["/tools/modern/", "/docs/guide/getting-started/", "/404.html"]) {
    const { page } = await newPage(browser, origin, path);
    await page.keyboard.press("/");
    check(`D-094 "/" opens the palette on ${path}`, await waitOpen(page));
    await page.close();
  }
  {
    const { page } = await newPage(browser, origin, "/");
    await page.keyboard.press("/");
    await sleep(700);
    check('D-094 "/" does not open the palette on the catalog index (the grid claims it)', !(await isOpen(page)));
    // Control: the key was not dead, the grid took it (the same key opens the palette on the three pages above).
    check(
      'D-094 control: "/" on the catalog index focuses the grid filter instead',
      await page.evaluate(() => document.activeElement === document.querySelector("input[data-grid-search]")),
    );
    await page.close();
  }
  {
    // Fresh page: after "/" the grid's filter has focus, and the theme leaves chords typed in other fields alone.
    const { page } = await newPage(browser, origin, "/");
    await chord(page);
    check("D-094 control: Mod+K still opens the palette on the catalog index", await waitOpen(page));
    await page.close();
  }

  // --- D-106: nothing loads before the first open, and the chord never waits on a chunk -------------
  {
    const { page, log } = await newPage(browser, origin, "/tools/modern/");
    await sleep(700);
    const scripts = () => new Set(log.filter((path) => path.endsWith(".js")));
    const before = scripts();
    const docsIndexRequests = () => log.filter((path) => path.endsWith("/docs-index.json")).length;
    check("D-106 before the first open no catalog.json request was made", !log.some((path) => path.endsWith("catalog.json")));
    check("D-174 before the first open no docs-index.json request was made", docsIndexRequests() === 0, `${docsIndexRequests()}`);
    const prevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    check("D-106 Mod+K is handled synchronously by the page script: preventDefault runs before any chunk loads", prevented);
    await waitOpen(page);
    await sleep(700);
    check("D-174 the first open fetches docs-index.json exactly once", docsIndexRequests() === 1, `${docsIndexRequests()}`);
    const loaded = [...scripts()].filter((path) => !before.has(path));
    check("D-106 control: the first open loads the dialog and search chunks", loaded.length > 0, loaded.join(", "));
    check("D-106 the first open fetches catalog.json exactly once", log.filter((path) => path.endsWith("/catalog.json")).length === 1);
    await page.close();
  }

  // --- the open palette: keyboard, reset, geometry --------------------------------------------------
  const { page } = await newPage(browser, origin, "/tools/modern/");
  const bar = () => page.evaluate(() => document.querySelector(".ocx-cmdpalette__bar").getBoundingClientRect().top);

  await chord(page);
  check("D-098 Mod+K opens the palette", await waitOpen(page));
  await sleep(700); // the card animates in; geometry is read once it has settled
  const content = await page.evaluate((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { top: rect.top, width: rect.width };
  }, CONTENT);
  check("D-105 the card sits 12vh from the top (108px at 900px)", Math.abs(content.top - 108) <= 2, `${content.top}`);
  check("D-105 the card is min(90vw, 560px) wide (560px at 1280px)", Math.abs(content.width - 560) <= 2, `${content.width}`);
  const barBefore = await bar();
  check("D-099 the input is focused and the hint shows on open",
    await page.evaluate((input) => document.activeElement === document.querySelector(input), INPUT) &&
      (await page.evaluate(() => !document.querySelector("[data-cmdpalette-hint]").hidden)),
  );

  await page.keyboard.type("lite");
  const listed = await waitOptions(page, 2);
  check("D-101 a query lists package rows", listed);
  check(
    "D-101 rows are real links: a[role=option][href]",
    await page.evaluate((selector) => [...document.querySelectorAll(selector)].every((o) => o.tagName === "A" && o.getAttribute("href")), OPTIONS),
  );
  check("D-105 the search bar does not move when results appear", Math.abs((await bar()) - barBefore) < 1, `${barBefore} -> ${await bar()}`);
  check(
    "D-105 only the results scroll: .ocx-cmdpalette__results scrolls, the card does not",
    await page.evaluate((selector) => {
      const overflow = (el) => getComputedStyle(el).overflowY;
      return /auto|scroll/.test(overflow(document.querySelector(".ocx-cmdpalette__results"))) && !/auto|scroll/.test(overflow(document.querySelector(selector)));
    }, CONTENT),
  );

  check("D-095 the first row is highlighted", (await selectedIndex(page)) === 0);
  await page.keyboard.press("ArrowDown");
  check("D-095 ArrowDown moves the highlight", (await selectedIndex(page)) === 1);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const count = await page.evaluate((selector) => document.querySelectorAll(selector).length, OPTIONS);
  check("D-095 ArrowUp from the first row wraps to the last", (await selectedIndex(page)) === count - 1, `${await selectedIndex(page)} of ${count}`);
  await page.keyboard.press("ArrowDown");
  check("D-095 ArrowDown from the last row wraps to the first", (await selectedIndex(page)) === 0);
  const second = (await page.$$(OPTIONS))[1];
  const box = await second.boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  check("D-095 hovering a row moves the highlight to it", (await selectedIndex(page)) === 1);
  const target = await page.evaluate((selector) => document.querySelectorAll(selector)[1].getAttribute("href"), OPTIONS);
  await Promise.all([page.waitForNavigation({ timeout: 10_000 }).catch(() => {}), page.keyboard.press("Enter")]);
  check("D-095 Enter opens the highlighted row, not the first", new URL(page.url()).pathname === target, `${page.url()} vs ${target}`);

  // After navigating, a fresh page for the close and reset behaviours.
  await page.goto(`${origin}/tools/modern/`, { waitUntil: "load" });
  await chord(page);
  await waitOpen(page);
  await page.keyboard.type("lite");
  await waitOptions(page);
  await chord(page);
  check("D-098 a second Mod+K closes the palette, with text typed", await waitOpen(page, false));
  await chord(page);
  await waitOpen(page);
  check("D-099 reopening starts empty with the hint back and the input focused",
    (await page.evaluate((input) => document.querySelector(input).value, INPUT)) === "" &&
      (await page.evaluate(() => !document.querySelector("[data-cmdpalette-hint]").hidden)) &&
      (await page.evaluate((input) => document.activeElement === document.querySelector(input), INPUT)) &&
      (await page.evaluate((selector) => document.querySelectorAll(selector).length, OPTIONS)) === 0,
  );

  await page.keyboard.type("lite");
  await waitOptions(page);
  await page.keyboard.press("Escape");
  check("D-104 one Escape closes the palette with text typed", await waitOpen(page, false));
  await chord(page);
  await waitOpen(page);
  await page.click("[data-cmdpalette-close]");
  check("D-104 the visible Esc button closes the palette", await waitOpen(page, false));

  // --- D-102: a pick closes the palette before the browser follows the link ---------------------------
  await chord(page);
  await waitOpen(page);
  await page.keyboard.type("lite");
  await waitOptions(page);
  await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));
  await (await page.$(OPTIONS)).click();
  check("D-102 a pick closes the palette first (navigation held back, so this is what a bfcache Back returns to)", await waitOpen(page, false));

  // --- D-174: the palette searches docs too ----------------------------------------------------------
  await chord(page);
  await waitOpen(page);
  await page.keyboard.type("install");
  await waitOptions(page);
  await page.waitForFunction(() => [...document.querySelectorAll(".ocx-cmdpalette__group-label")].some((l) => l.textContent === "Docs"), { timeout: 10_000 }).catch(() => {});
  const docs = await page.evaluate(() => {
    const label = [...document.querySelectorAll(".ocx-cmdpalette__group-label")].find((l) => l.textContent === "Docs");
    const rows = label ? [...label.parentElement.querySelectorAll('[role="option"]')] : [];
    return rows.map((row) => ({ href: row.getAttribute("href"), sub: row.querySelector(".ocx-cmdpalette__option-sub")?.textContent ?? "" }));
  });
  check("D-174 a query also lists a Docs group of docs pages", docs.length > 0 && docs.every((row) => row.href.startsWith("/docs/")), JSON.stringify(docs));
  check("D-174 docs rows carry their section as breadcrumbs", docs.some((row) => row.sub.length > 0), JSON.stringify(docs));
  check(
    "D-174 the placeholder reads \"Search packages and docs…\"",
    (await page.evaluate((input) => document.querySelector(input).placeholder, INPUT)) === "Search packages and docs…",
  );
  await page.close();

  // --- D-107: Apple platforms (iPhone, iPad included) get the Command glyph ---------------------------
  for (const [platform, expected] of [["MacIntel", "mac"], ["iPhone", "mac"], ["iPad", "mac"], ["Win32", "windows"]]) {
    const { page: apple } = await newPage(browser, origin, "/", { platform });
    const shown = await apple.evaluate(() => ({
      platform: document.documentElement.dataset.platform,
      glyph: [...document.querySelectorAll("[data-cmdpalette-trigger] .ocx-kbd-key > span")].find((s) => getComputedStyle(s).display !== "none")?.textContent ?? "",
    }));
    check(
      `D-107 platform "${platform}" shows ${expected === "mac" ? "the Command glyph" : "Ctrl"}`,
      shown.platform === expected && (expected === "mac" ? shown.glyph.includes("⌘") : shown.glyph.includes("Ctrl")),
      JSON.stringify(shown),
    );
    await apple.close();
  }
}

async function main() {
  const puppeteer = (await import("puppeteer-core")).default;
  const chromePath = process.env.CHROME_PATH || undefined;
  const scratch = await mkdtemp(join(tmpdir(), "ocx-quality-palette-"));
  let browser;
  let server;
  try {
    const dist = resolve(scratch, "root");
    await build(dist);
    server = await serve(dist);
    browser = await puppeteer.launch({
      ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
      headless: true,
      args: ["--no-sandbox"],
    });
    await run(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser?.close();
    await new Promise((done) => (server ? server.close(done) : done()));
    await rm(scratch, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} palette gate(s) failed`);
    process.exit(1);
  }
  console.log("\nall palette checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
