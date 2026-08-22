/**
 * Spec tests for `src/sources/walker.ts` (`readUrlSource`, C-003b). MUST
 * fail against the `throw new Error("not implemented")` stub.
 *
 * Two contract gaps the original black-box suite flagged as untested have
 * since been settled by orchestrator ruling (WP07) and are now covered
 * below, near the bottom of this file:
 *  1. `readUrlSource` DOES fetch `/config.json` unconditionally every run
 *     (`readUrlSource — /config.json` describe block) — every `fakeFetch`
 *     call in this file gets a default `/config.json` route for free (see
 *     `DEFAULT_CONFIG_ROUTE` below), so the earlier tests never needed
 *     touching for this beyond two exact-call-count assertions.
 *  2. CAS blob extension discovery for `desc.readme`/`desc.logo` is settled
 *     too, with NO new registry-side discovery mechanism: `readme` is
 *     always `.md` (schema-pinned); `logo` tries `.svg` then `.png`, in
 *     that order (mirroring `src/theme/utils/cas.ts`'s
 *     `LOGO_EXT_CANDIDATES`) — both absent degrades to "no asset" plus a
 *     warning, never a build failure. See the
 *     `readUrlSource — optional desc assets` describe block.
 */
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceError } from "../../src/sources/types.js";
import { readUrlSource, type SleepFn } from "../../src/sources/walker.js";
import { bytesEqual, rootJsonBytes, sha256Digest, utf8 } from "./helpers.js";

/** Retry tests inject this instead of `vi.useFakeTimers()` — fake timers plus
 * `readUrlSource`'s own real cache/fs I/O (`readVerifiedCache`, the `cas/`
 * `mkdir`) ahead of the first retryable fetch is inherently racy under load
 * (`vi.runAllTimersAsync()` can return before that I/O has resolved far
 * enough to even create the timer, orphaning the retry — verified empirically
 * as a real full-suite flake, not a hypothetical). `walker.ts`'s injectable
 * `SleepFn` seam removes the race by construction: this resolves immediately,
 * no timer/real-I/O interleaving involved at all. Tests that don't care about
 * the specific delay values use this directly; the one test that asserts
 * exponential growth + jitter bounds uses `recordingSleep` below instead. */
const IMMEDIATE_SLEEP: SleepFn = async () => {};

/** Same as `IMMEDIATE_SLEEP`, but records every requested delay — lets a test
 * assert the actual computed backoff sequence (attempt count, exponential
 * growth, jitter bounds) directly from what `retryFetch` calls `sleep`
 * with, which is strictly better evidence than advancing a fake timer ever
 * was. */
function recordingSleep(): { sleepImpl: SleepFn; delays: number[] } {
  const delays: number[] = [];
  const sleepImpl: SleepFn = async (ms) => {
    delays.push(ms);
  };
  return { sleepImpl, delays };
}

const cleanupDirs: string[] = [];

async function tempCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-walker-cache-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Reads a request header off a `fetchImpl` call's `init`, tolerant of a
 * plain object, an array of pairs, or a `Headers` instance — whichever
 * shape the implementation under test happens to pass. */
function getRequestHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  }
  const key = Object.keys(headers as Record<string, string>).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers as Record<string, string>)[key] : undefined;
}

const BASE_URL = "https://example.test/idx";

interface RouteResult {
  status: number;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}
type Route = (url: string, init: RequestInit | undefined) => RouteResult;

/** `Response`'s DOM-lib `BodyInit` type rejects a bare `Uint8Array` under
 * strict Node type-checking (it wants `Buffer` specifically, or a handful of
 * other shapes) — `Buffer.from` is the zero-copy-when-possible bridge. */
function toBodyInit(body: Uint8Array | string | undefined): BodyInit | null {
  if (body === undefined) return null;
  return typeof body === "string" ? body : Buffer.from(body);
}

/** Default `/config.json` route every `fakeFetch` call gets for free —
 * `readUrlSource` fetches this wire shape unconditionally on every run
 * (see the "readUrlSource — /config.json" describe block below), so every
 * OTHER test in this file that doesn't care about that fetch would
 * otherwise need to enumerate a matching route itself. A caller-supplied
 * `/config.json` route (checked first, since `routes` is searched before
 * this default) still overrides it. */
const DEFAULT_CONFIG_ROUTE: readonly [string, Route] = [
  "/config.json",
  () => ({ status: 200, body: utf8('{"format_version":1}') }),
];

/** Builds a `fetchImpl`, dispatching by URL suffix to `routes` (checked in
 * order, then the default `/config.json` route above); an unmatched URL
 * throws, so an accidental/forbidden fetch fails the test loudly instead of
 * silently returning something. Exposes the raw call log for assertions on
 * count/order/headers. */
