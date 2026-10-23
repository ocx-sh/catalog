import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOutDirOutsideInputs, assertOutDirSafe, resolveReal } from "../cli/out_dir.js";
import { loadConfig } from "../config/load.js";
import type { LoadedConfig } from "../config/types.js";
import { cspHashes } from "../site/csp_hashes.js";
import { violationPath } from "../site/css_containment.js";
import { siteModel } from "../site/model/index.js";
import { writeDocsIndex } from "../viewmodel/docs_index.js";
import { writeSupportMatrices } from "../viewmodel/support_matrix.js";
import type { Catalog } from "../viewmodel/types.js";
import { assemblePublic, writeSiteJson } from "./assemble.js";
import { renderReadmes } from "./readmes.js";
import { writeAstroConfig } from "./astro_config_file.js";
import { runAstro, type AstroRunOptions } from "./astro_runner.js";
import { writeContentConfig } from "./content_config.js";
import { copyDocsAssets, scanDocs } from "./docs_scan.js";
import { BuildError, RenderError } from "./errors.js";
import { createScratchRoot } from "./scratch.js";
import { reservedNamesFor, resolveCatalog, type ResolvedCatalog } from "./sources_pipeline.js";

export interface BuildCatalogOptions {
  /** Path to `catalog.config.json`, resolved against `process.cwd()` when relative. */
  readonly configPath: string;
  /** Output directory, resolved against `process.cwd()` when relative. */
  readonly outDir: string;
}

export interface BuildCatalogResult {
  /** Absolute output directory the build wrote to (`options.outDir`, resolved). */
  readonly outDir: string;
}

/** Test seams; production callers pass nothing. */
export interface BuildCatalogDeps {
  /** Runs one `astro build`; resolves when it exited 0, rejects otherwise. */
  readonly render?: (options: AstroRunOptions) => Promise<void>;
  /** The promotion's rename (C-038), injectable to fault the promotion. */
  readonly rename?: typeof rename;
  /** The promotion's removals (stale staging/retired trees), injectable to fault the post-commit cleanup. */
  readonly rm?: typeof rm;
  /** Registers a signal handler; returns its remover (`process.on` by default). */
  readonly onSignal?: (signal: NodeJS.Signals, handler: () => void) => () => void;
  /** Re-delivers an interrupt once cleanup is done, so the process ends by that signal (130/143 in a shell). */
  readonly raise?: (signal: NodeJS.Signals) => void;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** `process.on` with its remover: the default `onSignal` seam (shared with `dev.ts`). */
export const onProcessSignal = (signal: NodeJS.Signals, handler: () => void): (() => void) => {
  process.on(signal, handler);
  return () => {
    process.off(signal, handler);
  };
};

const raiseSignal = (signal: NodeJS.Signals): void => {
  process.kill(process.pid, signal);
};

/**
 * Holds SIGINT/SIGTERM handlers for `body`. Node's default disposition ends the
 * process without an `exit` event, so without a handler the scratch root and
 * staging dir would leak and a signal mid-promotion could leave `outDir`
 * missing. The first signal only sets a flag: the in-flight step finishes (the Astro
 * child gets the signal from its own runner and ends the render early), `body`
 * checks it between steps via `checkpoint` and unwinds through its `finally`
 * cleanup, and only then is the signal re-delivered with the handlers removed. A
 * second signal in the meantime re-delivers at once, handlers removed.
 */
async function withInterrupts<T>(deps: BuildCatalogDeps, body: (checkpoint: () => void) => Promise<T>): Promise<T> {
  let interrupted: NodeJS.Signals | undefined;
  let reraised = false;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const remove of removers) remove();
  };
  // A second signal while the first is still being honoured is the user insisting: skip the unwind.
  const reraise = (signal: NodeJS.Signals): void => {
    release();
    if (reraised) return;
    reraised = true;
    (deps.raise ?? raiseSignal)(signal);
  };
  const removers = SIGNALS.map((signal) =>
    (deps.onSignal ?? onProcessSignal)(signal, () => {
      if (interrupted !== undefined) return reraise(signal);
      interrupted = signal;
    }),
  );
  const checkpoint = (): void => {
    if (interrupted !== undefined) throw new RenderError(`build interrupted by ${interrupted}`);
  };
  try {
    return await body(checkpoint);
  } finally {
    release();
    if (interrupted !== undefined) reraise(interrupted);
  }
}

/** Relays each child line (already prefixed by the runner) to this process's stderr, whichever stream it came on (C-046). */
const relay = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const renderWithAstro = async (options: AstroRunOptions): Promise<void> => {
  await runAstro("build", options, { spawn, env: process.env }).exit;
};

