/**
 * Git source reader (C-003c) — shallow-clones `entry.git`, then reads the
 * checkout (optionally scoped to `entry.dir`) exactly like a `path` source
 * (`path.ts`'s `readDirectoryTree`, via `resolveContainedRealPath` for the
 * `dir` subpath — "optional `dir` subpath; then read as `path`", per the
 * plan). Every git invocation uses `execFile`-style array args — never
 * shell string interpolation of a config-supplied `git`/`ref`/`dir` value
 * (`quality-security.md`: untrusted values never reach a `run:`/shell
 * position).
 */

import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitSourceEntry } from "../config/types.js";
import { readDirectoryTree, resolveContainedRealPath } from "./path.js";
import { SourceError, type SourceWarning, type WirePath } from "./types.js";

/** Thin, explicitly-Promise-wrapped `git` invocation — array args only,
 * never a shell string. Deliberately NOT `util.promisify(execFile)`: Node's
 * `execFile` relies on an internal `promisify.custom` symbol to bundle
 * `stdout`/`stderr` onto a rejection, which a `vi.mock("node:child_process")`
 * replacement (used by this file's `GIT_SHA_UNSUPPORTED` unit test) doesn't
 * carry — this wrapper attaches `stderr` itself so mocking `execFile` at the
 * module boundary is sufficient without also faking that internal symbol. */
