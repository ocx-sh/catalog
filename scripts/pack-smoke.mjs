#!/usr/bin/env node
/**
 * Pack-gate smoke check for `@ocx-sh/catalog` (research: pack verification,
 * `.claude/artifacts/research_npm_publish_hygiene.md`, index repo).
 *
 * Contract this script enforces before every publish:
 *   1. `npm pack` the package into a tarball.
 *   2. `npx publint` the tarball — export map / bin / types correctness.
 *   3. `npx @arethetypeswrong/cli --pack` the tarball — type resolution
 *      across module systems.
 *   4. Install the tarball into a fresh `mkdtemp` sandbox with npm scripts
 *      disabled (`--ignore-scripts`), then run `ocx-catalog --version` from
 *      the installed bin to prove the `bin` entry survived packing.
 *   5. From that same sandbox, `import.meta.resolve("@ocx-sh/catalog/theme")`
 *      to prove the theme subpath export + its `files` entry survived
 *      packing too — a full VitePress evaluation of the theme needs a
 *      Vue/Vite pipeline this script doesn't have, but resolution alone
 *      already fails on exactly the regression that matters here: the
 *      `exports["./theme"]` entry missing, or its target file absent from
 *      the tarball (e.g. a `files` edit that drops `src/theme`).
 *   6. From that same sandbox, walk every shipped source file (`.js`,
 *      `.mjs`, `.ts`, `.mts`, `.vue` — not `.d.ts`/`.d.mts`, which are
 *      type-only and already covered by attw) under
 *      `node_modules/@ocx-sh/catalog`, extract every static AND dynamic
 *      import specifier, and resolve each one with `import.meta.resolve()`
 *      — dependency completeness. This is the class WP-08 caught by hand:
 *      `ReadmePane.vue` imports `markdown-it`/`highlight.js` only via
 *      dynamic `import()`, which a static-import grep misses. The sandbox's
 *      `node_modules` holds only what `dependencies`/`peerDependencies`
 *      declare (npm installs from the packed tarball, never this repo's own
 *      devDependencies), so an unresolvable specifier here is the real bug
 *      — declared in the wrong manifest section — not a sandbox artifact.
 *   7. Fail the whole run if `npm pack` output contains the string
 *      "auto-corrected" — npm silently rewriting the manifest (e.g.
 *      dropping `bin`) is a hard failure, not a warning (grim 0.1.0
 *      precedent, see research doc). When
 *      `OCX_CATALOG_PACK_SMOKE_NETWORK=1` is set, additionally run `npm
 *      publish --dry-run` against the packed tarball and apply the same
 *      check — this is the stricter manifest-normalization pass that
 *      `npm pack` alone does not trigger (verified empirically: a `bin`
 *      path of `"./dist/cli/index.js"` only warned under `publish`, never
 *      under `pack`). That step needs real registry connectivity (verified
 *      empirically: it hangs against an unreachable registry rather than
 *      failing fast), so it's opt-in — `npm test` stays offline-safe by
 *      default; `release.yml`'s own dry-run guard is the enforced copy at
 *      release time regardless of this flag.
 *   8. Assert the npm major version this script runs under EQUALS
 *      `EXPECTED_NPM_MAJOR` and fail otherwise, so a pack-format change in a
 *      future npm major does not silently pass.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Runs a command, capturing stdout/stderr; throws on non-zero exit. */
function run(step, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) {
    throw new Error(`${step}: failed to spawn "${command}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${step}: "${command} ${args.join(" ")}" exited ${String(result.status)}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

/** The npm major this script's assertions were verified against. Every check
 * below reads `npm pack --json` output and npm's own manifest-normalization
 * warnings — both of which npm is free to change across a major. Bump this
 * ONLY together with a re-verification of the whole script under the new
 * major (a green run after the bump is the evidence); a silent pass under an
 * npm whose pack format moved is exactly the regression this guards.
 * `release.yml` installs `npm@11.x` explicitly in the publish job, and
 * `actions/setup-node` with node 24 ships npm 11 in the gate job. */
const EXPECTED_NPM_MAJOR = 11;

function assertNpmMajor() {
  const result = spawnSync("npm", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`assert npm version: "npm --version" exited ${String(result.status)}`);
  }
  const version = result.stdout.trim();
  const match = /^(\d+)\./.exec(version);
  if (!match) {
    throw new Error(`assert npm version: could not parse npm major version from "${version}"`);
  }
  const major = Number(match[1]);
  if (major !== EXPECTED_NPM_MAJOR) {
    throw new Error(
      `assert npm version: this script's pack-format assertions are verified against npm ` +
        `${String(EXPECTED_NPM_MAJOR)}.x, but it is running under npm ${version} — re-verify the ` +
        `whole script under the new major, then bump EXPECTED_NPM_MAJOR in scripts/pack-smoke.mjs.`,
    );
  }
  return { version, major };
}