// Any stat failure reads as "no previous build": the promotion's rename then
// fails loudly (and rolls back) if something unreadable is really in the way.
const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const stagingPath = (outDir: string, pid = process.pid): string => `${outDir}.staging-${pid}`;
const retiredPath = (outDir: string, pid = process.pid): string => `${outDir}.retired-${pid}`;

/**
 * `process.kill(pid, 0)` probes without signalling. Only `ESRCH` proves the process gone: `EPERM` is a
 * live process we may not signal, and anything else (an out-of-range pid) is unknown, so left alone.
 */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

/** True when `path` equals, contains or lies inside a config input (C-036's relation), or cannot be judged: not ours to delete or rename. */
const isInput = (path: string, loaded: LoadedConfig): Promise<boolean> =>
  assertOutDirOutsideInputs(path, loaded).then(
    () => false,
    () => true,
  );

/** The marker `<out>.staging-<pid>` / `<out>.retired-<pid>` belong to: `.<out>.ocx-catalog-<pid>`, beside them, never inside the published tree. */
const markerPath = (outDir: string, pid: number): string => join(dirname(outDir), `.${basename(outDir)}.ocx-catalog-${pid}`);

/** A per-boot or per-PID-namespace fact; a platform without it gives the same error text on every read. */
const fact = (read: Promise<string>): Promise<string> => read.then((value) => value.trim(), String);

/** Where a pid means something: the host, its boot and the PID namespace. A pid read under another identity may be alive. */
const identity = async (): Promise<string> =>
  JSON.stringify({
    host: hostname(),
    boot: await fact(readFile("/proc/sys/kernel/random/boot_id", "utf8")),
    pidns: await fact(readlink("/proc/self/ns/pid")),
  });

/** `lstat`-based: a symlink is never a marker or a sibling of ours, wherever it points. */
const isPlain = (path: string, kind: "file" | "directory"): Promise<boolean> =>
  lstat(path).then(
    (entry) => (kind === "file" ? entry.isFile() : entry.isDirectory()),
    () => false,
  );

/**
 * Claims `pid`'s staging/retired siblings of `outDir`, before either exists: only a marked sibling is ever swept.
 * A file or symlink at the marker path is removed first (`rm` unlinks a symlink, never its target) and the marker
 * is created exclusively (`wx`) under a temp name and renamed into place, so a planted symlink is never written
 * through and a SIGKILL never leaves a marker that exists but is still empty (the sweep would read that as foreign).
 * A directory there is a DATA error.
 */
export async function markSiblings(outDir: string, pid: number = process.pid): Promise<void> {
  const path = markerPath(outDir, pid);
  // Not ours to remove recursively: a directory there is the user's.
  if (await isPlain(path, "directory")) {
    throw new BuildError("DATA", `${path} is a directory: the build writes its marker file there; remove it, or pick another --out`);
  }
  const temp = `${path}.tmp`;
  await rm(temp, { force: true });
  await writeFile(temp, await identity(), { flag: "wx" });
  await rename(temp, path);
}

/**
 * Sweeps the `<out>.staging-<pid>` / `<out>.retired-<pid>` siblings a build left when its process died
 * before the `finally` (SIGKILL, OOM, power loss). Only a pid with a marker (`markSiblings`) written under
 * this host, boot and PID namespace is judged, so a user's `dist.retired-2024` and another container's
 * live build are never touched. A stale `staging` is a half-rendered site: removed. A stale `retired` is
 * the previous build renamed aside: if the promotion died before the new tree was renamed into place
 * `outDir` is missing, so it is restored; otherwise it is removed. A live pid's siblings (a concurrent
 * build) are never touched, nor is an entry that is a config input.
 */
async function sweepStale(outDir: string, loaded: LoadedConfig, rename_: typeof rename, rm_: typeof rm): Promise<void> {
  const prefix = basename(markerPath(outDir, 0)).slice(0, -1);
  const here = await identity();
  for (const entry of await readdir(dirname(outDir))) {
    const digits = entry.startsWith(prefix) ? entry.slice(prefix.length) : "";
    const pid = Number(digits);
    if (!/^\d+$/.test(digits) || isAlive(pid)) continue;
    const path = markerPath(outDir, pid);
    // A symlinked or unreadable marker is no proof of anything: left alone, like a foreign one.
    if (!(await isPlain(path, "file")) || (await readFile(path, "utf8").catch(String)) !== here) continue;
    for (const sibling of [stagingPath(outDir, pid), retiredPath(outDir, pid)]) {
      if (!(await isPlain(sibling, "directory")) || (await isInput(await resolveReal(sibling), loaded))) continue;
      if (sibling.endsWith(`.retired-${pid}`) && !(await exists(outDir))) await rename_(sibling, outDir);
      else await rm_(sibling, { recursive: true, force: true });
    }
    await rm(path, { force: true });
  }
}

