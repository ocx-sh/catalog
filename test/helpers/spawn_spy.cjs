// Preloaded with `NODE_OPTIONS=--require <this file>` and `OCX_SPAWN_LOG=<file>`:
// appends one JSON line per `child_process` launch (`{ pid, fn, argv }`) so a test
// can prove which processes a CLI run started (C-025: `ocx-catalog ci` starts no
// `astro`). A `loaded` line is written first, so an empty log means "the spy ran
// and nothing launched" and a missing file means "the spy never loaded".
const childProcess = require("node:child_process");
const { appendFileSync } = require("node:fs");

const log = process.env.OCX_SPAWN_LOG;
if (log) {
  const record = (fn, argv) => appendFileSync(log, `${JSON.stringify({ pid: process.pid, fn, argv })}\n`);
  record("loaded", process.argv);
  for (const fn of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const real = childProcess[fn];
    childProcess[fn] = function (...args) {
      record(fn, args.filter((arg) => typeof arg === "string" || Array.isArray(arg)).flat());
      return real.apply(this, args);
    };
  }
}
