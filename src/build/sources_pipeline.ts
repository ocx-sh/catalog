import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedSource, SourceEntry } from "../config/types.js";
import { readGitSource } from "../sources/git.js";
import { checkLabelConflicts, resolveLabel } from "../sources/labels.js";
import { compareQualifiedIds, mirrorSources } from "../sources/mirror.js";
import { readPathSource } from "../sources/path.js";
import { extractPackages, SourceError, type ResolvedSourceFiles, type WirePath } from "../sources/types.js";
import { readUrlSource } from "../sources/walker.js";
import { catalogIndex, serializeCatalog } from "../viewmodel/catalog.js";
import type { CatalogSourcePackage } from "../viewmodel/types.js";
import { BuildError } from "./errors.js";
import type { PackageRoute } from "./pages.js";
import { cacheBaseDir } from "./scratch.js";

/**
 * The source layer's wiring into the build (C-003 -> C-004/C-005/C-006):
 * the one place the three readers (`sources/path.ts`, `sources/walker.ts`,
 * `sources/git.ts`), label resolution (`sources/labels.ts`), the catalog
 * view model (`viewmodel/catalog.ts`) and the mirror copy
 * (`sources/mirror.ts`) are composed.
 *
 * Shared by BOTH entrypoints — `engine.ts` (`ocx-catalog build`) and
 * `dev_worker.ts` (`ocx-catalog dev`, inside its forked child). They differ
 * only in WHERE the emitted tree lands (the caller's `outDir` vs. the
 * scratch root's `public/`), never in how sources resolve, so resolution
 * itself exists exactly once, here.
 *
 * ## Two halves, two call sites
 *
 * `resolveCatalog()` runs BEFORE anything is written: it produces everything
 * `synthesizePages()`/`generateConfig()` need (`routes`, `descLookup`) plus
 * the bytes/trees `emitCatalogTree()` writes afterwards. `emitCatalogTree()`
 * runs AFTER the VitePress run (for `build`) or before `createServer()` (for
 * `dev`), against whichever directory that entrypoint serves from.
 *
 * ## `/data/catalog/catalog.json` is the MERGED catalog, written LAST
 *
 * `mirrorSources()` already writes a PER-SOURCE `catalog.json` (its own doc
 * comment: the `root: true` source's lands at `<dir>/data/catalog/catalog.json`,
 * every other source's under `<dir>/index/<label>/data/catalog/catalog.json`).
 * That root-source-only file is NOT what the theme wants: `useCatalog.ts`
 * fetches the single site-root `/data/catalog/catalog.json` and the README's
 * multi-source contract is that "the catalog's package grid and search merge
 * entries from every configured source". So `emitCatalogTree()` calls
 * `mirrorSources()` FIRST and then overwrites that one path with the MERGED
 * catalog — a deliberate last-write-wins, not an accident of ordering. The
 * per-source copies under `index/<label>/` are left exactly as `mirror.ts`
 * wrote them.
 *
 * Same rule settles the other two writers that can touch that path: a
 * consumer's own `publicDir` (copied into the scratch root by
 * `synthesizePages()`, then into `dist/` by VitePress) and, in `dev`, the
 * scratch root's `public/` tree. In both cases the generated catalog is
 * written after everything else that could land on it, so a consumer file at
 * `public/data/catalog/catalog.json` never shadows the real catalog.
 *
 * ## `url` sources: where the fetch cache lives
 *
 * `readUrlSource` requires a `cacheDir`, and its value is the whole point of
 * that reader's conditional-GET/CAS design: the cached `c/index.json` +
 * `ETag` and the content-addressed blobs are only ever useful ACROSS builds
 * (`walker.ts`'s own doc). A directory under the self-sweeping C-005 scratch
 * root would therefore be silently useless — disposed at the end of every
 * run, making every build a cold fetch that still looks correct. It lives in
 * the consumer's own `node_modules/.cache/ocx-catalog/url/<key>` instead
 * (`scratch.ts`'s `cacheBaseDir()`, the same base the scratch roots are
 * created NEXT TO but never inside), keyed by a hash of the source URL so
 * two `url` sources never share one `index.etag`/`index.json` pair — those
 * two filenames are fixed per `cacheDir`, so a shared directory would make
 * each source serve the other's cached enumeration on a 304.
 *
 * ## Error mapping
 *
 * Every failure raised while reading/parsing source data is re-thrown as a
 * `BuildError` (`errors.ts`) so the CLI's existing two-branch `instanceof`
 * dispatch maps it — no second mechanism: `SourceError("FETCH_FAILED")` (an
 * unreachable `url` source, already naming the URL and the last HTTP
 * status/network error) becomes `UNAVAILABLE` -> exit 69 (S-002); every
 * other `SourceError` and every plain parse failure `extractPackages`
 * propagates (malformed root JSON, an S-008 name/path mismatch — both
 * already naming the offending wire file) becomes `DATA` -> exit 65 (S-001).
 * Each message is prefixed with the offending source's config index and
 * target, so the file name from the inner message survives with its source
 * identified. Nothing partial is ever written for these: resolution
 * completes fully before either entrypoint touches its output directory.
 */
