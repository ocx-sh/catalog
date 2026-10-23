#!/usr/bin/env node
/**
 * axe-core over built pages (plan G.3, C-017 "axe clean"): the landing page,
 * a detail page, the 404 and a docs page of the `root` fixture, each in both
 * colour schemes (contrast differs per scheme) and the landing page again with
 * the Mod+K palette open — a closed dialog is not in the accessibility tree,
 * so axe cannot see what an open one gets wrong. The open state is checked on
 * the dialog alone: a modal hides the rest of the page by design, so the
 * page-level rules do not apply to it.
 *
 * Lighthouse's accessibility category runs a subset of the same rules; this
 * runs all of them (WCAG 2.2 AA tags) and fails on any violation. axe is
 * `axe-core`, which `@lhci/cli` already brings in; `puppeteer-core` drives it.
 *
 * `--red-demo` plants an image without `alt` and an unlabelled button into the
 * landing page and requires axe to report both, so a green run is known able
 * to go red.
 *
 * Usage: node scripts/quality-axe.mjs [chromePath] [--site DIR] [--red-demo]
 */
/* The page.evaluate callbacks below are serialised and run inside Chrome, so
   their identifiers resolve against the browser, not Node. */
/* global document, axe */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { serve } from "./lib/serve.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES = ["/", "/sharkdp/bat/", "/404.html", "/docs/guide/getting-started/"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: "string", default: ".lhci-budget/root" },
    "red-demo": { type: "boolean", default: false },
  },
});
const chromePath = positionals[0] || process.env.CHROME_PATH || undefined;

/** axe's own bundle, read from `axe-core` (a dependency of `@lhci/cli`). */
async function axeSource() {
  try {
    return await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  } catch (error) {
    throw new Error("axe-core is not installed (it comes with @lhci/cli): run npm ci", { cause: error });
  }
}

/** Run axe on `context` (the whole page by default); resolves to `rule: first selector` lines. */
async function violations(page, context = "html") {
  const results = await page.evaluate(
    (include, tags) => axe.run({ include: [[include]] }, { runOnly: { type: "tag", values: tags } }),
    context,
    TAGS,
  );
  return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`);
}

async function main() {
  const source = await axeSource();
  const server = await serve(resolve(ROOT, values.site));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
    headless: true,
    args: ["--no-sandbox"],
  });
  const found = [];
  try {
    const open = async (path, scheme) => {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true });
      // The pages carry a CSP that forbids the inline injection axe needs.
      await page.setBypassCSP(true);
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await page.goto(`${origin}${path}`, { waitUntil: "networkidle0" });
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), scheme);
      await page.evaluate(source);
      return page;
    };
    for (const scheme of ["light", "dark"]) {
      for (const path of PAGES) {
        const page = await open(path, scheme);
        if (values["red-demo"] && path === "/") {
          await page.evaluate(() => {
            document.body.insertAdjacentHTML("beforeend", '<img src="/favicon.svg"><button></button>');
          });
        }
        const list = await violations(page);
        console.log(`  ${list.length === 0 ? "ok  " : "FAIL"} ${scheme.padEnd(5)} ${path}`);
        for (const line of list) found.push(`${scheme} ${path}: ${line}`);
        await page.close();
      }
      const page = await open("/", scheme);
      await page.keyboard.down("Control");
      await page.keyboard.press("k");
      await page.keyboard.up("Control");
      await page.waitForSelector('[data-zag-root="dialog"] [data-part="content"]:not([hidden])', { timeout: 10_000 });
      // The dialog fades in; axe must read final colours.
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      // The dialog alone: a modal hides the rest of the page from assistive tech by design, so the
      // page-level rules (one main landmark, one h1, focusable skip link) do not apply to that state.
      const list = await violations(page, '[data-zag-root="dialog"] [data-part="content"]');
      console.log(`  ${list.length === 0 ? "ok  " : "FAIL"} ${scheme.padEnd(5)} / with the palette open`);
      for (const line of list) found.push(`${scheme} / (palette open): ${line}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (values["red-demo"]) {
    const ids = found.map((line) => line.split(": ")[1]);
    const red = ["image-alt", "button-name"].every((id) => ids.some((line) => line.startsWith(id)));
    if (!red) throw new Error(`The planted violations were not both reported:\n  ${found.join("\n  ")}`);
    console.log(`\nthe planted violations are reported:\n  ${found.join("\n  ")}`);
    return;
  }
  if (found.length > 0) throw new Error(`axe violations:\n  ${found.join("\n  ")}`);
  console.log("\naxe is clean on every page, in both schemes");
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