function fakeFetch(routes: readonly [suffix: string, route: Route][]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const allRoutes = [...routes, DEFAULT_CONFIG_ROUTE];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const match = allRoutes.find(([suffix]) => url.endsWith(suffix));
    if (match === undefined) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const { status, body, headers } = match[1](url, init);
    return new Response(toBodyInit(body), { status, headers });
  }) as typeof fetch;
  return { impl, calls };
}

function indexJson(packages: Record<string, string>): Uint8Array {
  return utf8(JSON.stringify({ format_version: 1, packages }));
}

describe("readUrlSource — conditional GET / ETag caching", () => {
  it("sends no If-None-Match on the very first run (nothing cached yet)", async () => {
    const cacheDir = await tempCacheDir();
    const { impl, calls } = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: '"idx1"' } })],
    ]);

    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    const indexCall = calls.find((c) => c.url.endsWith("/c/index.json"));
    expect(getRequestHeader(indexCall?.init, "If-None-Match")).toBeUndefined();
  });

  it("sends the cached ETag verbatim (weak prefix preserved) as If-None-Match on the next run", async () => {
    const cacheDir = await tempCacheDir();
    const run1 = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: 'W/"abc123"' } })],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });

    let sentInm: string | undefined;
    const run2 = fakeFetch([
      [
        "/c/index.json",
        (_url, init) => {
          sentInm = getRequestHeader(init, "If-None-Match");
          return { status: 304 };
        },
      ],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(sentInm).toBe('W/"abc123"');
  });

  it("a 304 response serves the cached index without refetching any bodies", async () => {
    const cacheDir = await tempCacheDir();
    const root = rootJsonBytes({ name: "ocx.sh/ns/pkg" });
    const digest = sha256Digest(root);

    const run1 = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({ "ns/pkg": digest }), headers: { ETag: '"idx1"' } })],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);
    const result1 = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });
    expect(bytesEqual(result1.get("p/ns/pkg.json")!, root)).toBe(true);

    const run2 = fakeFetch([["/c/index.json", () => ({ status: 304 })]]);
    const result2 = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    // config.json (unconditional every run, see ruling below) + c/index.json.
    expect(run2.calls).toHaveLength(2);
    expect(bytesEqual(result2.get("p/ns/pkg.json")!, root)).toBe(true);
  });
});

describe("readUrlSource — digest-diff fetches only changed roots + missing CAS blobs", () => {
  it("re-fetches only the package whose digest changed, plus its new CAS blob; unchanged packages are served from cache", async () => {
    const cacheDir = await tempCacheDir();
    const rootA = rootJsonBytes({ name: "ocx.sh/ns/a" });
    const digestA = sha256Digest(rootA);

    const blob1 = utf8('{"schemaVersion":2,"manifests":[1]}');
    const casDigest1 = sha256Digest(blob1);
    const casHex1 = casDigest1.slice("sha256:".length);
    const rootB1 = rootJsonBytes({
      name: "ocx.sh/ns/b",
      tags: { "1.0.0": { content: casDigest1, observed: "2026-01-01T00:00:00Z" } },
    });
    const digestB1 = sha256Digest(rootB1);

    const run1 = fakeFetch([
      [
        "/c/index.json",
        () => ({
          status: 200,
          body: indexJson({ "ns/a": digestA, "ns/b": digestB1 }),
          headers: { ETag: '"idx1"' },
        }),
      ],
      ["/p/ns/a.json", () => ({ status: 200, body: rootA })],
      ["/p/ns/b.json", () => ({ status: 200, body: rootB1 })],
      [`/p/ns/b/o/sha256/${casHex1}.json`, () => ({ status: 200, body: blob1 })],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });
    // config.json + c/index.json + p/ns/a.json + p/ns/b.json + its CAS blob.
    expect(run1.calls).toHaveLength(5);

    const blob2 = utf8('{"schemaVersion":2,"manifests":[2]}');
    const casDigest2 = sha256Digest(blob2);
    const casHex2 = casDigest2.slice("sha256:".length);
    const rootB2 = rootJsonBytes({
      name: "ocx.sh/ns/b",
      tags: { "1.0.0": { content: casDigest2, observed: "2026-02-01T00:00:00Z" } },
    });
    const digestB2 = sha256Digest(rootB2);

    const run2 = fakeFetch([
      [
        "/c/index.json",
        () => ({
          status: 200,
          body: indexJson({ "ns/a": digestA, "ns/b": digestB2 }),
          headers: { ETag: '"idx2"' },
        }),
      ],
      ["/p/ns/b.json", () => ({ status: 200, body: rootB2 })],
      [`/p/ns/b/o/sha256/${casHex2}.json`, () => ({ status: 200, body: blob2 })],
      // Deliberately no route for /p/ns/a.json or the old CAS blob — any
      // fetch attempt for either throws (via fakeFetch's default), proving
      // they were served from cache instead.
    ]);
    const result2 = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(result2.get("p/ns/a.json")).toBeDefined();
    expect(bytesEqual(result2.get("p/ns/a.json")!, rootA)).toBe(true);
    expect(bytesEqual(result2.get("p/ns/b.json")!, rootB2)).toBe(true);
    expect(bytesEqual(result2.get(`p/ns/b/o/sha256/${casHex2}.json`)!, blob2)).toBe(true);
  });
});

