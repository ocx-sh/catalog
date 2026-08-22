/**
 * URL source reader (C-003b) — a sparse-index "walker" over a deployed
 * catalog/index instance (crates.io-model, per `product-context.md`):
 * conditional GET `/c/index.json`, digest-diff against the previous run's
 * cache, fetch only what changed plus any CAS blob still missing, verify
 * every fetched file against its own digest. No snapshot tarball fast
 * path — deliberately (ADR: "an optional fast path plus mandatory fallback
 * is two fetchers").
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UrlSourceEntry } from "../config/types.js";
import { assertSafePackagePath, DIGEST_RE } from "../viewmodel/catalog.js";
import { SourceError, type SourceWarning, type WirePath } from "./types.js";

/** `4` = an initial attempt plus 3 retries — the C-003 contract's "3
 * retries with exponential backoff", read literally (3 retries AFTER the
 * initial attempt, not 3 attempts total; the tester's black-box suite
 * originally pinned 3 total and has been corrected to match — see
 * `walker.test.ts`'s own note on the retry test). */
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;
const MAX_CONCURRENCY = 16;

/** Security panel WARN (2026-08-22): every response body was buffered with
 * a bare `arrayBuffer()`, unbounded — a hostile server (a gzip bomb, or
 * just a huge body) exhausts memory before digest verification ever gets a
 * chance to reject it. 8 MiB is generous for anything this wire contract
 * actually carries (a root JSON, an OCI image index, a README/logo) while
 * still bounding worst-case memory from one response — undici decompresses
 * transparently, so this caps the DECOMPRESSED byte count actually read,
 * not just a `Content-Length` header a compressed body could understate.
 * ponytail: a single flat ceiling, not per-content-kind tuning — raise it
 * here if a real asset ever legitimately needs more. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Mirrors `src/theme/utils/cas.ts`'s `LOGO_EXT_CANDIDATES` order (not a
 * live import — that file is browser/VitePress-theme source, excluded from
 * this package's Node build; same value, cited by name for provenance). */
const LOGO_EXT_CANDIDATES = ["svg", "png"] as const;
/** `desc.readme` is schema-pinned to Markdown — no trial-and-error needed. */
const README_EXT_CANDIDATES = ["md"] as const;

/**
 * Every file extension the wire contract places under `p/`: a package root
 * and a CAS OCI image index are both `.json`; a `desc.readme` is one of
 * `README_EXT_CANDIDATES`; a `desc.logo` is one of `LOGO_EXT_CANDIDATES`.
 *
 * `path.ts`'s directory walk (`path`/`git` sources) filters `p/` to exactly
 * this set — a `path`/`git` source root is very often a full repository
 * checkout, so an `.html`/`.js`/... file placed under `p/` would otherwise be
 * copied byte-verbatim into the same-origin `dist/index/<label>/p/` tree and
 * served next to the catalog. The `_headers` CSP `sandbox` is the primary
 * control, but it is Cloudflare-Pages-only and inert on GitHub Pages / S3 /
 * nginx / `dev`, so restricting the copied extensions is the defence that
 * holds everywhere (rev-sec, 2026-08-22). A `url` source needs no such filter:
 * it only ever fetches these exact wire paths by digest, never an arbitrary
 * directory entry.
 *
 * Derived from the SAME candidate lists the `url` walker fetches assets by, so
 * a new logo/readme type added there is honoured here too — never a second,
 * narrower hardcoded set that could silently drop a valid asset.
 */
export const WIRE_ASSET_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  "json",
  ...LOGO_EXT_CANDIDATES,
  ...README_EXT_CANDIDATES,
]);

/** Maximum package count a `/c/index.json` may declare before the whole
 * source is rejected. A hostile `url` source could otherwise declare an
 * unbounded number of entries and fan the builder out to that many root +
 * CAS fetches. The 8 MiB `MAX_RESPONSE_BYTES` body cap already bounds the
 * index to ~100k entries; this tighter cap turns a would-be out-of-memory
 * build into a fast, named rejection instead, while staying far above any
 * real index — `index.ocx.sh` publishes ~124 packages, and the renderer's
 * own practical build ceiling is a few thousand. ponytail: one flat ceiling;
 * raise it here if a genuine mirror ever grows past it. */
