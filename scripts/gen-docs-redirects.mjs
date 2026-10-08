#!/usr/bin/env node
// Writes the meta-refresh stub tree that replaces the old MkDocs site on GitHub
// Pages (https://ocx-sh.github.io/catalog/) once the docs are served from
// https://ocx.sh/apps/catalog/. One `index.html` per old URL in
// docs/redirects.json; pages.yml's manual `redirect-stubs` job deploys the tree.
//
//   node scripts/gen-docs-redirects.mjs --out <dir>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REDIRECTS = fileURLToPath(new URL("../docs/redirects.json", import.meta.url));

// "" (the site root) or lowercase slug segments each ending in "/". The data is
// checked in, but it becomes a path under --out and an href, so it is validated.
const PAGE_PATH = /^(?:[a-z0-9][a-z0-9-]*\/)*$/;

/** The stub page for one old URL: refresh + canonical to `target`. */
export function renderStub(target) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting to ${target}</title>
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0; url=${target}">
<meta name="robots" content="noindex">
</head>
<body>
<p>This page moved to <a href="${target}">${target}</a>.</p>
</body>
</html>
`;
}

/** Writes one stub per old URL under `outDir`; returns the old URLs written. */
export function generateStubs(config, outDir) {
  const written = [];
  for (const [oldPath, newPath] of Object.entries(config.redirects)) {
    for (const p of [oldPath, newPath]) {
      if (!PAGE_PATH.test(p)) throw new Error(`redirects.json: invalid page path ${JSON.stringify(p)}`);
    }
    const file = join(outDir, oldPath, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderStub(config.to + newPath));
    written.push(oldPath);
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { out } = parseArgs({ options: { out: { type: "string" } } }).values;
  if (!out) {
    process.stderr.write("usage: gen-docs-redirects.mjs --out <dir>\n");
    process.exit(2);
  }
  const written = generateStubs(JSON.parse(readFileSync(REDIRECTS, "utf8")), resolve(out));
  process.stdout.write(`wrote ${written.length} redirect stubs to ${out}\n`);
}
