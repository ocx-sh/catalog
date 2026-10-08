// Preloaded with `NODE_OPTIONS=--require <this file>` (helpers.ts `plantedFailure`):
// the `astro` child prints one line and exits 3 before rendering anything. The
// `ocx-catalog` CLI process itself, whose entry is not under node_modules/astro/,
// is untouched, so the engine sees exactly what a crashing render looks like.
const entry = (process.argv[1] ?? "").split("\\").join("/");
if (entry.includes("/node_modules/astro/")) {
  console.error("planted astro failure");
  process.exit(3);
}