const MAX_INDEX_ENTRIES = 50_000;

function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Reads `response.body`, capping it at `MAX_RESPONSE_BYTES` — the
 * `Content-Length` header is checked up front (rejects loudly before
 * reading a single byte when the server admits to an oversized body), but
 * the actual stream is ALSO capped while buffering, since a compressed
 * body's declared length says nothing about its decompressed size. Every
 * caller of `response.arrayBuffer()` in this file goes through this
 * instead. */
async function readBoundedBody(response: Response, url: string): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new SourceError(
      "FETCH_FAILED",
      `${url}: response declares ${declaredLength} bytes, exceeding the ${MAX_RESPONSE_BYTES}-byte cap`,
    );
  }
  if (response.body === null) {
    return new Uint8Array(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SourceError("FETCH_FAILED", `${url}: response body exceeds the ${MAX_RESPONSE_BYTES}-byte cap`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Security panel WARN (2026-08-22, W5 / CWE-918): `fetch`'s DEFAULT
 * `redirect: "follow"` made a hostile configured `url` source builder-side
 * SSRF with an exfil channel — a 30x hop pointed the builder at a host only
 * IT can reach (cloud metadata, an internal service), and those bytes landed
 * verbatim in `dist/config.json` / `dist/c/index.json`, the two wire files
 * nothing digest-verifies, which the victim then PUBLISHES. Every request
 * this module makes therefore sets `redirect: "manual"` and refuses the
 * redirect outright rather than re-checking the post-hop origin: manual
 * means the second request is never issued at all (no blind-SSRF side
 * effect either), and a wire source is a static tree served from its own
 * configured base URL — it has no legitimate reason to bounce the builder
 * somewhere else. Node's undici surfaces the 30x response itself here
 * (status/`Location` intact, not an opaque filtered response), so the
 * refusal can name where it was being sent. */
const NO_REDIRECT: RequestInit = { redirect: "manual" };

/** The fetch spec's "redirect status" set exactly — NOT a `300 <= s < 400`
 * range check. `304 Not Modified` is a 3xx that is emphatically not a
 * redirect: it is this walker's own conditional-GET success path for
 * `c/index.json` (step 1 below), and a range check would refuse every
 * cache hit as an SSRF attempt. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

/** Injectable retry-backoff delay — real timer by default. Exists so retry
 * tests assert against the actual injected `sleep(ms)` call sequence (attempt
 * count, exponential growth, jitter bounds) instead of driving `setTimeout`
 * via `vi.useFakeTimers()`: fake timers plus this function's own real `await`s
 * on cache/fs I/O (`readVerifiedCache`, `mkdir`) raced under load — a fake
 * timer can't fire until the real I/O ahead of it actually resolves, and
 * `vi.runAllTimersAsync()` has no way to know that. Injecting the delay
 * function itself removes the race by construction: a test's `sleep` can
 * resolve immediately, no timer/I-O interleaving involved at all. */
export type SleepFn = (ms: number) => Promise<void>;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random() * 0.5);
}

/** A counting semaphore bounding the "combined root+CAS fetch queue"
 * (C-003b step 4) to `MAX_CONCURRENCY` in-flight network requests — plain
 * Promise-based, no dependency: the fetch queue is built dynamically (a
 * root's CAS references are only known once that root's bytes are parsed),
 * so a static `limit`-sized worker pool over a fixed array can't express
 * it; this is the smallest primitive that can. */
export class Semaphore {
  #available: number;
  readonly #queue: (() => void)[] = [];

  constructor(limit: number) {
    this.#available = limit;
  }

  acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve(() => this.#release());
    }
    return new Promise((resolve) => {
      this.#queue.push(() => {
        this.#available--;
        resolve(() => this.#release());
      });
    });
  }

  #release(): void {
    this.#available++;
    const next = this.#queue.shift();
    if (next !== undefined) next();
  }
}