function assertNoAutoCorrect(step, outputs) {
  for (const output of outputs) {
    if (output.includes("auto-corrected")) {
      throw new Error(
        `${step}: npm silently auto-corrected the manifest (found "auto-corrected" ` +
          `in output) — this is a hard failure, not a warning:\n${output}`,
      );
    }
  }
}

function packTarball(step, packDir) {
  const result = run(step, "npm", ["pack", "--pack-destination", packDir, "--json"], {
    cwd: repoRoot,
  });
  assertNoAutoCorrect(step, [result.stdout, result.stderr]);
  const [entry] = JSON.parse(result.stdout);
  return join(packDir, entry.filename);
}

function runPublint(step, tarballPath) {
  const publintBin = join(repoRoot, "node_modules", ".bin", "publint");
  run(step, publintBin, ["run", tarballPath], { cwd: repoRoot });
}

function runAttw(step, tarballPath) {
  // The pure-ESM "require call resolved to an ESM file" warning class
  // (rule: cjs-resolves-to-esm) is expected and tolerated for this package
  // (type: module, no CJS entrypoint) — every other rule must still pass.
  //
  // "./theme" is excluded from attw's own resolution check (not from the
  // package's `exports` — it's still there for real consumers): attw
  // resolves imports through TypeScript's module graph, which doesn't
  // understand `.vue`/`.css` specifiers, so it reports every relative
  // import inside the theme as unresolvable. That's a limitation of attw's
  // resolver, not a real problem — VitePress's own Vite-based bundler
  // resolves those specifiers just fine. `installAndRunBin`'s
  // `import.meta.resolve` check is what actually guards this entrypoint.
  const attwBin = join(repoRoot, "node_modules", ".bin", "attw");
  run(
    step,
    attwBin,
    [tarballPath, "--ignore-rules", "cjs-resolves-to-esm", "--exclude-entrypoints", "./theme"],
    { cwd: repoRoot },
  );
}

/** Resolves (never evaluates) `specifier` from inside `installDir` — a bare
 * `node -e` child process, so it only sees what `require`/`import` resolution
 * from that sandbox's `node_modules` would see. Throws with the child's own
 * error text on any resolution failure (missing `exports` entry, or an
 * `exports` entry whose target file isn't actually in the tarball). */
function assertSubpathResolves(step, installDir, specifier) {
  const script = `
    const url = await import.meta.resolve(${JSON.stringify(specifier)});
    const { existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    if (!existsSync(fileURLToPath(url))) {
      throw new Error("resolved to " + url + " but that file does not exist");
    }
    console.log(url);
  `;
  const result = run(step, "node", ["--input-type=module", "-e", script], { cwd: installDir });
  return result.stdout.trim();
}

const PACKAGE_NAME = "@ocx-sh/catalog";
const SHIPPED_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".mts", ".vue"]);
const DECLARATION_SUFFIXES = [".d.ts", ".d.mts"];

/** Recursively collects shipped source files under `dir` — anything with a
 * `SHIPPED_SOURCE_EXTENSIONS` extension, except `.d.ts`/`.d.mts` declaration
 * files (type-only; attw already covers type resolution). Sorted for
 * deterministic error messages; `readdirSync` order isn't guaranteed. */
