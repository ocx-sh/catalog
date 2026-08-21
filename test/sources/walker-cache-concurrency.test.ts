/**
 * Regression coverage for WARN E (security panel, 2026-08-22): `loadOrFetch`
 * used to call `readVerifiedCache` (a `node:fs/promises` `readFile`) BEFORE
 * acquiring `ctx.semaphore` — so `Promise.all(Object.entries(packages).map(...))`
 * over a hostile index with thousands of cheap entries fanned out that many
 * concurrent disk reads at once, unbounded. The fix moves the cache read
 * inside the same semaphore acquire block as the network leg (see
 * `walker.ts`'s own comment on `loadOrFetch`/`loadOptionalAsset`).
 *
 * This needs to observe REAL `node:fs/promises` `readFile` concurrency,
 * which the rest of `walker.test.ts` exercises un-mocked — isolated in its
 * own file so this mock never touches those tests (vitest mocks are
 * file-scoped, same reasoning as `git-sha-unsupported.test.ts`).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let activeReads = 0;
let maxActiveReads = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      try {
        // Long enough that, WITHOUT the semaphore gating cache reads too, a
        // large package count would visibly stack far past MAX_CONCURRENCY
        // before any of these settle.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await actual.readFile(...(args as Parameters<typeof actual.readFile>));
      } finally {
        activeReads--;
      }
    },
  };
});

const { readUrlSource } = await import("../../src/sources/walker.js");
const { rootJsonBytes, sha256Digest, utf8 } = await import("./helpers.js");

const cleanupDirs: string[] = [];

async function tempCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-walker-cache-conc-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  activeReads = 0;
  maxActiveReads = 0;
});

function toBodyInit(body: Uint8Array | string): BodyInit {
  return typeof body === "string" ? body : Buffer.from(body);
}

function indexJson(packages: Record<string, string>): Uint8Array {
  return utf8(JSON.stringify({ format_version: 1, packages }));
}

const BASE_URL = "https://example.test/idx";

describe("readUrlSource — cache reads stay bounded by the same gate as the network leg (WARN E)", () => {
  it("never has more than MAX_CONCURRENCY (16) node:fs/promises readFile calls in flight, across a large all-cache-miss package set", async () => {
    const cacheDir = await tempCacheDir();
    const packageCount = 60;
    const packages: Record<string, string> = {};
    const roots = new Map<string, Uint8Array>();

    for (let i = 0; i < packageCount; i++) {
      const name = `pkg${String(i).padStart(3, "0")}`;
      const root = rootJsonBytes({ name: `ocx.sh/ns/${name}` });
      const digest = sha256Digest(root);
      packages[`ns/${name}`] = digest;
      roots.set(`/p/ns/${name}.json`, root);
    }

    // Every package is a cache MISS (fresh cacheDir, nothing pre-seeded) —
    // every one of them exercises `readVerifiedCache`'s `readFile` call, the
    // exact call this test's mock is watching.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/config.json")) {
        return new Response(toBodyInit(utf8('{"format_version":1}')), { status: 200 });
      }
      if (url.endsWith("/c/index.json")) {
        return new Response(toBodyInit(indexJson(packages)), { status: 200, headers: { ETag: '"idx1"' } });
      }
      const suffix = [...roots.keys()].find((path) => url.endsWith(path));
      if (suffix === undefined) throw new Error(`unexpected fetch: ${url}`);
      return new Response(toBodyInit(roots.get(suffix)!), { status: 200 });
    }) as typeof fetch;

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl });

    expect(maxActiveReads).toBeLessThanOrEqual(16);
    expect(maxActiveReads).toBeGreaterThan(1);
    expect(files.size).toBe(packageCount + 2); // + config.json + c/index.json
  });
});