/**
 * Retries `fetchImpl(url, init)` up to `MAX_ATTEMPTS` times (network error,
 * or a status `acceptStatus` rejects) with jittered exponential backoff.
 * EVERY call site of this function fetches a REQUIRED wire file (`config.json`,
 * `c/index.json`, a package root, or a tag's image-index CAS blob) — a `404`
 * is therefore treated exactly like any other unacceptable status, subject
 * to the same retry-then-fail path (never returned to the caller un-checked:
 * a prior version special-cased 404 as an immediate pass-through, which let
 * a 404 body reach `JSON.parse`/get mirrored verbatim/fail digest
 * verification instead of raising a named error — see `loadOptionalAsset`'s
 * `fetchOptionalAsset` for the actually-optional desc-asset case, which is a
 * different function precisely because it wants a different, 404-tolerant
 * contract). Exhausting every attempt throws `SourceError("FETCH_FAILED", …)`
 * naming `url` and the last observed status/network error.
 *
 * A 3xx is NOT retried: with `redirect: "manual"` (see `NO_REDIRECT`) a
 * redirect is a deterministic policy refusal, not a transient failure, so it
 * fails fast with its own message naming the refused hop — never four
 * pointless attempts ending in a generic "failed to fetch … : 302".
 */
async function retryFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  acceptStatus: (status: number) => boolean,
  sleep: SleepFn,
): Promise<Response> {
  let lastStatus = "network error";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, ...NO_REDIRECT });
    } catch (err) {
      lastStatus = (err as Error).message;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffDelayMs(attempt));
      continue;
    }
    if (isRedirect(response.status)) {
      throw new SourceError(
        "FETCH_FAILED",
        `refusing to follow a redirect for ${url}: ${response.status} -> ` +
          `${response.headers.get("Location") ?? "(no Location header)"} — a source URL must serve its own wire tree`,
      );
    }
    if (acceptStatus(response.status)) {
      return response;
    }
    lastStatus = String(response.status);
    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffDelayMs(attempt));
  }
  throw new SourceError("FETCH_FAILED", `failed to fetch ${url}: ${lastStatus}`);
}

/** Fetches an OPTIONAL CAS asset (a `desc.readme`/`desc.logo` candidate) —
 * a single attempt, never retried: a 404 means "try the next extension
 * candidate", and any other failure (a bad status, or a thrown network
 * error) degrades the same way — these are enrichments, not wire-contract-
 * required content, so nothing here is worth retry latency for. Returns
 * `null` on anything but a clean `200` — which is also how the `NO_REDIRECT`
 * policy lands here: a 30x is simply not a 200, so it degrades to "candidate
 * absent" with no extra branch (unlike `retryFetch`, this path has a
 * non-fatal fallback, so the refusal needs no named error). */
async function fetchOptionalAsset(fetchImpl: typeof fetch, url: string): Promise<Response | null> {
  try {
    const response = await fetchImpl(url, NO_REDIRECT);
    return response.status === 200 ? response : null;
  } catch {
    return null;
  }
}

function verifyDigest(wirePath: WirePath, bytes: Uint8Array, expectedDigest: string): void {
  const actual = sha256Digest(bytes);
  if (actual !== expectedDigest) {
    throw new SourceError("DIGEST_MISMATCH", `${wirePath}: expected digest ${expectedDigest}, got ${actual}`);
  }
}

/** Security panel BLOCK (2026-08-22): `digest` reaches here from remote,
 * unvalidated data too — a root's OWN `tags[*].content`/`desc.readme`/
 * `desc.logo` fields (`collectCasRefs`), not just `/c/index.json`'s package
 * digests. Every digest-driven cache path is built through this one
 * function, so validating it here (rather than at each caller) closes the
 * hole for all of them at once, `qualifiedId`'s own vector included: an
 * attacker-supplied `"content": "sha256:../../../../tmp/evil"` would
 * otherwise write outside `cacheDir/cas/` the moment the (also
 * attacker-controlled) fetch succeeds — digest verification of the FETCHED
 * BYTES happens too late to help, since it never checks the digest
 * STRING's own shape. */
