// Preloaded with `NODE_OPTIONS=--require <this file>` (helpers.ts `plantedFailure`):
// the first rename of a staging directory onto OCX_TEST_FAIL_RENAME_TO throws,
// which is the promotion's second rename (`staging -> outDir`). Every other
// rename, the promotion's rollback included, goes through. Only the CLI process
// has a staging path; the astro child never renames one.
const fsp = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const original = fsp.rename;
let armed = true;
fsp.rename = async (from, to) => {
  if (armed && String(from).includes(".staging-") && String(to) === process.env.OCX_TEST_FAIL_RENAME_TO) {
    armed = false;
    throw Object.assign(new Error("planted promotion failure"), { code: "EXDEV" });
  }
  return original(from, to);
};
syncBuiltinESMExports();
