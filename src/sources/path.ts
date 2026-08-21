/**
 * Filesystem source reader (C-003a). Two layers: `readPathSource` resolves
 * and safety-checks a config-relative `path` entry, then delegates to
 * `readDirectoryTree` — the shared "walk an already-resolved absolute
 * directory into a wire-shaped `SourceFiles.files` map" primitive `git.ts`
 * reuses too (plan: "optional `dir` subpath; then read as `path`").
 */

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PathSourceEntry } from "../config/types.js";
import { SourceError, type WirePath } from "./types.js";

/** Throws `SourceError("PATH_ESCAPE", ...)` unless `real` (already resolved
 * via `realpath`) stays within `rootReal` (also already realpath'd) —
 * the one containment check every symlink-aware read in this file shares. */
function assertContained(rootReal: string, real: string, label: string): void {
  const rel = relative(rootReal, real);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes) {
    throw new SourceError("PATH_ESCAPE", `${label} escapes source root: resolved to ${real}`);
  }
}

/**
 * Resolves `entry.path` against `configDir` (same base `loadConfig` already
 * used for its LEXICAL containment check — see `config/load.ts`
 * `assertPathContained`'s doc comment) and reads it as a wire tree via
 * `readDirectoryTree`.
 *
 * Security: `loadConfig`'s `PATH_ESCAPE` check is lexical-only (string
 * `resolve`/`relative`, no `realpath`) — it does not follow symlinks. A
 * config-relative `path` whose target is (or contains, at any depth) a
 * symlink escaping `configDir` therefore passes `loadConfig` despite the
 * eventual read landing outside it. THIS function is the first (and only)
 * point that ever actually opens those files, so it re-verifies containment
 * with `realpath` before reading anything — never assume `loadConfig`
 * having accepted the config already proves the read is safe (see that
 * check's own doc comment, which flags this exact obligation).
 *
 * Throws `SourceError("PATH_ESCAPE", …)` naming `entry.path` and the
 * escaping real path on failure.
 */
export async function readPathSource(
  entry: PathSourceEntry,
  configDir: string,
): Promise<ReadonlyMap<WirePath, Uint8Array>> {
  const root = await resolveContainedRealPath(configDir, entry.path);
  return readDirectoryTree(root);
}

/**
 * Resolves `relativeValue` against `root`, verifies with `realpath` that
 * the result stays within `root`'s own realpath, and returns that
 * verified absolute path. Shared by `readPathSource` (for `entry.path`
 * against `configDir`) and `git.ts` (for `entry.dir` against a freshly
 * cloned repo's directory) — the same escape class, the same fix, in
 * exactly one place.
 *
 * `root` itself is trusted as the safe base (its OWN provenance — a config
 * file's directory, or a directory this process just created via
 * `git clone`/`mkdtemp` — is the caller's responsibility); only
 * `relativeValue`'s resolution against it is checked here.
 *
 * Throws `SourceError("PATH_ESCAPE", …)` naming `relativeValue` and the
 * escaping real path on failure.
 */
export async function resolveContainedRealPath(root: string, relativeValue: string): Promise<string> {
  const rootReal = await realpath(root);
  const candidate = resolve(rootReal, relativeValue);
  // Lexical pre-check: a `relativeValue` like "../escape" that names a path
  // which doesn't exist yet would make `realpath(candidate)` below throw a
  // plain ENOENT rather than reporting the escape — catch the lexically
  // obvious case first, so this always fails as PATH_ESCAPE either way.
  assertContained(rootReal, candidate, relativeValue);
  const candidateReal = await realpath(candidate);
  // Symlink-aware check: `candidate` can look lexically contained (no `..`)
  // while a component along it is a symlink resolving outside `root`.
  assertContained(rootReal, candidateReal, relativeValue);
  return candidateReal;
}

/**
 * Walks `root` (an already-resolved, already-realpath-verified absolute
 * directory — callers are responsible for that, via
 * `resolveContainedRealPath`) into a `SourceFiles.files`-shaped map, keyed
 * by POSIX-relative `WirePath`.
 *
 * FILTERED, not a blind directory mirror: only `config.json` (root-level),
 * `c/index.json`, and everything under `p/` are included — every other
 * entry (`.git/`, `.gitmodules`, `node_modules/`, unrelated repo docs,
 * CI config, ...) is silently excluded. A `path`/`git` source root is very
 * often a full repository checkout, not a hand-curated export; mirroring
 * it indiscriminately would leak those internals into the public
 * `dist/index/<label>/` tree `mirror.ts` writes verbatim from this
 * function's output — see `types.ts` `SourceFiles`'s doc comment.
 *
 * Per-file, not just per-root, `realpath` verification: EVERY file this
 * function reads has its own realpath re-checked against `root`'s realpath
 * immediately before the read, not only once at `root` itself — a
 * recursive walk can encounter a symlinked file OR a symlinked
 * subdirectory at any depth, and only a per-file check catches both.
 * Mismatch throws `SourceError("PATH_ESCAPE", …)` naming the offending
 * file and its escaping real path; the whole read fails rather than
 * silently dropping or silently including the escaping file.
 */
/** Reads `wirePath` (a single, top-level, OPTIONAL file — `config.json` or
 * `c/index.json`) into `out` when present, `realpath`-verifying it stays
 * inside `rootReal` first. A missing file is not an error at this layer —
 * both `config.json` and `c/index.json` are optional per source (a `path`/
 * `git` source root need not carry every wire shape). */
async function tryIncludeFile(
  rootReal: string,
  root: string,
  wirePath: WirePath,
  out: Map<WirePath, Uint8Array>,
): Promise<void> {
  const abs = join(root, ...wirePath.split("/"));
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return; // not present — both files are optional per source
  }
  assertContained(rootReal, real, wirePath);
  const stats = await stat(real);
  if (!stats.isFile()) return;
  out.set(wirePath, await readFile(real));
}

/** Recursively walks `wirePrefix` (`"p"`, at the moment there is only one
 * caller) into `out`, every entry `realpath`-verified against `rootReal`
 * before being followed — a symlinked file OR a symlinked subdirectory at
 * any depth is caught the moment it's visited, per this module's own
 * per-file containment contract. */
async function walkTree(rootReal: string, root: string, wirePrefix: WirePath, out: Map<WirePath, Uint8Array>): Promise<void> {
  const abs = join(root, ...wirePrefix.split("/"));
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return; // "p/" itself is absent — nothing to walk
  }

  for (const dirent of entries) {
    const childWire: WirePath = `${wirePrefix}/${dirent.name}`;
    const childAbs = join(abs, dirent.name);
    const real = await realpath(childAbs);
    assertContained(rootReal, real, childWire);
    const stats = await stat(real);
    if (stats.isDirectory()) {
      await walkTree(rootReal, root, childWire, out);
    } else if (stats.isFile()) {
      out.set(childWire, await readFile(real));
    }
  }
}

export async function readDirectoryTree(root: string): Promise<ReadonlyMap<WirePath, Uint8Array>> {
  const rootReal = await realpath(root);
  const files = new Map<WirePath, Uint8Array>();

  await tryIncludeFile(rootReal, root, "config.json", files);
  await tryIncludeFile(rootReal, root, "c/index.json", files);
  await walkTree(rootReal, root, "p", files);

  return files;
}