function casCachePath(cacheDir: string, digest: string, ext: string): string {
  if (!DIGEST_RE.test(digest)) {
    throw new SourceError("PATH_ESCAPE", `malformed digest, refusing to use it in a cache path: ${digest}`);
  }
  return join(cacheDir, "cas", `${digest.slice("sha256:".length)}.${ext}`);
}

async function tryReadCacheFile(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/** A cache-read that never trusts disk content blindly: a missing file OR
 * one whose bytes no longer hash to `digest` (this run's own blanket cache-
 * corruption test writes garbage over every cached file, including
 * content-addressed CAS entries, not just the index) both fold into `null`
 * — a cache miss, triggering the normal fetch-and-reverify path below,
 * never a build failure. */
async function readVerifiedCache(cacheFile: string, digest: string): Promise<Uint8Array | null> {
  const bytes = await tryReadCacheFile(cacheFile);
  if (bytes === null) return null;
  return sha256Digest(bytes) === digest ? bytes : null;
}

interface WalkerContext {
  readonly fetchImpl: typeof fetch;
  readonly baseUrl: string;
  readonly cacheDir: string;
  readonly semaphore: Semaphore;
  readonly warn: SourceWarning;
  readonly sleep: SleepFn;
}

/** Loads a REQUIRED wire file (a package root, or a tag's `.json` image-index
 * content) at `wirePath`/`digest` — content-addressed cache hit first, else
 * a retried network fetch, digest-verified before being trusted or cached
 * (quality-indexbot-security.md). A cache hit here is what makes the
 * documented "digest-diff: unchanged entries served from cache" behavior
 * fall out for free — no separate previous-vs-current index comparison is
 * needed: an unchanged digest is, by construction, already on disk. */
async function loadOrFetch(ctx: WalkerContext, wirePath: WirePath, digest: string, ext: string): Promise<Uint8Array> {
  const cacheFile = casCachePath(ctx.cacheDir, digest, ext);

  // Security panel WARN (2026-08-22): the cache READ used to run before
  // acquiring the semaphore, so `Promise.all` over a hostile index with
  // thousands of cheap entries fanned out that many concurrent disk reads
  // at once, unbounded — everything this function does now happens inside
  // the SAME gate as the network leg.
  const release = await ctx.semaphore.acquire();
  try {
    const cached = await readVerifiedCache(cacheFile, digest);
    if (cached !== null) return cached;

    const response = await retryFetch(
      ctx.fetchImpl,
      `${ctx.baseUrl}/${wirePath}`,
      undefined,
      (status) => status === 200,
      ctx.sleep,
    );
    const bytes = await readBoundedBody(response, `${ctx.baseUrl}/${wirePath}`);
    verifyDigest(wirePath, bytes, digest);
    await writeFile(cacheFile, bytes);
    return bytes;
  } finally {
    release();
  }
}

/** Loads an OPTIONAL desc asset (`desc.readme`/`desc.logo`), trying each of
 * `extCandidates` in order (cache first, then a single non-retried fetch
 * per candidate) until one hits. Every candidate absent (404, or otherwise
 * unfetchable) ⇒ `ctx.warn` names the missing asset and this returns `null`
 * — NEVER a build failure, per this file's own doc comment on
 * `readUrlSource`'s CAS-blob step. */
async function loadOptionalAsset(
  ctx: WalkerContext,
  qualifiedId: string,
  digest: string,
  extCandidates: readonly string[],
  assetName: string,
): Promise<readonly [WirePath, Uint8Array] | null> {
  const hex = digest.slice("sha256:".length);

  for (const ext of extCandidates) {
    const wirePath: WirePath = `p/${qualifiedId}/o/sha256/${hex}.${ext}`;
    const cacheFile = casCachePath(ctx.cacheDir, digest, ext);

    // Same WARN-E fix as `loadOrFetch`: the cache read moves inside the
    // gate too, not just the fetch.
    const release = await ctx.semaphore.acquire();
    try {
      const cached = await readVerifiedCache(cacheFile, digest);
      if (cached !== null) return [wirePath, cached];

      const response = await fetchOptionalAsset(ctx.fetchImpl, `${ctx.baseUrl}/${wirePath}`);
      if (response !== null) {
        const bytes = await readBoundedBody(response, `${ctx.baseUrl}/${wirePath}`);
        verifyDigest(wirePath, bytes, digest);
        await writeFile(cacheFile, bytes);
        return [wirePath, bytes];
      }
    } finally {
      release();
    }
  }

  ctx.warn(`${assetName} not found for ${qualifiedId} (digest ${digest}) — tried ${extCandidates.join(", ")}`);
  return null;
}

/** Reads a `desc.<field>` CAS reference: absent (`undefined`) degrades to
 * `null`, but a present-but-non-string value is rejected BY NAME — the value
 * feeds a cache/wire path (`loadOptionalAsset`'s `digest.slice`), so a
 * non-string here would otherwise surface as a raw `TypeError` naming no file
 * (rev-sec, 2026-08-22). */
function descDigest(wirePath: WirePath, desc: Record<string, unknown> | null, field: "readme" | "logo"): string | null {
  if (desc === null) return null;
  const value = desc[field];
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`malformed root at ${wirePath}: "desc.${field}" must be a string when present`);
  }
  return value;
}

