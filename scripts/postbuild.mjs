#!/usr/bin/env node
/**
 * `npm run build` epilogue. `tsc` compiles `src/**\/*.ts` only, so:
 *   1. the CLI entry gets its executable bit, and
 *   2. every `src/site/**\/*.astro` is copied next to the compiled JS in
 *      `dist/site/`, where the integration's `new URL("./pages/…", import.meta.url)`
 *      expects the injected route entrypoints (and their layouts/components).
 *   3. outputs whose source was deleted are pruned: `tsc` never removes them,
 *      and `files: ["dist"]` would ship them. Pruned in place rather than by a
 *      clean rebuild, since tests read `dist/` while pack-smoke rebuilds it.
 */
import { chmodSync, cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";

chmodSync("dist/cli/index.js", 0o755);
cpSync("src/site", "dist/site", {
  recursive: true,
  filter: (source) => statSync(source).isDirectory() || source.endsWith(".astro"),
});

for (const rel of readdirSync("dist", { recursive: true, encoding: "utf8" })) {
  const source = rel.endsWith(".astro") ? rel : rel.replace(/\.(?:js|d\.ts)(?:\.map)?$/, ".ts");
  if (source.endsWith(".ts") || source.endsWith(".astro")) {
    if (!existsSync(`src/${source}`)) rmSync(`dist/${rel}`);
  }
}
