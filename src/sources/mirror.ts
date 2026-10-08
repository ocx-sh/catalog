/**
 * Serve/mirror copy (C-006) + per-source `catalog.json` placement (C-004's
 * multi-source model) + `_headers` CSP emission. Consumes the fully
 * resolved `ResolvedSourceFiles[]` `labels.ts` produces — this module never
 * reads config or fetches anything itself.
 */

import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { catalogIndex, serializeCatalog } from "../viewmodel/catalog.js";
import { joinBase } from "../viewmodel/url.js";
import { extractPackages, packageRootAliasPath, SourceError, type ResolvedSourceFiles, type SourceWarning, type WirePath } from "./types.js";
import { Semaphore } from "./walker.js";

/** In-flight write cap for the mirror copy, matching `walker.ts`'s fetch cap
 * (16). The per-source trees are written concurrently through one bounded
 * `Semaphore` rather than serially awaited file-by-file — a large index is
 * thousands of small writes whose latency is otherwise fully serialized
 * (rev-perf, 2026-08-22, ~2.6x). */
const MAX_WRITE_CONCURRENCY = 16;

/** Size ceiling for a mirrored CAS CONTENT asset (a `desc.readme`/`desc.logo`
 * blob — a `.md`/`.svg`/`.png` under `p/.../o/sha256/`). One that exceeds it
 * is skipped and warned rather than served: a hostile or careless source can
 * otherwise inflate `dist/` and bandwidth with a multi-megabyte blob behind a
 * 34px logo tile (rev-perf, 2026-08-22). Package roots and OCI image indices
 * (`.json`) are NOT capped here — they are structural, and skipping one would
 * dangle a package rather than degrade gracefully the way a missing logo/
 * readme does. `url` sources already bound each fetched blob at 8 MiB
 * (`walker.ts` `MAX_RESPONSE_BYTES`); this is the equivalent guard for
 * `path`/`git` sources, which read straight off disk with no fetch cap.
 * ponytail: one flat ceiling for both readme and logo; split it only if a
 * real readme ever legitimately needs more than a logo. */
export const MAX_CAS_ASSET_BYTES = 1024 * 1024;

/** True for a CAS content blob (`p/.../o/sha256/<hex>.<ext>`, `ext` not
 * `json`) — the paths `MAX_CAS_ASSET_BYTES` applies to. */
function isCasContentAsset(wirePath: WirePath): boolean {
  return wirePath.includes("/o/sha256/") && !wirePath.endsWith(".json");
}

/** Default sink for a mirror-time warning (an oversized CAS asset skipped) —
 * stderr, prefixed like `build/sources_pipeline.ts`'s `warnToStderr`, so the
 * skip is surfaced even when the caller passes no `warn` (its default). */
function warnToStderr(message: string): void {
  process.stderr.write(`ocx-catalog: ${message}\n`);
}

/** The one path the mirror may overwrite: the root source's own
 * `catalog.json`, which `sources_pipeline.ts`'s `emitCatalogTree` replaces with
 * the merged multi-source catalog straight afterwards (a consumer's own file
 * here must never shadow the real catalog). Every other path is write-once. */
const ROOT_CATALOG_PATH = "data/catalog/catalog.json";

/** C-027: the mirror never overwrites. `distDir` may already hold the
 * consumer's `publicDir`, the brand logo and generated files, and a mirrored
 * path landing on one of them would silently replace it (a consumer `_headers`
 * lost to ours, a `p/` tree merged into theirs). */
async function assertAbsent(full: string, relPath: string): Promise<void> {
  try {
    await lstat(full);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  throw new SourceError(
    "OUTPUT_COLLISION",
    `refusing to overwrite "${relPath}": the output already contains it (remove it from publicDir, or rename the file)`,
  );
}

/** Writes `bytes` at `<distDir>/<relPath>`, creating parent directories, and
 * records `relPath` into `written` — the one write primitive every path this
 * module produces (mirrored source files, both catalog.json placements)
 * goes through, so `MirrorResult.written` can never drift from what was
 * actually written to disk.
 *
 * Security panel BLOCK A, belt-and-braces (2026-08-22): `relPath` is built
 * upstream from a REMOTE `/c/index.json` key (`qualifiedId`) —
 * `walker.ts`'s `assertSafeQualifiedId` is the primary fix, validated
 * BEFORE a wire path is even built, but this function is the one place
 * every write this module performs actually lands on disk, so it re-checks
 * the RESOLVED destination stays inside `distDir` too. Cheap, and it catches
 * any future caller of `writeDistFile` that skips upstream validation, not
 * just this one known vector. */
async function writeDistFile(distDir: string, relPath: string, bytes: Uint8Array | string, written: string[]): Promise<void> {
  const full = join(distDir, relPath);
  const rel = relative(resolve(distDir), resolve(full));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`refusing to write outside dist dir: "${relPath}" resolves outside "${distDir}"`);
  }
  if (relPath !== ROOT_CATALOG_PATH) {
    await assertAbsent(full, relPath);
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
  written.push(relPath);
}