/**
 * Pulls exactly the CAS-referencing digests a root names — every tag's
 * `content`, plus `desc.readme`/`desc.logo` when set. Deliberately NOT
 * `extractPackages`'s full parse: the fetch layer only needs to know what
 * bytes to go get, not build a `CatalogPackageRoot`.
 *
 * Every field it dereferences into a path is guarded by name (rev-sec,
 * 2026-08-22): an absent `tags`, an absent/non-object `desc`, or a non-string
 * `tags[*].content`/`desc.readme`/`desc.logo` each raise an `Error` naming the
 * file AND the field — matching `types.ts` `validateRootShape`'s diagnostic
 * quality, never a raw `TypeError` ("Cannot convert undefined or null to
 * object") that names nothing. Thrown as a plain `Error` for the same reason
 * `validateRootShape` does: `SourceErrorCode` is scoped to transport/digest/
 * label failures, and `sources_pipeline.ts` already maps a plain malformed-
 * root error to exit 65 (`DATA`). This is a narrower parse than
 * `validateRootShape`, so it is deliberately lenient where leniency cannot
 * crash — an array `tags`/`desc` is left for `extractPackages` (which runs on
 * the same tree) to reject with its stricter, full-shape check. */
function collectCasRefs(
  wirePath: WirePath,
  rootBytes: Uint8Array,
): {
  tagDigests: readonly string[];
  readme: string | null;
  logo: string | null;
} {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(rootBytes));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`malformed root at ${wirePath}: expected a JSON object at the top level`);
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.tags !== "object" || obj.tags === null) {
    throw new Error(`malformed root at ${wirePath}: "tags" is required and must be an object`);
  }
  const tagDigests: string[] = [];
  for (const [tag, entry] of Object.entries(obj.tags as Record<string, unknown>)) {
    const content = (entry as { content?: unknown } | null)?.content;
    if (typeof content !== "string") {
      throw new Error(`malformed root at ${wirePath}: tags["${tag}"].content is required and must be a string`);
    }
    tagDigests.push(content);
  }

  const descRaw = obj.desc;
  if (descRaw !== null && typeof descRaw !== "object") {
    throw new Error(`malformed root at ${wirePath}: "desc" is required and must be null or an object`);
  }
  const desc = descRaw as Record<string, unknown> | null;
  return {
    tagDigests,
    readme: descDigest(wirePath, desc, "readme"),
    logo: descDigest(wirePath, desc, "logo"),
  };
}