function runGit(args: readonly string[], options: { readonly cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb("git", [...args], options, (error, stdout, stderr) => {
      if (error) {
        (error as NodeJS.ErrnoException & { stderr?: string }).stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** `fullmatch` of a commit SHA, per the doc comment below: 7-40 hex chars,
 * case-insensitive. Anything else (absent, or a branch/tag name) takes the
 * shallow-clone path instead. */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Matches git's own stderr for "this remote won't let me fetch an
 * arbitrary commit it never advertised" — the smart-protocol-only guard a
 * local filesystem transport never engages (see this file's test suite's
 * own environment-finding comment). Distinguishes GIT_SHA_UNSUPPORTED from
 * any other fetch failure. */
const SHA_UNSUPPORTED_RE = /(not our ref|does not allow request for unadvertised object)/i;

/** Security panel HIGH (2026-08-22): `entry.git`/`entry.ref`/`entry.dir` are
 * config-authored (or, via `entry.dir`, filesystem-derived) values passed as
 * BARE positionals to `git clone`, `git remote add origin`, `git fetch`, and
 * `git ls-remote` below. Array args (never a shell string) already defeat
 * SHELL injection, but git itself still parses a leading-`-` positional as an
 * OPTION — e.g. `--upload-pack=<cmd>` is git's own documented
 * argument-injection-to-RCE vector, nothing shell-related about it. Two
 * independent layers close it: every `runGit` call below inserts `--`
 * (end-of-options) immediately before the first such positional (verified
 * empirically that `clone`, `remote add`, `fetch`, and `ls-remote` all honor
 * it), and this guard rejects a leading-`-` value outright before it ever
 * reaches `runGit` — belt-and-braces, since a `--` typo in one call site
 * should never be the only thing standing between a hostile config value and
 * git's option parser. */
function assertNotOptionLike(value: string, fieldName: string): void {
  if (value.startsWith("-")) {
    throw new SourceError(
      "PATH_ESCAPE",
      `git ${fieldName} must not start with "-" (looks like a git option, not a value): ${value}`,
    );
  }
}

const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec";

function isLfsPointer(bytes: Uint8Array): boolean {
  // An LFS pointer file is short, all-ASCII text — decoding as UTF-8 and
  // checking the fixed spec prefix never risks misreading real binary
  // content (a real image/index file starting with those exact bytes would
  // be an astronomically unlikely coincidence, matching the check every
  // git-lfs-aware tool performs).
  return new TextDecoder("utf-8").decode(bytes.slice(0, LFS_POINTER_PREFIX.length)) === LFS_POINTER_PREFIX;
}

export interface GitSourceOptions {
  /** Required, not optional: `.gitmodules`'s presence must always reach the
   * caller by name, never silently — see `types.ts` `SourceWarning`'s doc. */
  readonly warn: SourceWarning;
  /** Directory this reader creates its own `mkdtemp` scratch clone under,
   * and removes when done (success or failure) — never the build engine's
   * own C-005 scratch root (`out_dir.ts`); this is a source-side clone, not
   * build output. Defaults to `os.tmpdir()`. */
  readonly tmpDir?: string;
}

/**
 * Clones `entry.git` at `entry.ref` (or the remote's default HEAD when
 * absent) into a fresh `mkdtemp` scratch directory, then reads it as a
 * `path` source.
 *
 * Ref resolution — two distinct git invocations, chosen by shape:
 * - `entry.ref` absent, or a branch/tag name (i.e. NOT `fullmatch`
 *   `/^[0-9a-f]{7,40}$/i`): `git clone --depth 1 [--branch <ref>] <git>
 *   <scratchDir>` — omitting `--branch` when `entry.ref` is absent lets git
 *   clone the remote's own default branch.
 * - `entry.ref` is a commit-SHA (`fullmatch` 7–40 hex, case-insensitive):
 *   `git init <scratchDir>` + `git remote add origin <git>` + `git fetch
 *   --depth 1 origin <ref>` + `git checkout FETCH_HEAD` — a shallow clone
 *   cannot target an arbitrary commit by branch name, only by direct
 *   fetch. A server that rejects fetching a SHA it never advertised (no
 *   `allow-tips-sha1-in-want`) throws `SourceError("GIT_SHA_UNSUPPORTED",
 *   …)` naming `entry.git` and `entry.ref`, detected from git's own
 *   non-zero exit + stderr for that specific failure (never conflated with
 *   a generic clone failure).
 *
 * `.gitmodules` at the checkout root (or `entry.dir`, once resolved) ⇒
 * `options.warn` is called naming its path — submodules are a non-goal
 * (never cloned), but the file's presence must never manifest as silent
 * empty data. The file itself is still excluded from the returned tree
 * (`readDirectoryTree`'s wire-shape filter already drops it; this check is
 * independent of, and in addition to, that filter).
 *
 * Every sourced blob is checked for the Git LFS pointer shape (content
 * starting `version https://git-lfs.github.com/spec`) — a `--depth 1`
 * clone never fetches LFS objects, so an LFS-tracked file resolves to its
 * pointer text, not the real bytes. Serving that as a package's logo/readme
 * in production would be a silent, confusing break; this function instead
 * throws `SourceError("LFS_POINTER", …)` naming the file.
 *
 * Auth is ambient environment ONLY (SSH agent, a configured credential
 * helper, a CI job token already present in the environment this process
 * runs in) — never read, prompted for, or otherwise handled by this
 * function; it invokes `git` exactly as a user's own shell would, and
 * whatever `git` itself resolves for auth is out of this function's scope.
 *
 * The scratch clone directory is always removed before returning (success
 * or failure) — this function never leaves a clone behind for `mirror.ts`
 * or the build engine to find later; its only output is the returned
 * in-memory `files` map.
 */
/** Exported (not just internal) so a permission-denied stat — a real failure
 * distinct from "absent", never silently swallowed as one — is directly
 * unit-testable without contriving it through a full clone. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

/** `git clone --branch <ref>` only accepts a real advertised branch/tag
 * name — passing the symbolic ref `"HEAD"` fails with "Remote branch HEAD
 * not found in upstream" (verified empirically), so it's treated the same
 * as `ref` being absent: clone the remote's own default branch. */
function needsBranchFlag(ref: string | undefined): ref is string {
  return ref !== undefined && ref !== "HEAD";
}

/**
 * Expands a possibly-SHORT SHA `ref` to the full 40-hex object id
 * `git fetch --depth 1 origin <sha>` actually needs — verified empirically
 * that a local-transport `fetch` accepts an arbitrary FULL object id
 * directly (even one that isn't any branch/tag tip) but rejects a
 * shortened prefix outright ("couldn't find remote ref"), so a 7-39-char
 * `ref` must be resolved against something the remote actually advertises
 * first. `git ls-remote <url>` lists every branch/tag tip's full id; when
 * `ref` is a prefix of one of those, that full id is used instead. No match
 * (a short prefix of a non-tip commit, or `ref` already full-length) passes
 * `ref` through unchanged — the same direct-fetch path already handles a
 * full, non-advertised commit id.
 */
async function resolveShaRef(gitUrl: string, ref: string): Promise<string> {
  const { stdout } = await runGit(["ls-remote", "--", gitUrl]);
  for (const line of stdout.split("\n")) {
    const oid = line.split("\t")[0];
    if (oid !== undefined && oid.toLowerCase().startsWith(ref.toLowerCase())) {
      return oid;
    }
  }
  return ref;
}

export async function readGitSource(
  entry: GitSourceEntry,
  options: GitSourceOptions,
): Promise<ReadonlyMap<WirePath, Uint8Array>> {
  assertNotOptionLike(entry.git, "git");
  if (entry.ref !== undefined) assertNotOptionLike(entry.ref, "ref");
  if (entry.dir !== undefined) assertNotOptionLike(entry.dir, "dir");

  const scratchDir = await mkdtemp(join(options.tmpDir ?? tmpdir(), "ocx-catalog-git-"));

  try {
    const ref = entry.ref;

    if (ref !== undefined && SHA_RE.test(ref)) {
      await runGit(["init", "-q"], { cwd: scratchDir });
      await runGit(["remote", "add", "origin", "--", entry.git], { cwd: scratchDir });
      const resolvedRef = await resolveShaRef(entry.git, ref);
      try {
        await runGit(["fetch", "--depth", "1", "origin", "--", resolvedRef], { cwd: scratchDir });
      } catch (err) {
        // `runGit`'s wrapper always tags a rejection with `.stderr` (Node's
        // execFile callback always supplies one, even empty) — no fallback
        // needed, and none would be reachable from this call site.
        const stderr = (err as { stderr: string }).stderr;
        if (SHA_UNSUPPORTED_RE.test(stderr)) {
          throw new SourceError(
            "GIT_SHA_UNSUPPORTED",
            `remote ${entry.git} does not support fetching commit SHA ${ref} directly`,
          );
        }
        throw err;
      }
      await runGit(["checkout", "-q", "FETCH_HEAD"], { cwd: scratchDir });
    } else {
      const args = ["clone", "--depth", "1", "-q"];
      if (needsBranchFlag(ref)) {
        args.push("--branch", ref);
      }
      args.push("--", entry.git, scratchDir);
      await runGit(args);
    }

    const root =
      entry.dir !== undefined ? await resolveContainedRealPath(scratchDir, entry.dir) : await realpath(scratchDir);

    if (await fileExists(join(root, ".gitmodules"))) {
      options.warn(`${join(root, ".gitmodules")} present — submodules are not supported and were never cloned`);
    }

    const files = await readDirectoryTree(root);
    for (const [path, bytes] of files) {
      if (isLfsPointer(bytes)) {
        throw new SourceError("LFS_POINTER", `${path} is a Git LFS pointer, not the real object content`);
      }
    }
    return files;
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