/** Every dist-relative path this run wrote — for tests/CI to diff against
 * an expected file list without re-walking `dist/` themselves. */
export interface MirrorResult {
  readonly written: readonly string[];
}

/**
 * For each `source` in `sources`:
 *
 * 1. Copies `source.files` byte-verbatim to `<distDir>/index/<source.label>/`
 *    — unconditional, for EVERY source including a `root: true` one (the
 *    theme's detail-data fetch for that source's entries always uses this
 *    prefix; `root: true` is an ADDITIONAL copy, never a substitute — see
 *    below). "Byte-verbatim": each `Uint8Array` is written as-is; this
 *    function never parses or re-serializes any JSON it copies (C-006).
 * 2. `source.root === true` (at most one, per `ResolvedSourceFiles`'s doc
 *    comment) ⇒ the SAME `source.files` are
 *    ALSO written verbatim at `<distDir>` itself (legacy-compat: today's
 *    `index.ocx.sh` deploy shape, root-relative wire paths).
 * 3. Builds this source's `catalog.json`: `extractPackages(source.files)`,
 *    sorted by qualified package id (`${namespace}/${package}`,
 *    lexicographic) — `viewmodel/catalog.ts` `catalogIndex`'s doc comment
 *    is explicit that the upstream caller sorts before calling it; THIS is
 *    that caller now — then `catalogIndex(sorted)` +
 *    `serializeCatalog(...)` (`viewmodel/catalog.ts`), written to:
 *    - `source.root === true` ⇒ `<distDir>/data/catalog/catalog.json`
 *    - otherwise ⇒ `<distDir>/index/<source.label>/data/catalog/catalog.json`
 *    Never written into `source.files` itself — `catalog.json` is a
 *    derived artifact, not part of any source's own wire tree (`types.ts`
 *    `SourceFiles`'s doc comment).
 *
 * C-027: nothing is written twice and nothing already in `distDir` is
 * overwritten (`assertAbsent`), except the root `catalog.json` the merged
 * catalog replaces. `base` is the site's URL prefix; it only shapes `_headers`
 * patterns — files land at the same `distDir`-relative paths for every base.
 *
 * Finally writes `<distDir>/_headers` via `renderHeaders(sources, base)` — once,
 * covering every source's mirror prefix (and the root prefix, if any) in
 * one file, since Cloudflare Pages reads exactly one `_headers` at the
 * deploy root regardless of how many sources are mirrored under it.
 *
 * Trusts, rather than re-checks, two invariants already established
 * upstream: at most one `source.root === true` (`loadConfig`'s
 * `MULTIPLE_ROOT`) and every `source.label` is already unique and
 * path-segment-safe (`labels.ts`'s `checkLabelConflicts` +
 * `assertLabelPathSafe`) — a caller that skips those steps before calling
 * this function gets undefined (not safety-checked here a second time)
 * behavior.
 */
/** Qualified package id (`${namespace}/${package}`) — the sort key `catalog.ts`
 * `catalogIndex`'s own doc comment says its caller must apply first. */
function qualifiedId(pkg: { packageId: { namespace: string; package: string } }): string {
  return `${pkg.packageId.namespace}/${pkg.packageId.package}`;
}

/** A real three-way string comparator — not a lazy two-outcome shortcut.
 * Exported so the tie (`0`) case has direct unit coverage: `mirrorSources`'s
 * own call path can never actually produce two packages with the same
 * qualified id (each entry comes from one `Map` key in `source.files`,
 * which `extractPackages` turns into at most one packageId per key), so a
 * real tie is unreachable through that path — this is still tested as its
 * own correct comparator, not left with a branch nothing can reach. */
export function compareQualifiedIds(
  a: { packageId: { namespace: string; package: string } },
  b: { packageId: { namespace: string; package: string } },
): number {
  const idA = qualifiedId(a);
  const idB = qualifiedId(b);
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
}