export interface ResolvedCatalog {
  /** Every configured source's wire tree + final label + `root` flag, in
   * `sources[]` order — `mirrorSources()`'s input, verbatim. */
  readonly sources: readonly ResolvedSourceFiles[];
  /** One route per DISTINCT package across every source, catalog order —
   * `synthesizePages()`'s `packages`. */
  readonly routes: readonly PackageRoute[];
  /** `generateConfig()`'s per-package OG title/description lookup, keyed by
   * the same segments `routes` carries. `null` for a package whose root
   * publishes no `desc` block (`config_gen.ts` degrades to generic copy). */
  readonly descLookup: (segments: readonly string[]) => { title: string; description: string } | null;
  /** The merged `/data/catalog/catalog.json` bytes — see this module's doc. */
  readonly catalogJson: string;
}

/** Surfaces a source reader's non-fatal warning (`types.ts`'s
 * `SourceWarning` — today only `git.ts`'s `.gitmodules` notice and
 * `walker.ts`'s unfetchable-desc-asset notice) on stderr. That module never
 * writes to a stream itself, deliberately; this is the build's choice of
 * sink, and stderr keeps it out of any `stdout` a caller might be piping. */
export function warnToStderr(message: string): void {
  process.stderr.write(`ocx-catalog: ${message}\n`);
}

/** Names a source by its config index and its own target, so a failure
 * message points at the `sources[]` entry a user has to go fix. */
function describeSource(index: number, entry: SourceEntry): string {
  return `sources[${index}] (${entry.path ?? entry.url ?? entry.git})`;
}

/** Per-`url`-source cache directory name — a hash, not the URL itself: a URL
 * is not a safe single path segment (`/`, `:`, `?`), and a hash is stable
 * across runs, which is what makes the cache a cache. */
function urlCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

async function readSource(entry: SourceEntry, configDir: string): Promise<ReadonlyMap<WirePath, Uint8Array>> {
  if (entry.path !== undefined) {
    return readPathSource(entry, configDir);
  }
  if (entry.url !== undefined) {
    const cacheDir = join(await cacheBaseDir(), "url", urlCacheKey(entry.url));
    // `readUrlSource` writes `<cacheDir>/index.json` before it creates any
    // directory of its own (it only ever mkdirs `<cacheDir>/cas`), so the
    // cache root is the caller's to create.
    await mkdir(cacheDir, { recursive: true });
    return readUrlSource(entry, { cacheDir, warn: warnToStderr });
  }
  return readGitSource(entry, { warn: warnToStderr });
}

function asBuildError(err: unknown, context: string): BuildError {
  const unavailable = err instanceof SourceError && err.code === "FETCH_FAILED";
  return new BuildError(unavailable ? "UNAVAILABLE" : "DATA", `${context}: ${(err as Error).message}`);
}

interface SourceResult {
  readonly resolved: ResolvedSourceFiles;
  readonly packages: readonly CatalogSourcePackage[];
  /** `PackageRoute.wireBase` for every package this source contributes —
   * `""` for the `root: true` source (its tree is mirrored at the site
   * root), `index/<label>` for every other (`mirror.ts`'s placement). */
  readonly wireBase: string;
}

async function readOneSource(source: ResolvedSource, index: number, configDir: string): Promise<SourceResult> {
  try {
    const files = await readSource(source.entry, configDir);
    // `labels.ts`: an explicit label is used verbatim, a `null` one is
    // derived from this source's OWN roots — which is why a source with
    // neither an explicit `label` nor a single package root is a hard error
    // (LABEL_DERIVATION_EMPTY), not an empty catalog.
    const label = resolveLabel(source, files);
    const root = source.entry.root === true;
    const wireBase = root ? "" : `index/${label}`;
    // Attached HERE, not inside `extractPackages`: that function reads one
    // source's wire tree and cannot know where `mirror.ts` will mount it.
    // `catalogEntry` builds this package's `logoUrl`/`readmeUrl` through it,
    // so a non-root source's assets resolve to the `index/<label>/p/...`
    // tree the mirror actually writes.
    const packages = extractPackages(files).map((pkg) => ({ ...pkg, wireBase }));
    return { resolved: { label, files, root }, packages, wireBase };
  } catch (err) {
    throw asBuildError(err, describeSource(index, source.entry));
  }
}

