/**
 * Concurrency-bound coverage for C-406 (rev-perf, 2026-08-22): `mirrorSources`
 * used to `await` every `writeDistFile` serially, one file at a time — a large
 * index is thousands of small writes whose latency was fully serialized. It
 * now dispatches those writes through one bounded `Semaphore` (cap 16), the
 * same primitive the fetch layer uses.
 *
 * This observes REAL `node:fs/promises` `writeFile` concurrency, so — like
 * `walker-cache-concurrency.test.ts` — it lives in its own file: vitest mocks
 * are file-scoped, and the byte-verbatim assertions in `mirror.test.ts` need
 * the un-mocked `writeFile`.
 *
 * RED without the fix: serial awaits → `maxActiveWrites` never exceeds 1, so
 * `toBeGreaterThan(1)` fails. RED with an UNBOUNDED `Promise.all` (no
 * semaphore): all ~40 writes fire at once → `toBeLessThanOrEqual(16)` fails.
 * Only the bounded version satisfies both.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let activeWrites = 0;
let maxActiveWrites = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      try {
        // Long enough that an unbounded fan-out would visibly stack far past
        // the cap before any single write settles.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await actual.writeFile(...(args as Parameters<typeof actual.writeFile>));
      } finally {
        activeWrites--;
      }
    },
  };
});

const { mirrorSources } = await import("../../src/sources/mirror.js");
const { rootJsonBytes, utf8 } = await import("./helpers.js");
type ResolvedSourceFiles = import("../../src/sources/types.js").ResolvedSourceFiles;
type WirePath = import("../../src/sources/types.js").WirePath;

const cleanupDirs: string[] = [];

async function tempDistDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-mirror-conc-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  activeWrites = 0;
  maxActiveWrites = 0;
});

describe("mirrorSources — writes are bounded by a Semaphore (C-406)", () => {
  it("keeps at most 16 writeFile calls in flight across a large source, but more than one", async () => {
    const distDir = await tempDistDir();
    const entries: [WirePath, Uint8Array][] = [["config.json", utf8("{}")]];
    for (let i = 0; i < 40; i++) {
      const name = `pkg${String(i).padStart(2, "0")}`;
      entries.push([`p/ns/${name}.json`, rootJsonBytes({ name: `ocx.sh/ns/${name}` })]);
    }
    const source: ResolvedSourceFiles = { label: "alpha", root: false, files: new Map(entries) };

    await mirrorSources([source], distDir);

    expect(maxActiveWrites).toBeLessThanOrEqual(16);
    expect(maxActiveWrites).toBeGreaterThan(1);
  });
});