export async function mirrorSources(
  sources: readonly ResolvedSourceFiles[],
  distDir: string,
  base: string,
  warn: SourceWarning = warnToStderr,
): Promise<MirrorResult> {
  const written: string[] = [];
  const semaphore = new Semaphore(MAX_WRITE_CONCURRENCY);
  const writes: Promise<void>[] = [];

  const claimed = new Set<string>();
  const enqueue = (relPath: string, bytes: Uint8Array | string): void => {
    // C-027: no path is written twice in one run. A rejected promise rather
    // than a throw, so writes already in flight are awaited, not orphaned.
    if (claimed.has(relPath)) {
      writes.push(Promise.reject(new SourceError("OUTPUT_COLLISION", `refusing to write "${relPath}" twice: two sources claim it`)));
      return;
    }
    claimed.add(relPath);
    writes.push(
      (async () => {
        const release = await semaphore.acquire();
        try {
          await writeDistFile(distDir, relPath, bytes, written);
        } finally {
          release();
        }
      })(),
    );
  };

  for (const source of sources) {
    for (const [wirePath, bytes] of source.files) {
      if (isCasContentAsset(wirePath) && bytes.byteLength > MAX_CAS_ASSET_BYTES) {
        warn(
          `skipping oversized CAS asset ${wirePath} in "${source.label}": ` +
            `${bytes.byteLength} bytes exceeds the ${MAX_CAS_ASSET_BYTES}-byte cap`,
        );
        continue;
      }
      enqueue(`index/${source.label}/${wirePath}`, bytes);
      if (source.root) {
        enqueue(wirePath, bytes);
      }
      // Ad-blocker-safe alias of every package root, written beside the
      // canonical copy at both placements (see `types.ts`'s
      // `packageRootAliasPath` for why it exists). The theme fetches this
      // one; the canonical `p/<ns>/<pkg>.json` stays exactly where the wire
      // format puts it, byte-identical, for every other consumer.
      const aliasPath = packageRootAliasPath(wirePath);
      if (aliasPath) {
        enqueue(`index/${source.label}/${aliasPath}`, bytes);
        if (source.root) {
          enqueue(aliasPath, bytes);
        }
      }
    }

    // Same placement this loop just wrote the source's own files to, so the
    // per-source catalog's `logoUrl`/`readmeUrl` point at that copy rather
    // than at the site root — see `viewmodel/catalog.ts`'s `wirePrefix`.
    const wireBase = source.root ? "" : `index/${source.label}`;
    const sorted = [...extractPackages(source.files)]
      .map((pkg) => ({ ...pkg, wireBase }))
      .sort(compareQualifiedIds);
    const catalog = serializeCatalog(catalogIndex(sorted));
    const catalogRelPath = source.root
      ? "data/catalog/catalog.json"
      : `index/${source.label}/data/catalog/catalog.json`;
    enqueue(catalogRelPath, catalog);
  }

  enqueue("_headers", renderHeaders(sources, base));

  // Settle every write before reporting the first failure, so a refused path
  // never leaves other writes landing in `distDir` after the caller has seen
  // the error.
  const failed = (await Promise.allSettled(writes)).find((outcome) => outcome.status === "rejected");
  if (failed) {
    throw failed.reason;
  }

  return { written };
}

/**
 * Renders the Cloudflare Pages `_headers` file content (path-pattern
 * blocks, blank-line separated — same format Netlify's `_headers`
 * popularized and Cloudflare Pages adopted directly): one rule per mirror
 * prefix, applying `Content-Security-Policy: sandbox` (the bare-token,
 * maximally restrictive form: no scripts, no forms, no popups, no
 * top-level navigation, opaque origin) plus `X-Content-Type-Options:
 * nosniff` (defense-in-depth against a browser MIME-sniffing a
 * mislabeled CAS blob into something executable).
 *
 * Exact shape:
 * ```
 * /p/*
 *   Content-Security-Policy: sandbox
 *   X-Content-Type-Options: nosniff
 *
 * /index/<label>/p/*
 *   Content-Security-Policy: sandbox
 *   X-Content-Type-Options: nosniff
 * ```
 * — every pattern prefixed by the site's `base` (`/catalog/p/*` under
 * `/catalog/`) — one `/index/<label>/p/*` block per DISTINCT `source.label` in
 * `sources` (every source, root or not — every source's mirror copy is
 * untrusted verbatim wire content), and the leading `/p/*` block ONLY when
 * some `source.root === true` is present (otherwise `<distDir>/p/**`
 * doesn't exist and the rule would be dead weight).
 *
 * Deliberately `/p/*` — the source's WHOLE `p/` subtree, not narrowed to
 * literally `/o/sha256/*` — for two reasons: (a) Cloudflare Pages' `*`
 * wildcard match behavior across MULTIPLE path segments is the documented
 * case for a trailing `/*` (their own docs' canonical example is exactly
 * this shape); a tighter pattern trying to target only the CAS subtree
 * would have to assume `*` spans the opaque N-depth namespace/package path
 * in between, which is the one thing this whole package refuses to assume
 * ([#716]). (b) package ROOT json is also untrusted verbatim content from
 * the source's own registry/repo, and sandboxing a JSON response is
 * harmless — the broader glob is strictly safer, never less so, than a
 * CAS-only one.
 */
function renderSandboxBlock(pattern: string): string {
  return `${pattern}\n  Content-Security-Policy: sandbox\n  X-Content-Type-Options: nosniff`;
}

export function renderHeaders(sources: readonly ResolvedSourceFiles[], base: string): string {
  // C-006: every pattern is the site-relative one joined onto `base`, so the
  // sandbox covers exactly the paths the site serves under its prefix.
  const blocks: string[] = [];

  if (sources.some((source) => source.root)) {
    blocks.push(renderSandboxBlock(joinBase(base, "/p/*")));
  }
  for (const label of new Set(sources.map((source) => source.label))) {
    blocks.push(renderSandboxBlock(joinBase(base, `/index/${label}/p/*`)));
  }

  return blocks.join("\n\n") + "\n";
}