describe("readUrlSource — digest verification", () => {
  it("a tampered root body raises DIGEST_MISMATCH naming the file and both digests", async () => {
    const cacheDir = await tempCacheDir();
    const realRoot = rootJsonBytes({ name: "ocx.sh/ns/a" });
    const expectedDigest = sha256Digest(realRoot);
    const tampered = utf8("this is not the real root content");
    const actualDigest = sha256Digest(tampered);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/a": expectedDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/a.json", () => ({ status: 200, body: tampered })],
    ]);

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("DIGEST_MISMATCH");
    expect(error?.message).toContain("p/ns/a.json");
    expect(error?.message).toContain(expectedDigest.slice("sha256:".length));
    expect(error?.message).toContain(actualDigest.slice("sha256:".length));
  });
});

describe("readUrlSource — cache resilience", () => {
  it("a corrupt cache is never a build failure — it is silently refetched", async () => {
    const cacheDir = await tempCacheDir();
    const root = rootJsonBytes({ name: "ocx.sh/ns/pkg" });
    const digest = sha256Digest(root);

    const run1 = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({ "ns/pkg": digest }), headers: { ETag: '"idx1"' } })],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });

    // Corrupt every regular file under cacheDir, layout-agnostic.
    const entries = await readdir(cacheDir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      const full = join(entry.parentPath, entry.name);
      if ((await stat(full)).isFile()) {
        await writeFile(full, "CORRUPTED-NOT-JSON-NOT-A-DIGEST");
      }
    }

    // A server that always answers fresh (ignores whatever, possibly
    // garbage, If-None-Match the corrupted cache produced).
    const run2 = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({ "ns/pkg": digest }), headers: { ETag: '"idx2"' } })],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);
    const result2 = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(bytesEqual(result2.get("p/ns/pkg.json")!, root)).toBe(true);
  });
});

describe("readUrlSource — retry and FETCH_FAILED", () => {
  it("retries a transient failure 3 times AFTER the initial attempt (4 total), with exponentially-growing jittered backoff delays, then raises a named FETCH_FAILED error", async () => {
    // Orchestrator ruling (WP07): the C-003 contract text ("3 retries with
    // exponential backoff") is read literally — 3 retries AFTER an initial
    // attempt, 4 attempts total. This corrects the black-box suite's
    // original pin at 3 total, which followed the assignment's own framing
    // ("3 attempts") instead; recorded here as the settled reading, not a
    // remaining ambiguity.
    const cacheDir = await tempCacheDir();
    const { sleepImpl, delays } = recordingSleep();
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      return new Response(null, { status: 503 });
    }) as typeof fetch;

    await expect(readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl, sleepImpl })).rejects.toMatchObject({
      name: "SourceError",
      code: "FETCH_FAILED",
    });
    expect(callCount).toBe(4);

    // 3 retries after the initial attempt => 3 backoff delays requested.
    expect(delays).toHaveLength(3);
    // RETRY_BASE_MS (500, per walker.ts's own doc comment) * 2**attempt *
    // jitter-in-[0.5, 1) — bounding each delay proves both the exponential
    // growth AND the jitter range directly from what `retryFetch` actually
    // computed, strictly stronger evidence than advancing a fake timer.
    delays.forEach((delay, attempt) => {
      const base = 500 * 2 ** attempt;
      expect(delay).toBeGreaterThanOrEqual(base * 0.5);
      expect(delay).toBeLessThan(base);
    });
  });

  it("FETCH_FAILED names entry.url and the last observed HTTP status", async () => {
    const cacheDir = await tempCacheDir();
    const fetchImpl = (async () => new Response(null, { status: 503 })) as typeof fetch;

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl, sleepImpl: IMMEDIATE_SLEEP });
    } catch (err) {
      error = err as SourceError;
    }
    expect(error?.message).toContain(BASE_URL);
    expect(error?.message).toContain("503");
  });

  it("a thrown network error (not just a bad status) also retries, then raises FETCH_FAILED naming the error", async () => {
    const cacheDir = await tempCacheDir();
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      throw new Error("getaddrinfo ENOTFOUND example.test");
    }) as typeof fetch;

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl, sleepImpl: IMMEDIATE_SLEEP });
    } catch (err) {
      error = err as SourceError;
    }
    expect(error?.code).toBe("FETCH_FAILED");
    expect(error?.message).toContain("ENOTFOUND");
    expect(callCount).toBe(4);
  });

  it("defaults to a real timer-based backoff when sleepImpl is omitted from options", async () => {
    // Every other retry test injects `sleepImpl` — this is the one test
    // that exercises the REAL default (`realSleep` in walker.ts), so it
    // genuinely waits out one real, jittered ~250-500ms delay. Deliberately
    // a single retry on /config.json specifically: that fetch is the very
    // first `await` in `readUrlSource`, before any of this module's own
    // cache/fs I/O — so there is nothing for a real timer to race against
    // here, unlike the fake-timer approach this file no longer uses.
    const cacheDir = await tempCacheDir();
    let configCalls = 0;
    const { impl } = fakeFetch([
      [
        "/config.json",
        () => {
          configCalls++;
          return configCalls === 1
            ? { status: 503 }
            : { status: 200, body: utf8('{"format_version":1}') };
        },
      ],
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: '"idx1"' } })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(configCalls).toBe(2);
    expect(files.has("config.json")).toBe(true);
  });
});

