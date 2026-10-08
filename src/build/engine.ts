import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOutDirOutsideInputs, assertOutDirSafe, resolveReal } from "../cli/out_dir.js";
import { loadConfig } from "../config/load.js";
import type { LoadedConfig } from "../config/types.js";
import { cspHashes } from "../site/csp_hashes.js";
import { siteModel } from "../site/model/index.js";
import type { Catalog } from "../viewmodel/types.js";
import { assemblePublic, writeSiteJson } from "./assemble.js";
import { renderReadmes } from "./readmes.js";
import { writeAstroConfig } from "./astro_config_file.js";
import { runAstro, type AstroRunOptions } from "./astro_runner.js";
import { writeContentConfig } from "./content_config.js";
import { scanDocs } from "./docs_scan.js";
import { RenderError } from "./errors.js";
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

const stagingPath = (outDir: string): string => `${outDir}.staging-${process.pid}`;
const retiredPath = (outDir: string): string => `${outDir}.retired-${process.pid}`;

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
  if (hadPrevious) await rename_(outDir, retired);
  try {
    await rename_(staging, outDir);
  } catch (err) {
    if (hadPrevious) await rename_(retired, outDir);
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
 * 4. `createScratchRoot`, then the scratch-root guard.
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
  // `build` rm -rf's these PID-named siblings: they must not be an input either.
  await assertOutDirOutsideInputs(stagingPath(realOut), loaded);
  await assertOutDirOutsideInputs(retiredPath(realOut), loaded);
  const catalog = await resolveCatalog(loaded.sources, loaded.configDir, undefined, await reservedNamesFor(loaded));

  return withInterrupts(deps, async (checkpoint) => {
    const scratch = await createScratchRoot();
    const staging = stagingPath(realOut);
    try {
      checkpoint();
      assertOutDirSafe(await resolveReal(scratch.path), realOut);
      await rm_(staging, { recursive: true, force: true });
      await mkdir(dirname(realOut), { recursive: true });

      const { sitePath } = await writeRenderTree({ loaded, catalog, scratch: scratch.path, outDir: staging });
      const configFile = await writeAstroConfig(
        scratch.path,
        new URL("../site/astro_config.js", import.meta.url).href,
        sitePath,
      );

      checkpoint();
      await render({ root: scratch.path, configFile, cwd: dirname(staging), onLine: relay });
      // A signal during the render: its output is not wanted, `outDir` stays as it was.
      checkpoint();
      await promote(staging, realOut, rename_, rm_);
      return { outDir };
    } finally {
      try {
        await rm_(staging, { recursive: true, force: true });
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
  if (docsDir !== undefined && stage === scratch) await writeContentConfig(scratch, docsDir);
  const pure = siteModel(JSON.parse(catalog.catalogJson) as Catalog, catalog.routes, loaded, docs, catalog.wire);
  // README HTML is rendered here, in the parent: jsdom cannot run in the Astro child (C-014, C-047).
  const model = { ...pure, readme: await renderReadmes(stage, publicDir, pure, scratch) };
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
    fsAllow: [scratch, resolve(fileURLToPath(new URL("../..", import.meta.url))), themeDir()],
  });
  return { sitePath };
}

/** The resolved `@ocx-sh/theme` source directory (follows a `file:` link to its real path). */
const themeDir = (): string =>
  dirname(createRequire(import.meta.url).resolve("@ocx-sh/theme/tokens.css"));