/** Security panel BLOCK (2026-08-22, PoC confirmed): `qualifiedId` is a
 * REMOTE `/c/index.json` key — an attacker's own server, never validated
 * before `processPackage` builds `p/${qualifiedId}.json`/`p/${qualifiedId}/
 * o/sha256/...` wire paths from it, which `mirror.ts` later `join()`s
 * straight into `distDir` and writes. PoC: `qualifiedId =
 * "../".repeat(20) + "tmp/canary"` wrote a file to `/tmp`, fully outside
 * `distDir`. Digest verification does NOT catch this — the attacker
 * controls the digest and the bytes too, so it passes trivially; it proves
 * transport integrity, never path safety. Fullmatch-validated here, BEFORE
 * any wire path is built with it — same depth rule and segment pattern as
 * `extractPackages` (first `/` = namespace, remainder = package), reusing
 * `catalog.ts`'s own `assertSafePackagePath` so "safe" means one thing
 * everywhere a wire path is built from namespace/package parts. */
function assertSafeQualifiedId(qualifiedId: string): void {
  const slashIndex = qualifiedId.indexOf("/");
  if (slashIndex === -1) {
    throw new SourceError(
      "PATH_ESCAPE",
      `malformed /c/index.json package id (no namespace/package split): ${qualifiedId}`,
    );
  }
  try {
    assertSafePackagePath(qualifiedId.slice(0, slashIndex), qualifiedId.slice(slashIndex + 1));
  } catch (err) {
    throw new SourceError(
      "PATH_ESCAPE",
      `malformed /c/index.json package id "${qualifiedId}": ${(err as Error).message}`,
    );
  }
}

async function processPackage(
  qualifiedId: string,
  digest: string,
  ctx: WalkerContext,
  files: Map<WirePath, Uint8Array>,
): Promise<void> {
  assertSafeQualifiedId(qualifiedId);
  const rootWirePath: WirePath = `p/${qualifiedId}.json`;
  const rootBytes = await loadOrFetch(ctx, rootWirePath, digest, "json");
  files.set(rootWirePath, rootBytes);

  const { tagDigests, readme, logo } = collectCasRefs(rootWirePath, rootBytes);
  const tasks: Promise<void>[] = [];

  for (const tagDigest of tagDigests) {
    const wirePath: WirePath = `p/${qualifiedId}/o/sha256/${tagDigest.slice("sha256:".length)}.json`;
    tasks.push(loadOrFetch(ctx, wirePath, tagDigest, "json").then((bytes) => void files.set(wirePath, bytes)));
  }

  const assets: { digest: string; extCandidates: readonly string[]; assetName: string }[] = [];
  if (readme !== null) assets.push({ digest: readme, extCandidates: README_EXT_CANDIDATES, assetName: "readme" });
  if (logo !== null) assets.push({ digest: logo, extCandidates: LOGO_EXT_CANDIDATES, assetName: "logo" });

  for (const asset of assets) {
    tasks.push(
      loadOptionalAsset(ctx, qualifiedId, asset.digest, asset.extCandidates, asset.assetName).then((result) => {
        if (result !== null) files.set(result[0], result[1]);
      }),
    );
  }

  await Promise.all(tasks);
}

interface CachedIndex {
  readonly etag: string;
  readonly bytes: Uint8Array;
}

/** Reads back the previous run's cached `c/index.json` body + `ETag`,
 * collapsing EVERY failure mode (never cached, or either file corrupt/
 * unreadable) into `null` — "corrupt cache is never a build failure, only
 * silently refetched" (this file's own doc comment) falls out of treating
 * `null` exactly like "first run, nothing cached yet" everywhere it's used. */
async function readCachedIndex(cacheDir: string): Promise<CachedIndex | null> {
  try {
    const etag = await readFile(join(cacheDir, "index.etag"), "utf8");
    const bytes = await readFile(join(cacheDir, "index.json"));
    return { etag, bytes };
  } catch {
    return null;
  }
}