// Panel BLOCK findings: `retryFetch` previously special-cased a 404 as an
// immediate pass-through (never retried, never rejected) — the doc even
// said callers must check `response.status` themselves, but three call
// sites (config.json, c/index.json, a root/CAS fetch) never did, so a 404
// body was stored as `files.get("config.json")` verbatim, reached
// `JSON.parse` raw for c/index.json (a plain SyntaxError, not a SourceError
// S-002's exit-69 mapping can catch), or surfaced as DIGEST_MISMATCH instead
// of FETCH_FAILED for a root. Root-cause fix: `retryFetch` no longer
// special-cases 404 at all — every REQUIRED fetch treats it like any other
// unacceptable status, retried then raised as a named FETCH_FAILED.
describe("readUrlSource — a 404 on a required fetch is FETCH_FAILED, never silently accepted", () => {
  it("a 404 on /config.json raises FETCH_FAILED, never mirrors the 404 body", async () => {
    const cacheDir = await tempCacheDir();
    const { impl } = fakeFetch([["/config.json", () => ({ status: 404, body: utf8("Not Found") })]]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({ name: "SourceError", code: "FETCH_FAILED" });
  });

  it("a 404 on /c/index.json raises FETCH_FAILED, never a raw JSON.parse crash", async () => {
    const cacheDir = await tempCacheDir();
    const { impl } = fakeFetch([["/c/index.json", () => ({ status: 404, body: utf8("Not Found") })]]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({ name: "SourceError", code: "FETCH_FAILED" });
  });

  it("a 404 on a package root raises FETCH_FAILED, not DIGEST_MISMATCH", async () => {
    const cacheDir = await tempCacheDir();
    const rootDigest = `sha256:${"e".repeat(64)}`;
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 404 })],
    ]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({ name: "SourceError", code: "FETCH_FAILED" });
  });
});

/** Security panel WARN (2026-08-22, W5 / CWE-918): the default
 * `redirect: "follow"` let a hostile source 30x the builder onto a host only
 * the builder can reach (cloud metadata, an internal service) and land those
 * bytes verbatim in the published `dist/config.json` / `dist/c/index.json`,
 * neither of which is digest-verified. Every request now goes out with
 * `redirect: "manual"` and a 3xx is refused by name. */