function collectShippedSourceFiles(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectShippedSourceFiles(full));
      continue;
    }
    if (DECLARATION_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    if (SHIPPED_SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

/** Strips line comments and block comments from `text`, replacing them with
 * whitespace so the rest of the file keeps its shape; string/template
 * literal contents pass through untouched. Without this, a prose comment
 * like "derived from 'upstream data'" would extract "upstream data" as a
 * bare import specifier and fail the gate on a phantom dependency — the
 * same false-positive class a `"http://…"` string inside a comment would
 * trigger against a naive `//`-strips-to-end-of-line regex.
 * ponytail: no regex-literal or nested-template-literal awareness (a real
 * ceiling of comment-stripping without a JS parser) — upgrade to a real
 * parser only if that ever produces a false positive here. */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (two === "/*") {
      out += "  ";
      i += 2;
      while (i < text.length && text.slice(i, i + 2) !== "*/") {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else if (text[i] === "'" || text[i] === '"' || text[i] === "`") {
      const quote = text[i];
      out += text[i];
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < text.length) {
          out += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        out += text[i];
        i++;
      }
      if (i < text.length) {
        out += text[i];
        i++;
      }
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/** Finds every `name(...)` call in `text` (`name` is `"import"` or
 * `"require"`) via a balanced-paren scan — a regex alone can't span nested
 * parens (e.g. `import(getPath())`). Returns `{ specifier }` when the whole
 * argument is a single plain quoted string literal, or `{ raw }` with the
 * verbatim argument text otherwise (a computed expression, which can't be
 * checked statically). */
function findCallSpecifiers(text, name) {
  const results = [];
  const calleeRe = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match;
  while ((match = calleeRe.exec(text))) {
    const argStart = match.index + match[0].length;
    let depth = 1;
    let i = argStart;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const raw = text.slice(argStart, i - 1).trim();
    const literal = /^(['"])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(raw);
    results.push(literal ? { specifier: literal[2] } : { raw });
    calleeRe.lastIndex = i;
  }
  return results;
}

// `import ... from "spec"` / `export ... from "spec"` — both share the
// trailing ` from "spec"` shape, so one pattern covers both keywords.
const IMPORT_FROM = /\bfrom\s*(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
// Side-effect-only `import "spec"` — also matches CSS `@import "spec";`
// inside a `.vue` `<style>` block (same "import" token followed by a quote).
const SIDE_EFFECT_IMPORT = /\bimport\s*(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/** Extracts every import specifier from one shipped file's `text` (comments
 * already stripped by the caller). Returns the list of bare specifier
 * strings found via static `from`/side-effect syntax plus `import()`/
 * `require()` string-literal calls, and a separate list of human-readable
 * lines describing any dynamic `import()`/`require()` call whose argument
 * was a computed expression — those can't be resolved statically, and are
 * reported rather than silently dropped. */
function extractSpecifiers(relPath, text) {
  const specifiers = [];
  const unchecked = [];
  for (const re of [IMPORT_FROM, SIDE_EFFECT_IMPORT]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text))) specifiers.push(match[2]);
  }
  for (const name of ["import", "require"]) {
    for (const call of findCallSpecifiers(text, name)) {
      if (call.specifier !== undefined) {
        specifiers.push(call.specifier);
      } else if (call.raw !== "") {
        unchecked.push(`${relPath}: ${name}(${call.raw}) — computed specifier, cannot check statically`);
      }
    }
  }
  return { specifiers, unchecked };
}

// Real npm scoped packages are always `@scope/name` — a bare `@word` with no
// slash can't be an installable dependency, so it must be a build-time
// virtual module (e.g. VitePress's `@localSearchIndex`, resolved only by its
// Vite plugin, never by node's own resolver).
const INVALID_SCOPED_SHAPE = /^@[^/]+$/;

/** True when `specifier` names something `dependencies`/`peerDependencies`
 * could actually satisfy — filters out relative/absolute paths, `node:`
 * imports, bare Node builtins, this package's own name (self-reference
 * resolves via its own `exports`, not a dependency), and virtual-module
 * specifiers that can never resolve outside a bundler. */
function isCheckableBareSpecifier(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("node:")) return false;
  if (specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`)) return false;
  if (INVALID_SCOPED_SHAPE.test(specifier)) return false;
  const packageRoot = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  if (builtinModules.includes(packageRoot)) return false;
  return true;
}

/** Proves every import reachable from the shipped `src/**` (as it landed in
 * the sandbox, under `node_modules/@ocx-sh/catalog`) resolves from
 * `dependencies`/`peerDependencies` alone — the gate WP-03/WP-08 lacked (see
 * file docblock step 6). Reuses `installDir`; does not create its own
 * sandbox. */
function assertDependencyCompleteness(step, installDir) {
  const packageDir = join(installDir, "node_modules", "@ocx-sh", "catalog");
  const files = collectShippedSourceFiles(packageDir);

  const specifierToFile = new Map();
  for (const file of files) {
    const relPath = relative(packageDir, file);
    const text = stripComments(readFileSync(file, "utf8"));
    const { specifiers, unchecked } = extractSpecifiers(relPath, text);
    for (const line of unchecked) {
      process.stderr.write(`pack-smoke: unchecked dynamic import — ${line}\n`);
    }
    for (const specifier of specifiers) {
      if (!isCheckableBareSpecifier(specifier)) continue;
      if (!specifierToFile.has(specifier)) specifierToFile.set(specifier, relPath);
    }
  }

  const specifiers = [...specifierToFile.keys()];
  const script = `
    const specifiers = ${JSON.stringify(specifiers)};
    const { existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const failures = [];
    for (const specifier of specifiers) {
      try {
        const url = await import.meta.resolve(specifier);
        if (!existsSync(fileURLToPath(url))) {
          failures.push({ specifier, reason: "resolved to " + url + " but that file does not exist" });
        }
      } catch (err) {
        failures.push({ specifier, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    console.log(JSON.stringify(failures));
  `;
  const result = run(step, "node", ["--input-type=module", "-e", script], { cwd: installDir });
  const failures = JSON.parse(result.stdout.trim());
  if (failures.length > 0) {
    const lines = failures.map(
      (f) => `  - "${f.specifier}" (from ${specifierToFile.get(f.specifier)}): ${f.reason}`,
    );
    throw new Error(
      `${step}: ${String(failures.length)} import specifier(s) don't resolve from the packed ` +
        `sandbox — add the missing package to "dependencies" or "peerDependencies" (never ` +
        `"devDependencies", which the sandbox never installs):\n${lines.join("\n")}`,
    );
  }
  process.stderr.write(
    `pack-smoke: dependency-completeness OK (${String(specifiers.length)} bare specifiers from ` +
      `${String(files.length)} shipped files all resolve)\n`,
  );
}

function installAndRunBin(step, tarballPath) {
  const installDir = mkdtempSync(join(tmpdir(), "ocx-catalog-pack-smoke-install-"));
  try {
    // A bare `npm install <tarball>` in a directory with no package.json of
    // its own walks up to the nearest ancestor package.json (this repo's)
    // and installs there instead — writing an `--ignore-scripts` sandbox
    // package.json pins the install to installDir.
    writeFileSync(
      join(installDir, "package.json"),
      JSON.stringify({ name: "ocx-catalog-pack-smoke-sandbox", private: true }),
    );
    run(step, "npm", ["install", "--ignore-scripts", tarballPath], { cwd: installDir });
    const binPath = join(installDir, "node_modules", ".bin", "ocx-catalog");
    const result = run(step, binPath, ["--version"], { cwd: installDir });
    const stdout = result.stdout.trim();
    if (stdout !== "0.1.0") {
      throw new Error(`${step}: expected installed bin to print "0.1.0", got "${stdout}"`);
    }
    const themeUrl = assertSubpathResolves(step, installDir, "@ocx-sh/catalog/theme");
    process.stderr.write(`pack-smoke: "@ocx-sh/catalog/theme" resolves to ${themeUrl}\n`);
    assertDependencyCompleteness(step, installDir);
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

/** Opt-in (`OCX_CATALOG_PACK_SMOKE_NETWORK=1`): the stricter manifest
 * normalization `npm publish` applies but `npm pack` does not — verified
 * empirically to require live registry connectivity (hangs rather than
 * failing fast against an unreachable registry), so this never runs as part
 * of the default, offline `npm test` path. `release.yml` carries the
 * non-optional copy of this same guard at actual release time.
 *
 * Deliberately run from `repoRoot` with NO tarball/path argument — verified
 * empirically that `npm publish <tarball-path> --dry-run` skips this
 * normalization pass entirely (it never reproduced the real bin-path bug
 * this guard exists to catch), while the bare `npm publish --dry-run` this
 * uses (reading `package.json` from cwd directly, same as `release.yml`'s
 * own publish step) does. */
function runPublishDryRunGuard(step) {
  if (process.env.OCX_CATALOG_PACK_SMOKE_NETWORK !== "1") {
    process.stderr.write(
      `${step}: skipped (needs registry network access — set OCX_CATALOG_PACK_SMOKE_NETWORK=1 to ` +
        `enable; release.yml's own dry-run guard always runs this check at release time)\n`,
    );
    return;
  }
  const result = run(step, "npm", ["publish", "--dry-run", "--provenance", "--access", "public"], {
    cwd: repoRoot,
  });
  assertNoAutoCorrect(step, [result.stdout, result.stderr]);
}

function main() {
  const { version: npmVersion, major: npmMajor } = assertNpmMajor();
  process.stderr.write(`pack-smoke: running under npm ${npmVersion} (major ${String(npmMajor)})\n`);

  const packDir = mkdtempSync(join(tmpdir(), "ocx-catalog-pack-smoke-pack-"));
  try {
    const tarballPath = packTarball("npm pack", packDir);
    runPublint("publint", tarballPath);
    runAttw("attw", tarballPath);
    installAndRunBin("install + run bin", tarballPath);
    runPublishDryRunGuard("npm publish --dry-run");
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

try {
  main();
  process.stderr.write("pack-smoke: OK\n");
  process.exitCode = 0;
} catch (err) {
  process.stderr.write(`pack-smoke: FAILED — ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