/**
 * Options for `readUrlSource`. `cacheDir` is an optimization-only,
 * content-addressed CAS cache — corrupt or absent entries are refetched,
 * NEVER a build failure (only `DIGEST_MISMATCH` on bytes this function
 * itself just fetched over the network is a hard error). `cacheDir` also
 * holds the previous run's cached `c/index.json` body + its `ETag`, which
 * is what makes a 304 response usable at all (a 304 has no body — this
 * function must already have the prior enumeration to know what to serve).
 */
export interface UrlSourceOptions {
  readonly cacheDir: string;
  /** Injected `fetch` implementation — defaults to the global `fetch`.
   * Exists so tests exercise retry/backoff/digest-mismatch/304 paths
   * without ever making a real network call. */
  readonly fetchImpl?: typeof fetch;
  /** Reports a `desc.readme`/`desc.logo` digest that no extension candidate
   * could fetch (see `types.ts` `SourceWarning`'s doc) — never a build
   * failure. Defaults to a no-op: unlike `git.ts`'s `.gitmodules` warning,
   * every committed fixture for this source kind omits `desc` entirely, so
   * this never fires in the existing suite without an explicit `desc`. */
  readonly warn?: SourceWarning;
  /** Injected retry-backoff delay function — defaults to a real
   * `setTimeout`-based sleep. Exists so tests assert the actual computed
   * backoff (attempt count, exponential growth, jitter bounds) via what this
   * function is CALLED WITH, instead of racing fake timers against this
   * module's own real cache/fs I/O — see `SleepFn`'s own doc comment. */
  readonly sleepImpl?: SleepFn;
}

/**
 * Reads `entry.url` as a remote wire tree.
 *
 * 1. Conditional GET `<entry.url>/c/index.json` with `If-None-Match` set to
 *    `cacheDir`'s cached `ETag`, sent VERBATIM — including a weak `W/"…"`
 *    prefix, unmodified (first run: no header sent). This function never
 *    compares ETags itself; RFC 7232 weak comparison is the SERVER's job,
 *    and Cloudflare's own weak/strong representation flips (compression
 *    negotiation) are exactly the case that comparison is for. A 304 serves
 *    the cached `c/index.json` body verbatim (unchanged ⇒ no further work).
 *    A 200 replaces the cached body + ETag.
 * 2. Every currently enumerated package's root is loaded content-addressed
 *    by its own digest (`{"<ns>/<pkg>": "sha256:<hex>", ...}`,
 *    `product-context.md`) — a cache hit IS "this digest was already fetched
 *    before", so "an unchanged entry is served from cache" falls out of that
 *    lookup directly; no separate diff against a previously cached index is
 *    kept.
 * 3. For each root loaded, inspect its `tags[*].content` (always `.json`,
 *    an OCI image index) and `desc.readme`/`desc.logo` digests and fetch any
 *    CAS blob (`p/<ns>/<pkg>/o/sha256/<hex>.<ext>`) not already present in
 *    `cacheDir`. No registry-side extension discovery: `readme` is always
 *    `.md` (schema-pinned); `logo` tries `.svg` then `.png`, in that order
 *    (mirroring `src/theme/utils/cas.ts`'s `LOGO_EXT_CANDIDATES`) — both
 *    absent degrades to "no asset" plus a warning, never a build failure.
 * 4. Concurrency 16 across the combined root+CAS fetch queue; each request
 *    retries up to 3 times AFTER its initial attempt (4 total) on failure,
 *    with exponential backoff (500ms base, jittered), before that ONE file
 *    is considered failed.
 * 5. EVERY freshly fetched byte sequence is digest-verified before being
 *    written to `cacheDir` or included in the result: a root's bytes
 *    against its own `/c/index.json` entry; a CAS blob's bytes against the
 *    hex in its own path. Mismatch throws
 *    `SourceError("DIGEST_MISMATCH", …)` naming the file plus both the
 *    expected and actual digest — a corrupted/tampered fetch must never
 *    silently enter the build.
 * 6. A source that stays unreachable after step 4's retries throws
 *    `SourceError("FETCH_FAILED", …)` naming `entry.url` and the last HTTP
 *    status (or network error) observed — S-002: the CLI maps this to
 *    exit 69; partial output is never deployed (satisfied structurally —
 *    a thrown error here means the build never reaches the point of
 *    writing `dist/`, not a mid-mirror abort `mirror.ts` itself guards).
 * 7. NO request is ever redirected (`redirect: "manual"`, see
 *    `NO_REDIRECT`): a 3xx on a REQUIRED file throws
 *    `SourceError("FETCH_FAILED", …)` immediately, naming the hop it
 *    refused; a 3xx on an OPTIONAL desc asset degrades to "candidate
 *    absent" like any other non-200.
 *
 * Returns the FULL current wire tree for this source (every currently
 * enumerated package's root + referenced CAS blobs), regardless of which
 * individual files were actually re-fetched this run vs served from cache
 * — callers (`labels.ts`, `mirror.ts`) never need to know the difference.
 */
