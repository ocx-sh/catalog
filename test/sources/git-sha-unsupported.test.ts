/**
 * Unit-level coverage for `readGitSource`'s `GIT_SHA_UNSUPPORTED` mapping
 * (`src/sources/git.ts`), per the orchestrator's ruling: the assignment's
 * suggested black-box simulation (a real remote with
 * `uploadpack.allowReachableSHA1InWant` off) does NOT reproduce the
 * condition for a local filesystem-path remote — git's local transport
 * copies objects directly and never negotiates through upload-pack, so that
 * restriction never engages (verified empirically; see `git.test.ts`'s own
 * environment-finding comment). This file instead mocks `node:child_process`
 * at the module boundary and asserts the stderr-pattern -> named error
 * mapping directly, isolated in its own file so this mock never touches
 * `git.test.ts`'s real-git-spawning tests (vitest mocks are file-scoped).
 */
import { describe, expect, it, vi } from "vitest";
// Type-only: a `SourceError` obtained via the dynamic `await import()` below
// (needed so `vi.mock("node:child_process")` applies before `git.ts` loads
// it) type-checks as a value-only binding under standalone strict `tsc` —
// this static, erased-at-runtime import restores its usability as a type.
import type { SourceError as SourceErrorType } from "../../src/sources/types.js";

type ExecFileCallback = (error: (Error & { stderr?: string }) | null, stdout: string, stderr: string) => void;

/** Stderr text the mocked `git fetch` call fails with — swapped per test so
 * the same mock exercises both the `GIT_SHA_UNSUPPORTED` mapping AND a
 * generic (non-matching) fetch failure, which must propagate as a plain
 * `Error`, never conflated with the named mapping. */
let fetchStderr = "remote error: upload-pack: not our ref deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const execFileMock = vi.fn(
  (_file: string, args: readonly string[], _options: unknown, callback: ExecFileCallback) => {
    if (args[0] === "fetch") {
      callback(new Error("Command failed"), "", fetchStderr);
      return;
    }
    // init / remote add / ls-remote (no matching advertised ref — a fresh
    // mock has nothing to list) all succeed trivially.
    callback(null, "", "");
  },
);

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { readGitSource } = await import("../../src/sources/git.js");
const { SourceError } = await import("../../src/sources/types.js");

describe("readGitSource — GIT_SHA_UNSUPPORTED (mocked git, unit-level)", () => {
  it("maps git's 'not our ref' stderr to a named GIT_SHA_UNSUPPORTED error", async () => {
    fetchStderr = "remote error: upload-pack: not our ref deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const sha = "a".repeat(40);

    let error: SourceErrorType | undefined;
    try {
      await readGitSource({ git: "https://example.test/remote.git", ref: sha }, { warn: vi.fn() });
    } catch (err) {
      error = err as SourceErrorType;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("GIT_SHA_UNSUPPORTED");
    expect(error?.message).toContain("https://example.test/remote.git");
    expect(error?.message).toContain(sha);
  });

  it("a generic fetch failure (stderr not matching the SHA-unsupported pattern) propagates as a plain Error, not GIT_SHA_UNSUPPORTED", async () => {
    fetchStderr = "fatal: could not read from remote repository";
    const sha = "b".repeat(40);

    let error: unknown;
    try {
      await readGitSource({ git: "https://example.test/remote.git", ref: sha }, { warn: vi.fn() });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SourceError);
  });
});