/** The renames promoting a build can fail where a rename cannot go: a mount point, another device, a locked or read-only directory. */
const RENAME_LIMITS = new Set(["EBUSY", "EXDEV", "EPERM", "EACCES", "EROFS"]);

/**
 * C-038 promotion: rename `outDir` aside, rename `staging` into place, remove
 * the old tree. A failed second rename moves the old tree back, so a failure
 * anywhere leaves the previous `outDir` as it was. The retired tree is only
 * removed after the new one is in place — never on a failed rollback — and
 * once it is, the build has succeeded: a failure removing it only warns.
 */
async function promote(staging: string, outDir: string, rename_: typeof rename, rm_: typeof rm): Promise<void> {
  const retired = retiredPath(outDir);
  await rm_(retired, { recursive: true, force: true });
  const hadPrevious = await exists(outDir);
  try {
    if (hadPrevious) await rename_(outDir, retired);
    try {
      await rename_(staging, outDir);
    } catch (err) {
      // The original error is the one to report: a failed rollback must not replace it.
      if (hadPrevious) {
        await rename_(retired, outDir).catch((rollback: unknown) => {
          process.stderr.write(
            `ocx-catalog build: warning: could not restore the previous build from ${retired}: ${(rollback as Error).message}\n`,
          );
        });
      }
      throw err;
    }
  } catch (err) {
    if (RENAME_LIMITS.has((err as NodeJS.ErrnoException).code ?? "")) {
      process.stderr.write(
        `ocx-catalog build: hint: the output is replaced by renaming a staging directory beside ${outDir}, ` +
          "so --out cannot be a mount point and its parent must be writable on the same filesystem\n",
      );
    }
    throw err;
  }
  // The new tree is in place: the build has succeeded. A failure removing the old one is a leftover to report.
  await rm_(retired, { recursive: true, force: true }).catch((err: unknown) => {
    process.stderr.write(
      `ocx-catalog build: warning: could not remove the previous build at ${retired}: ${(err as Error).message}\n`,
    );
  });
}

/**
 * `buildCatalog` (C-005): the `ocx-catalog build` entrypoint.
 *
 * 1. `loadConfig` — config errors surface before anything is written.
 * 2. C-036 input-tree guard (`--out` is realpath'd; it must not overlap the
 *    config's inputs).
 * 3. `resolveCatalog` — reads every source. A source failure leaves nothing
 *    behind: no scratch root, no staging.
 * 4. `createScratchRoot`, then the scratch-root guard; staging/retired
 *    siblings left by dead processes are swept (`sweepStale`).
 * 5. Assembly: `public/` (consumer files, wire mirror, merged catalog), then
 *    `site.json` (model + the Astro `SiteInput`) and `astro.config.mjs`.
 * 6. `astro build` into a fresh sibling staging dir — never into `outDir`.
 * 7. Promotion (C-038). Staging and the scratch root are removed in `finally`,
 *    so a failure in assembly, render or promotion leaves the previous
 *    `outDir` untouched.
 *
 * From step 4 on SIGINT/SIGTERM are held (`withInterrupts`): a signal aborts
 * before the next step, never mid-promotion, so `outDir` is the old tree or the
 * new one, and the process then ends by that signal after the cleanup.
 *
 * Returns the caller's `outDir`, resolved; internally everything works on its
 * real path, so a symlinked `outDir` keeps pointing where it did.
 */