describe("readUrlSource — redirects are refused, never followed (W5)", () => {
  const METADATA_URL = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";

  it("requests every wire file with redirect: manual", async () => {
    const cacheDir = await tempCacheDir();
    const { impl, calls } = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: '"idx1"' } })],
    ]);

    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.init?.redirect).toBe("manual");
    }
  });

  it("refuses a 302 on /config.json, naming the hop it would have followed — and never retries it", async () => {
    const cacheDir = await tempCacheDir();
    const { impl, calls } = fakeFetch([
      ["/config.json", () => ({ status: 302, headers: { Location: METADATA_URL } })],
    ]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({
      name: "SourceError",
      code: "FETCH_FAILED",
      message: expect.stringContaining(METADATA_URL) as unknown as string,
    });
    // A redirect is a policy refusal, not a transient failure: exactly one
    // attempt, no backoff loop.
    expect(calls).toHaveLength(1);
  });

  it("refuses a 301 with no Location header, saying so rather than printing null", async () => {
    const cacheDir = await tempCacheDir();
    const { impl } = fakeFetch([["/c/index.json", () => ({ status: 301 })]]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({
      name: "SourceError",
      code: "FETCH_FAILED",
      message: expect.stringContaining("(no Location header)") as unknown as string,
    });
  });

  // 304 is a 3xx that is NOT a redirect — it is this walker's own
  // conditional-GET success path. A naive `300 <= s < 400` refusal would
  // reject every cache hit; the "conditional GET / ETag caching" describe
  // block above is the primary coverage, this is the explicit statement of
  // the boundary.
  it("does not mistake 304 Not Modified for a redirect", async () => {
    const cacheDir = await tempCacheDir();
    const run1 = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: '"idx1"' } })],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });

    const run2 = fakeFetch([["/c/index.json", () => ({ status: 304 })]]);
    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(files.has("c/index.json")).toBe(true);
  });

  it("refuses a 302 on a package root — the redirected body never enters the build", async () => {
    const cacheDir = await tempCacheDir();
    const rootDigest = `sha256:${"e".repeat(64)}`;
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 302, headers: { Location: METADATA_URL } })],
    ]);

    await expect(
      readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, sleepImpl: IMMEDIATE_SLEEP }),
    ).rejects.toMatchObject({ name: "SourceError", code: "FETCH_FAILED" });
  });

  it("treats a 302 on an OPTIONAL desc asset as 'candidate absent', not a build failure", async () => {
    const cacheDir = await tempCacheDir();
    const logoDigest = `sha256:${"d".repeat(64)}`;
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);
    const warnings: string[] = [];
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 302, headers: { Location: METADATA_URL } })],
      [`/p/ns/pkg/o/sha256/${hex}.png`, () => ({ status: 302, headers: { Location: METADATA_URL } })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, {
      cacheDir,
      fetchImpl: impl,
      warn: (m) => warnings.push(m),
    });

    expect(files.has(`p/ns/pkg/o/sha256/${hex}.svg`)).toBe(false);
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.png`)).toBe(false);
    expect(warnings.join("\n")).toContain("logo not found");
  });
});

describe("readUrlSource — bounded concurrency", () => {
  it("never has more than 16 fetches in flight at once", async () => {
    const cacheDir = await tempCacheDir();
    const packageCount = 30;
    const packages: Record<string, string> = {};
    const roots = new Map<string, Uint8Array>();
    for (let i = 0; i < packageCount; i++) {
      const name = `pkg${String(i).padStart(2, "0")}`;
      const root = rootJsonBytes({ name: `ocx.sh/ns/${name}` });
      const digest = sha256Digest(root);
      packages[`ns/${name}`] = digest;
      roots.set(`/p/ns/${name}.json`, root);
    }

    let active = 0;
    let maxActive = 0;
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
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return new Response(toBodyInit(roots.get(suffix)!), { status: 200 });
    }) as typeof fetch;

    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl });

    expect(maxActive).toBeLessThanOrEqual(16);
    expect(maxActive).toBeGreaterThan(1);
  });
});

describe("readUrlSource — qualifiedId validation (BLOCK A, security panel 2026-08-22)", () => {
  it("rejects a /c/index.json key that attempts path traversal, by name, as PATH_ESCAPE", async () => {
    const cacheDir = await tempCacheDir();
    const traversalId = "../".repeat(20) + "tmp/canary";
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({
          status: 200,
          body: indexJson({ [traversalId]: `sha256:${"a".repeat(64)}` }),
          headers: { ETag: '"idx1"' },
        }),
      ],
    ]);

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("PATH_ESCAPE");
    expect(error?.message).toContain(traversalId);
  });

  it("reviewer PoC (traversalId = 20x '../' + 'tmp/canary'): the canary file is never created, even though a route exists that would otherwise serve it and pass digest verification", async () => {
    const cacheDir = await tempCacheDir();
    const traversalId = "../".repeat(20) + "tmp/canary";
    const canaryBytes = utf8("pwned");
    const canaryDigest = sha256Digest(canaryBytes);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({
          status: 200,
          body: indexJson({ [traversalId]: canaryDigest }),
          headers: { ETag: '"idx1"' },
        }),
      ],
      // A route the escaped wire path WOULD hit, and whose bytes WOULD pass
      // digest verification, if qualifiedId validation didn't reject it
      // first — proving rejection happens before any fetch of it, not just
      // that fetching happens to fail.
      [`/p/${traversalId}.json`, () => ({ status: 200, body: canaryBytes })],
    ]);

    await expect(readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl })).rejects.toMatchObject({
      name: "SourceError",
      code: "PATH_ESCAPE",
    });

    await expect(stat(join(tmpdir(), "canary"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a /c/index.json key with no namespace/package split (a single segment, no '/' at all) as PATH_ESCAPE", async () => {
    const cacheDir = await tempCacheDir();
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({
          status: 200,
          body: indexJson({ onlyonesegment: `sha256:${"a".repeat(64)}` }),
          headers: { ETag: '"idx1"' },
        }),
      ],
    ]);

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("PATH_ESCAPE");
    expect(error?.message).toContain("no namespace/package split");
  });

  it("rejects a root's own tag content digest that is malformed (not a fullmatch sha256:<hex>), before it is used to build a cache path", async () => {
    // The same arbitrary-write hole as the qualifiedId vector, via a
    // DIFFERENT field: a root's own `tags[*].content` reaches
    // `casCachePath` unvalidated too (`collectCasRefs`), and digest
    // verification of the fetched BYTES happens too late to catch a
    // malformed digest STRING.
    const cacheDir = await tempCacheDir();
    const maliciousDigest = "sha256:../../../../tmp/evil";
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      tags: { "1.0.0": { content: maliciousDigest, observed: "2026-01-01T00:00:00Z" } },
    });
    const rootDigest = sha256Digest(root);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("PATH_ESCAPE");
    expect(error?.message).toContain("malformed digest");
  });
});

describe("readUrlSource — response size cap (WARN D, security panel 2026-08-22)", () => {
  it("rejects a response whose declared Content-Length exceeds the cap, before reading any of the body", async () => {
    const cacheDir = await tempCacheDir();
    const digest = `sha256:${"b".repeat(64)}`;
    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": digest }), headers: { ETag: '"idx1"' } }),
      ],
      [
        "/p/ns/pkg.json",
        () => ({
          status: 200,
          body: utf8("irrelevant — rejected on the declared length before this is ever read"),
          headers: { "content-length": String(64 * 1024 * 1024) },
        }),
      ],
    ]);

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("FETCH_FAILED");
    expect(error?.message).toContain("exceeding");
  });

  it("rejects an oversized response body via the streaming cap even when Content-Length understates it (undici-decompression-shaped attack)", async () => {
    const cacheDir = await tempCacheDir();
    const digest = `sha256:${"c".repeat(64)}`;
    // Just over the 8 MiB cap — the actual STREAMED byte count, independent
    // of whatever Content-Length claims.
    const oversized = new Uint8Array(8 * 1024 * 1024 + 10);

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/config.json")) {
        return new Response(toBodyInit(utf8('{"format_version":1}')), { status: 200 });
      }
      if (url.endsWith("/c/index.json")) {
        return new Response(toBodyInit(indexJson({ "ns/pkg": digest })), {
          status: 200,
          headers: { ETag: '"idx1"' },
        });
      }
      if (url.endsWith("/p/ns/pkg.json")) {
        // Declares a tiny length (a gzip-bomb-shaped lie about decompressed
        // size) — only the streaming cap, not the up-front header check,
        // can catch this one.
        return new Response(toBodyInit(oversized), { status: 200, headers: { "content-length": "100" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    let error: SourceError | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl });
    } catch (err) {
      error = err as SourceError;
    }

    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("FETCH_FAILED");
    expect(error?.message).toContain("exceeds");
  });

  it("readBoundedBody: a response with a null body (e.g. a bodiless 200) reads as an empty byte array, not a crash", async () => {
    const cacheDir = await tempCacheDir();
    const emptyDigest = sha256Digest(new Uint8Array(0));
    const hex = emptyDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: emptyDigest },
    });
    const rootDigest = sha256Digest(root);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      // No `body` field at all -> `toBodyInit` returns `null` -> the
      // constructed `Response.body` is genuinely `null`, not an empty
      // stream.
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 200 })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(files.get(`p/ns/pkg/o/sha256/${hex}.svg`)).toEqual(new Uint8Array(0));
  });
});

describe("readUrlSource — /config.json", () => {
  it("fetches /config.json unconditionally and includes it in the result byte-verbatim", async () => {
    const cacheDir = await tempCacheDir();
    // Odd spacing on purpose — proves the bytes are returned verbatim, not
    // parsed and re-serialized (same discipline as `helpers.ts`'s `rootJsonText`).
    const configBody = utf8('{ "format_version" :  1 }');
    const { impl } = fakeFetch([
      ["/config.json", () => ({ status: 200, body: configBody })],
      ["/c/index.json", () => ({ status: 200, body: indexJson({}), headers: { ETag: '"idx1"' } })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(bytesEqual(files.get("config.json")!, configBody)).toBe(true);
  });

  it("a 200 c/index.json response with no ETag header sends no If-None-Match on the next run", async () => {
    const cacheDir = await tempCacheDir();
    const run1 = fakeFetch([["/c/index.json", () => ({ status: 200, body: indexJson({}) })]]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });

    let sentInm: string | undefined = "not-called";
    const run2 = fakeFetch([
      [
        "/c/index.json",
        (_url, init) => {
          sentInm = getRequestHeader(init, "If-None-Match");
          return { status: 200, body: indexJson({}) };
        },
      ],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(sentInm).toBeUndefined();
  });
});

describe("readUrlSource — optional desc assets (readme/logo, orchestrator ruling WP07)", () => {
  it("fetches desc.readme, always as .md", async () => {
    const cacheDir = await tempCacheDir();
    const readmeBytes = utf8("# Hello\n");
    const readmeDigest = sha256Digest(readmeBytes);
    const hex = readmeDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], readme: readmeDigest },
    });
    const rootDigest = sha256Digest(root);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.md`, () => ({ status: 200, body: readmeBytes })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(bytesEqual(files.get(`p/ns/pkg/o/sha256/${hex}.md`)!, readmeBytes)).toBe(true);
  });

  it("logo: tries .svg first and uses it on a hit, never trying .png", async () => {
    const cacheDir = await tempCacheDir();
    const svgBytes = utf8("<svg></svg>");
    const logoDigest = sha256Digest(svgBytes);
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);

    const { impl, calls } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 200, body: svgBytes })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(bytesEqual(files.get(`p/ns/pkg/o/sha256/${hex}.svg`)!, svgBytes)).toBe(true);
    expect(calls.some((c) => c.url.endsWith(".png"))).toBe(false);
  });

  it("logo: .svg 404s, falls back to .png", async () => {
    const cacheDir = await tempCacheDir();
    const pngBytes = utf8("PNGDATA");
    const logoDigest = sha256Digest(pngBytes);
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 404 })],
      [`/p/ns/pkg/o/sha256/${hex}.png`, () => ({ status: 200, body: pngBytes })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(files.has(`p/ns/pkg/o/sha256/${hex}.svg`)).toBe(false);
    expect(bytesEqual(files.get(`p/ns/pkg/o/sha256/${hex}.png`)!, pngBytes)).toBe(true);
  });

  it("logo: both .svg and .png 404 -> warns naming the package, source still builds", async () => {
    const cacheDir = await tempCacheDir();
    const logoDigest = `sha256:${"a".repeat(64)}`;
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);
    const warn = vi.fn();

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 404 })],
      [`/p/ns/pkg/o/sha256/${hex}.png`, () => ({ status: 404 })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl, warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("logo");
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.svg`)).toBe(false);
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.png`)).toBe(false);
    // Never a build failure — the rest of the source still comes through.
    expect(bytesEqual(files.get("p/ns/pkg.json")!, root)).toBe(true);
  });

  it("logo: a thrown network error for a candidate degrades the same as 404 (never a build failure)", async () => {
    const cacheDir = await tempCacheDir();
    const logoDigest = `sha256:${"c".repeat(64)}`;
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);
    const warn = vi.fn();

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/config.json")) {
        return new Response(toBodyInit(utf8('{"format_version":1}')), { status: 200 });
      }
      if (url.endsWith("/c/index.json")) {
        return new Response(toBodyInit(indexJson({ "ns/pkg": rootDigest })), {
          status: 200,
          headers: { ETag: '"idx1"' },
        });
      }
      if (url.endsWith("/p/ns/pkg.json")) {
        return new Response(toBodyInit(root), { status: 200 });
      }
      if (url.endsWith(`${hex}.svg`)) throw new Error("network blip");
      if (url.endsWith(`${hex}.png`)) return new Response(null, { status: 404 });
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl, warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.svg`)).toBe(false);
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.png`)).toBe(false);
  });

  it("logo: a second run reuses the cached asset without re-fetching it", async () => {
    const cacheDir = await tempCacheDir();
    const svgBytes = utf8("<svg>cached</svg>");
    const logoDigest = sha256Digest(svgBytes);
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);

    const run1 = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      [`/p/ns/pkg/o/sha256/${hex}.svg`, () => ({ status: 200, body: svgBytes })],
    ]);
    await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run1.impl });

    // No route for the .svg (or .png) path this time — any attempt to
    // re-fetch it throws via fakeFetch's unmatched-route default, so a
    // passing test proves the cached bytes were reused instead.
    const run2 = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx2"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);
    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: run2.impl });

    expect(bytesEqual(files.get(`p/ns/pkg/o/sha256/${hex}.svg`)!, svgBytes)).toBe(true);
  });
});

