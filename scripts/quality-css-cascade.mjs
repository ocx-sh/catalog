#!/usr/bin/env node
/**
 * Proves, in a real browser, that a consumer stylesheet can actually override
 * the theme — the central claim of the CSS contract.
 *
 * Everything else in the suite checks this at the source or byte level:
 * `layer_contract.test.ts` proves the wrapper is authored,
 * `css_layer_real_build.test.ts` proves it survives the build. Neither proves a
 * browser APPLIES it. That gap cannot be closed with the DOM shims already in
 * the repo: happy-dom drops `@layer` blocks at parse time and jsdom parses them
 * but never applies layered declarations, so an assertion in either passes
 * whether or not the mechanism works — the exact vacuous green
 * `quality-core.md` warns about.
 *
 * Runs from `task quality:web`, reusing the Chrome that task already resolves
 * and driving it with `puppeteer-core`, which Lighthouse itself already uses
 * for the same job. `chrome-launcher` alone returns a debugging port; getting
 * from there to `getComputedStyle` would mean hand-rolling the CDP wire
 * protocol, which `quality-core.md` treats as Block-tier.
 *
 * Usage: node scripts/quality-css-cascade.mjs [chromePath]
 */
/* The `page.evaluate()` callback below is serialised and run inside Chrome, so
   its identifiers resolve against the browser, not Node. */
/* global document, getComputedStyle */
import { createServer } from "node:http";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(ROOT, "test/fixtures/quality-index");
const PROBE_CONFIG = join(FIXTURE_DIR, "cascade-probe.config.json");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".md": "text/markdown",
  ".woff2": "font/woff2",
};

function serve(dir) {
  const server = createServer(async (req, res) => {
    let path = decodeURI(req.url.split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    if (!extname(path)) path += ".html";
    try {
      const body = await readFile(join(dir, path));
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The probe stylesheet uses ONLY public surface: a data-slot selector, a
 *  component hook, and a token. Nothing here targets an internal class. */
const PROBE_CSS = `
[data-slot="package-card"] {
  --ocx-package-card-radius: 0px;
  border-color: rgb(1, 2, 3);
}
[data-slot="keyword"] { --ocx-keyword-background: rgb(4, 5, 6); }
:root { --ocx-color-bg: rgb(7, 8, 9); }
`;

const EXPECTED = {
  cardRadius: "0px",
  cardBorder: "rgb(1, 2, 3)",
  keywordBackground: "rgb(4, 5, 6)",
  pageBackground: "rgb(7, 8, 9)",
};

async function main() {
  const chromePath = process.argv[2] || process.env.CHROME_PATH || undefined;
  const outDir = await mkdtemp(join(tmpdir(), "ocx-cascade-"));
  const probeCss = join(FIXTURE_DIR, "cascade-probe.css");

  // The config lives beside the fixture so `css` and the source `path` both
  // pass the loader's containment check, and leaves the real
  // catalog.config.json untouched — Lighthouse's thresholds are tuned to that
  // exact site and a probe element must not perturb them.
  const base = JSON.parse(await readFile(join(FIXTURE_DIR, "catalog.config.json"), "utf8"));
  await writeFile(probeCss, PROBE_CSS, "utf8");
  await writeFile(PROBE_CONFIG, JSON.stringify({ ...base, css: "./cascade-probe.css" }, null, 2), "utf8");

  let server;
  let browser;
  try {
    execFileSync(process.execPath, [join(ROOT, "dist/cli/index.js"), "build", "--config", PROBE_CONFIG, "--out", outDir], {
      stdio: "inherit",
    });

    server = await serve(outDir);
    const { port } = server.address();
    const puppeteer = (await import("puppeteer-core")).default;
    // No path handed in (the CI runner has no puppeteer cache to glob): let
    // puppeteer resolve the system Chrome install itself.
    browser = await puppeteer.launch({
      ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-slot="package-card"]', { timeout: 15_000 });

    const actual = await page.evaluate(() => {
      const card = document.querySelector('[data-slot="package-card"]');
      const keyword = document.querySelector('[data-slot="keyword"]');
      const cs = getComputedStyle;
      return {
        cardRadius: cs(card).borderTopLeftRadius,
        cardBorder: cs(card).borderTopColor,
        keywordBackground: keyword ? cs(keyword).backgroundColor : "(no keyword chip rendered)",
        pageBackground: cs(document.body).backgroundColor,
      };
    });

    const failures = Object.entries(EXPECTED).filter(([k, want]) => actual[k] !== want);
    for (const [k, want] of Object.entries(EXPECTED)) {
      console.log(`  ${actual[k] === want ? "ok  " : "FAIL"} ${k}: ${actual[k]} (want ${want})`);
    }
    if (failures.length > 0) {
      // Throw rather than process.exit(): exit() terminates immediately and
      // skips the finally below, which would leave the probe config and
      // stylesheet behind in a committed fixture directory.
      throw new Error(
        "A consumer stylesheet failed to override the theme in a real browser.\n" +
          "The most likely cause is theme CSS escaping `@layer ocx` — an unlayered\n" +
          "theme rule outranks a consumer's by specificity, silently.",
      );
    }
    console.log("\ncascade contract holds: consumer CSS overrides the theme in a real browser");
  } finally {
    await browser?.close();
    server?.close();
    await rm(outDir, { recursive: true, force: true });
    await rm(probeCss, { force: true });
    await rm(PROBE_CONFIG, { force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