export async function buildCatalog(
  options: BuildCatalogOptions,
  deps: BuildCatalogDeps = {},
): Promise<BuildCatalogResult> {
  const render = deps.render ?? renderWithAstro;
  const rename_ = deps.rename ?? rename;
  const rm_ = deps.rm ?? rm;
  const loaded = await loadConfig(options.configPath);
  const outDir = resolve(options.outDir);
  const realOut = await resolveReal(outDir);
  await assertOutDirOutsideInputs(realOut, loaded);
  // `build` rm -rf's these PID-named siblings and replaces its marker: they must not be an input either.
  await assertOutDirOutsideInputs(stagingPath(realOut), loaded);
  await assertOutDirOutsideInputs(retiredPath(realOut), loaded);
  await assertOutDirOutsideInputs(markerPath(realOut, process.pid), loaded);
  const catalog = await resolveCatalog(loaded.sources, loaded.configDir, undefined, await reservedNamesFor(loaded));

  return withInterrupts(deps, async (checkpoint) => {
    const scratch = await createScratchRoot();
    const staging = stagingPath(realOut);
    // Set once the marker is ours: whatever sat at its path before (a user's directory) is never removed.
    let marked = false;
    try {
      checkpoint();
      assertOutDirSafe(await resolveReal(scratch.path), realOut);
      await mkdir(dirname(realOut), { recursive: true });
      await sweepStale(realOut, loaded, rename_, rm_);
      await markSiblings(realOut);
      marked = true;
      await rm_(staging, { recursive: true, force: true });

      const { sitePath } = await writeRenderTree({ loaded, catalog, scratch: scratch.path, outDir: staging });
      const configFile = await writeAstroConfig(
        scratch.path,
        new URL("../site/astro_config.js", import.meta.url).href,
        sitePath,
      );

      checkpoint();
      await render({ root: scratch.path, configFile, cwd: dirname(staging), onLine: relay }).catch(async (err: unknown) => {
        // The consumer stylesheet's graph left the config directory: a data error (exit 65), not a render failure.
        const violation = await readFile(violationPath(scratch.path), "utf8").catch(() => undefined);
        throw violation === undefined ? err : new BuildError("DATA", violation, { cause: err });
      });
      // A signal during the render: its output is not wanted, `outDir` stays as it was.
      checkpoint();
      await promote(staging, realOut, rename_, rm_);
      return { outDir };
    } finally {
      try {
        await rm_(staging, { recursive: true, force: true });
        // A retired tree still on disk (its removal failed) stays claimed, for a later sweep.
        if (marked && !(await exists(retiredPath(realOut)))) await rm(markerPath(realOut, process.pid), { force: true });
      } finally {
        await scratch.dispose();
      }
    }
  });
}

export interface RenderTreeInput {
  readonly loaded: LoadedConfig;
  readonly catalog: ResolvedCatalog;
  /** The live scratch root: every path baked into `site.json` (cache, public, site file) points here. */
  readonly scratch: string;
  /** Where the files are written; defaults to `scratch`. A staged `dev` reload writes beside the live files. */
  readonly stage?: string;
  /** Astro's `outDir`: the staging dir for `build`, an unused scratch path for `dev`. */
  readonly outDir: string;
  /** `dev` only: the port the child binds (`strictPort`). */
  readonly port?: number;
}

/**
 * The preparation `build` and `dev` share: `public/` (consumer files, wire
 * mirror, merged catalog), the docs content config (first write only: a
 * staged write leaves the live one), then `site.json` (model + the Astro
 * `SiteInput`). Returns the written `site.json` path.
 */
export async function writeRenderTree(input: RenderTreeInput): Promise<{ sitePath: string }> {
  const { loaded, catalog, scratch, outDir, port } = input;
  const stage = input.stage ?? scratch;
  const base = loaded.config.base;
  const publicDir = await assemblePublic({ scratch: stage, loaded, catalog, base });
  // `docs` is the one collection source: scanned for the model, declared for Astro's content layer.
  const docsDir = loaded.config.docs === undefined ? undefined : join(loaded.configDir, loaded.config.docs);
  const docs = docsDir === undefined ? [] : await scanDocs(docsDir);
  if (docsDir !== undefined) await copyDocsAssets(docsDir, publicDir, docs);
  if (docsDir !== undefined) await writeDocsIndex(publicDir, docsDir, docs, base);
  if (docsDir !== undefined && stage === scratch) await writeContentConfig(scratch, docsDir);
  const pure = siteModel(JSON.parse(catalog.catalogJson) as Catalog, catalog.routes, loaded, docs, catalog.wire);
  await writeSupportMatrices(publicDir, pure.details);
  // README HTML is rendered here, in the parent: jsdom cannot run in the Astro child (C-014, C-047).
  const model = { ...pure, readme: await renderReadmes(stage, publicDir, pure, scratch) };
  const consumerCss =
    loaded.config.css === undefined ? undefined : { file: resolve(loaded.configDir, loaded.config.css), root: loaded.configDir };
  const sitePath = await writeSiteJson(stage, model, {
    base,
    siteUrl: loaded.config.siteUrl,
    outDir,
    publicDir: resolve(scratch, "public"),
    cacheDir: resolve(scratch, ".astro-cache"),
    sitePath: resolve(scratch, "site.json"),
    cspHashes: cspHashes(),
    ...(docsDir === undefined ? {} : { docsDir }),
    ...(port === undefined ? {} : { port }),
    // `dev` serves the consumer stylesheet and what it `@import`s/`url()`s from where they live.
    fsAllow: [
      scratch,
      resolve(fileURLToPath(new URL("../..", import.meta.url))),
      themeDir(),
      ...(consumerCss === undefined ? [] : [consumerCss.root]),
    ],
  }, consumerCss);
  return { sitePath };
}

/** The resolved `@ocx-sh/theme` source directory (follows a `file:` link to its real path). */
const themeDir = (): string =>
  dirname(createRequire(import.meta.url).resolve("@ocx-sh/theme/tokens.css"));