describe("readUrlSource — default fetchImpl and warn (options omitted)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("defaults fetchImpl to the global fetch and warn to a silent no-op when both are omitted", async () => {
    const cacheDir = await tempCacheDir();
    const logoDigest = `sha256:${"d".repeat(64)}`;
    const hex = logoDigest.slice("sha256:".length);
    const root = rootJsonBytes({
      name: "ocx.sh/ns/pkg",
      desc: { title: "T", description: "D", keywords: [], logo: logoDigest },
    });
    const rootDigest = sha256Digest(root);

    const { impl } = fakeFetch([
      [
        "/c/index.json",
        () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"idx1"' } }),
      ],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
      // No .svg/.png route — both 404, exercising the default (omitted)
      // `warn` no-op; if it weren't silent, this call would throw.
    ]);
    globalThis.fetch = impl;

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir });

    expect(bytesEqual(files.get("p/ns/pkg.json")!, root)).toBe(true);
    expect(files.has(`p/ns/pkg/o/sha256/${hex}.svg`)).toBe(false);
  });
});

describe("readUrlSource — malformed root shape is named, never a raw TypeError (C-404)", () => {
  // A hostile source controls both the root bytes AND the digest, so a
  // malformed root passes digest verification and reaches `collectCasRefs`.
  // Before this guard those fields surfaced as "Cannot convert undefined or
  // null to object" / "x.slice is not a function" — a TypeError naming no
  // file. Each case must instead name the wire path AND the offending field,
  // matching `types.ts` `validateRootShape`.
  async function errorFor(rootText: string): Promise<Error> {
    const cacheDir = await tempCacheDir();
    const rootBytes = utf8(rootText);
    const rootDigest = sha256Digest(rootBytes);
    const { impl } = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"e"' } })],
      ["/p/ns/pkg.json", () => ({ status: 200, body: rootBytes })],
    ]);
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      return err as Error;
    }
    throw new Error("expected readUrlSource to reject");
  }

  it("rejects a root whose top level is not a JSON object, naming the file", async () => {
    const error = await errorFor("42");
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain("expected a JSON object");
  });

  it("rejects a JSON null root, naming the file", async () => {
    const error = await errorFor("null");
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain("expected a JSON object");
  });

  it("rejects an absent tags field, naming file + field", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","desc":null}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain('"tags"');
  });

  it("rejects a null tags field, naming file + field", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","desc":null,"tags":null}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain('"tags"');
  });

  it("rejects a non-string tags[*].content, naming file + tag", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","desc":null,"tags":{"1.0.0":{"content":123}}}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain('tags["1.0.0"].content');
  });

  it("rejects a null tag entry (content missing entirely), naming file + tag", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","desc":null,"tags":{"1.0.0":null}}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain('tags["1.0.0"].content');
  });

  it("rejects an absent desc field, naming file + field", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","tags":{}}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain('"desc"');
  });

  it("rejects a non-string desc.readme, naming file + field", async () => {
    const error = await errorFor('{"name":"ocx.sh/ns/pkg","tags":{},"desc":{"readme":5}}');
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("p/ns/pkg.json");
    expect(error.message).toContain('"desc.readme"');
  });
});