/**
 * Reads every configured source, resolves its label, and merges their
 * packages into the one catalog the site renders.
 *
 * Sources are read SEQUENTIALLY, in `sources[]` order: the first failure is
 * the reported one (no interleaved stderr from a second source's reader
 * racing it), and no source is fetched after another has already failed.
 *
 * Merge rules:
 * - A qualified package id (`<namespace>/<package>`) present in more than
 *   one source resolves to the FIRST configured source's copy — config order
 *   is precedence order. Without this the grid would show one row per
 *   duplicate and two sources would fight over the same detail-page route.
 * - The merged list is then sorted by `compareQualifiedIds` (`mirror.ts`'s
 *   exported comparator — the same key that module sorts its own per-source
 *   catalogs by, so both agree), because `catalogIndex` explicitly does not
 *   sort and its caller must.
 */
export async function resolveCatalog(
  sources: readonly ResolvedSource[],
  configDir: string,
): Promise<ResolvedCatalog> {
  const results: SourceResult[] = [];
  for (const [index, source] of sources.entries()) {
    results.push(await readOneSource(source, index, configDir));
  }

  try {
    // The deferred second pass `labels.ts` documents: `loadConfig` can only
    // compare EXPLICIT labels pairwise, and derived ones aren't known until
    // every source above has been read.
    checkLabelConflicts(results.map((result) => result.resolved.label));
  } catch (err) {
    throw asBuildError(err, "sources");
  }

  const merged: { readonly pkg: CatalogSourcePackage; readonly wireBase: string }[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const pkg of result.packages) {
      const id = `${pkg.packageId.namespace}/${pkg.packageId.package}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push({ pkg, wireBase: result.wireBase });
    }
  }
  merged.sort((a, b) => compareQualifiedIds(a.pkg, b.pkg));

  const routes: PackageRoute[] = [];
  const descTable = new Map<string, { title: string; description: string }>();
  for (const { pkg, wireBase } of merged) {
    // Depth-N, never a fixed two-segment split ([#716]): the namespace is
    // one segment, the package name is 1..N more.
    const segments = [pkg.packageId.namespace, ...pkg.packageId.package.split("/")];
    routes.push({ segments, wireBase });
    const desc = pkg.root.desc;
    if (desc !== null) {
      descTable.set(segments.join("/"), { title: desc.title, description: desc.description });
    }
  }

  let catalogJson: string;
  try {
    catalogJson = serializeCatalog(catalogIndex(merged.map((entry) => entry.pkg)));
  } catch (err) {
    // `catalogEntry` throws on a dangling CAS reference or an unparseable
    // image index — source-data problems, exit 65, not an internal crash.
    throw asBuildError(err, "catalog");
  }

  return {
    sources: results.map((result) => result.resolved),
    routes,
    descLookup: (segments) => descTable.get(segments.join("/")) ?? null,
    catalogJson,
  };
}

/**
 * Writes every source's wire tree plus the merged catalog into `dir` — the
 * C-006 mirror copy (`index/<label>/**` for every source, plus the site root
 * for the `root: true` one) and `_headers`, both `mirrorSources()`'s own job
 * per its doc comment, followed by the merged
 * `<dir>/data/catalog/catalog.json` (see this module's doc for why that one
 * is written last).
 *
 * `dir` is the caller's OUTPUT directory: `outDir` for `build` (after the
 * VitePress run, so nothing the build itself emits can clobber it), or the
 * scratch root's `<srcDir>/public/` for `dev`, where Vite serves it as
 * static content — that is what makes `dev` show live wire data (S-003)
 * without a build step.
 */
export async function emitCatalogTree(catalog: ResolvedCatalog, dir: string): Promise<void> {
  await mirrorSources(catalog.sources, dir);
  const catalogDir = join(dir, "data", "catalog");
  await mkdir(catalogDir, { recursive: true });
  await writeFile(join(catalogDir, "catalog.json"), catalog.catalogJson, "utf8");
}
