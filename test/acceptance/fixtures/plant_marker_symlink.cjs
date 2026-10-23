// Preloaded with `NODE_OPTIONS=--require <this file>` (staging.test.ts, D-151):
// plants `OCX_TEST_MARKER_PREFIX<pid>` as a symlink to OCX_TEST_MARKER_VICTIM
// for THIS process's pid, which is exactly where the build writes its sibling
// marker, as a symlink committed next to `--out` would sit. The variable is
// deleted once planted, so the astro child plants nothing.
const fs = require("node:fs");
const prefix = process.env.OCX_TEST_MARKER_PREFIX;
if (prefix !== undefined) {
  fs.symlinkSync(process.env.OCX_TEST_MARKER_VICTIM, `${prefix}${process.pid}`);
  delete process.env.OCX_TEST_MARKER_PREFIX;
}