describe("readUrlSource — /c/index.json entry-count cap (C-405)", () => {
  it("rejects an index that declares more packages than the cap, before fanning out any package fetch", async () => {
    const cacheDir = await tempCacheDir();
    // 50_001 entries: one past the 50_000 cap. Keys/values need not be valid
    // — the cap is checked before any per-package validation or fetch, so a
    // one-byte digest value keeps the fixture small.
    const packages: Record<string, string> = {};
    for (let i = 0; i <= 50_000; i++) {
      packages[`a/${i}`] = "x";
    }
    const { impl } = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson(packages), headers: { ETag: '"big"' } })],
    ]);

    let error: Error | undefined;
    try {
      await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });
    } catch (err) {
      error = err as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("50001");
    expect(error?.message).toContain("50000");
  });

  it("accepts an index at a normal size (the cap does not fire below the ceiling)", async () => {
    const cacheDir = await tempCacheDir();
    const root = rootJsonBytes({ name: "ocx.sh/ns/pkg" });
    const rootDigest = sha256Digest(root);
    const { impl } = fakeFetch([
      ["/c/index.json", () => ({ status: 200, body: indexJson({ "ns/pkg": rootDigest }), headers: { ETag: '"e"' } })],
      ["/p/ns/pkg.json", () => ({ status: 200, body: root })],
    ]);

    const files = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl: impl });

    expect(files.has("p/ns/pkg.json")).toBe(true);
  });
});