export async function readUrlSource(
  entry: UrlSourceEntry,
  options: UrlSourceOptions,
): Promise<ReadonlyMap<WirePath, Uint8Array>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const warn = options.warn ?? (() => {});
  const sleep = options.sleepImpl ?? realSleep;

  const semaphore = new Semaphore(MAX_CONCURRENCY);
  const ctx: WalkerContext = { fetchImpl, baseUrl: entry.url, cacheDir: options.cacheDir, semaphore, warn, sleep };
  const files = new Map<WirePath, Uint8Array>();

  // Step 0 (ADR: the wire root's own `/config.json` — a frozen shape a
  // mirrored source is incomplete without, per `product-context.md`; not
  // conditionally cached, it's tiny and this keeps the cache layout simple).
  const configUrl = `${entry.url}/config.json`;
  const configResponse = await retryFetch(fetchImpl, configUrl, undefined, (status) => status === 200, sleep);
  files.set("config.json", await readBoundedBody(configResponse, configUrl));

  // Step 1: conditional GET on c/index.json.
  const cachedIndex = await readCachedIndex(options.cacheDir);
  const indexHeaders = cachedIndex !== null ? { headers: { "If-None-Match": cachedIndex.etag } } : undefined;
  const indexUrl = `${entry.url}/c/index.json`;
  const indexResponse = await retryFetch(
    fetchImpl,
    indexUrl,
    indexHeaders,
    (status) => status === 200 || status === 304,
    sleep,
  );

  let indexBytes: Uint8Array;
  if (indexResponse.status === 304) {
    // Only reachable after sending If-None-Match, i.e. only when
    // `cachedIndex` is already non-null.
    indexBytes = cachedIndex!.bytes;
  } else {
    indexBytes = await readBoundedBody(indexResponse, indexUrl);
    await writeFile(join(options.cacheDir, "index.json"), indexBytes);
    const etagHeader = indexResponse.headers.get("ETag");
    if (etagHeader !== null) {
      await writeFile(join(options.cacheDir, "index.etag"), etagHeader);
    }
  }
  files.set("c/index.json", indexBytes);

  // Steps 2-5: every currently enumerated package, root + its CAS refs —
  // content-addressed cache hits fold "unchanged" straight into "already
  // have it", so no separate diff against the previous index is needed.
  // `cas/` only needs to exist once cache WRITES start (here) — deliberately
  // not created any earlier, so a fake-timer-driven retry test covering the
  // config.json/c/index.json fetches above never races real directory-
  // creation I/O against the timer-draining loop.
  await mkdir(join(options.cacheDir, "cas"), { recursive: true });
  const { packages } = JSON.parse(new TextDecoder().decode(indexBytes)) as { packages: Record<string, string> };
  const entries = Object.entries(packages);
  if (entries.length > MAX_INDEX_ENTRIES) {
    throw new Error(
      `${indexUrl}: c/index.json declares ${entries.length} packages, exceeding the ${MAX_INDEX_ENTRIES}-package maximum`,
    );
  }
  await Promise.all(entries.map(([qualifiedId, digest]) => processPackage(qualifiedId, digest, ctx, files)));

  return files;
}
