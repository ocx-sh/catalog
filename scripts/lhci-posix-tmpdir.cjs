/**
 * Preloaded (`node --require`) by `task quality:web` for the Lighthouse CI run.
 *
 * ## What it fixes
 *
 * `chrome-launcher` treats WSL as a platform of its own: instead of the POSIX
 * `mktemp -d`, it derives Chrome's `--user-data-dir` from a Windows
 * `…\Users\<user>\AppData\…` path it parses **out of `$PATH`**
 * (`getWSLLocalAppDataPath`). In a WSL shell whose `$PATH` carries no Windows
 * interop entries the regex captures nothing, and the profile directory becomes
 * the literal, *relative* string
 * `undefined:\Users\undefined\AppData\Local\lighthouse.<n>` — which Chrome then
 * creates **inside the repository working tree**, one directory per Lighthouse
 * run (58 of them on the run that surfaced this).
 *
 * Forcing `is-wsl` to `false` selects `chrome-launcher`'s POSIX branch, so the
 * profile lands in `$TMPDIR` and is cleaned up by the launcher as designed.
 *
 * ## Why this is safe as an unconditional preload
 *
 * It is a **no-op wherever `is-wsl` is already false** — CI runs plain Linux —
 * so `task quality:web` stays the byte-identical command locally and in CI,
 * which is the whole point of routing every gate through `task`. The only
 * behaviour it can change is on WSL, where the WSL branch is already broken.
 *
 * Both interception points are needed: `chrome-launcher@0.13` (via `@lhci/cli`)
 * is CommonJS and resolves `is-wsl` through `Module._load`, while
 * `chrome-launcher@1.2` (via `lighthouse`) is ESM and reaches the same CommonJS
 * `is-wsl` through the ESM→CJS translator, which consults `Module._cache`
 * first. Seeding the cache alone would miss the former; hooking `_load` alone
 * would miss the latter.
 */
"use strict";

const Module = require("node:module");

let resolved;
try {
  resolved = require.resolve("is-wsl");
} catch {
  // is-wsl absent: nothing to neutralize, and nothing depends on it.
  resolved = undefined;
}

if (resolved !== undefined) {
  const stub = new Module(resolved, null);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = false;
  Module._cache[resolved] = stub;

  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === "is-wsl" ? false : load.call(this, request, ...rest);
  };
}
