import { statSync, watch as fsWatch } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { LoadedConfig } from "../config/types.js";
import { README_DIR } from "./assemble.js";
import { writeContentConfig } from "./content_config.js";
import { writeRenderTree } from "./engine.js";
import { reservedNamesFor, resolveCatalog, type RemoteCache } from "./sources_pipeline.js";

/**
 * The `ocx-catalog dev` reload loop (C-024, S-004). It watches everything the
 * site is built from — the config file, the wire subtrees of every `path`
 * source, `docs`, `css`, `publicDir`, `brand.logo` (see `watchTargets`) — and,
 * after a quiet period, rebuilds the scratch root's inputs without restarting
 * the supervisor:
 *
 * - the config is re-read and the `path` sources re-resolved; `url`/`git`
 *   results are memoised per source entry (`RemoteCache`) and only read again
 *   when their entry changes or `dev` restarts;
 * - the new `public/`, `readme/`, `site.json` (and a new docs `src/content.config.ts`)
 *   are written to `<scratch>/next/`, beside the live ones, then swapped in
 *   (`site.json` last: Astro watches it and restarts in place when it changes;
 *   its README paths already name the live `readme/`);
 * - a failure at any step prints the error and keeps the last good state,
 *   which is never touched before the swap;
 * - a changed `base` cannot be applied by Astro's in-place restart, so the
 *   supervisor respawns the child (same port) through `onBaseChange`.
 */

/** Opens a watch on `path`; `onChange` gets the changed path relative to it. */
export type WatchFn = (
  path: string,
  onChange: (relative: string) => void,
  onError: (err: Error) => void,
  options: { readonly recursive: boolean },
) => { close(): void };

export interface ReloadTimers {
  readonly set: (action: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface DevReloadOptions {
  /** The live scratch root `dev` renders from. */
  readonly scratch: string;
  readonly port: number;
  /** The config as first loaded; the "last good state" until a reload succeeds. */
  readonly initial: LoadedConfig;
  /** Absolute config file, watched itself; absent for `--source`. */
  readonly configFile?: string;
  /** The memo the initial `resolveCatalog` filled, so the first reload does not refetch `url`/`git` sources. */
  readonly remoteCache: RemoteCache;
  /** Re-reads the config (or the `--source` sugar's implicit one). */
  readonly loadInputs: () => Promise<{ readonly loaded: LoadedConfig; readonly fallbackLabel: string | undefined }>;
  /** Called after the swap when `base` changed: respawn the child on the same port. */
  readonly onBaseChange: (base: string) => Promise<void>;
  /** A notice (stdout). */
  readonly log: (line: string) => void;
  /** A failure (stderr). */
  readonly warn: (line: string) => void;
  readonly watch?: WatchFn;
  readonly timers?: ReloadTimers;
  readonly debounceMs?: number;
  readonly rename?: typeof rename;
}

export interface DevReload {
  /** Reloads now (the debounced path ends here); resolves when no reload is running. */
  reload(): Promise<void>;
  /** Stops watching, cancels a pending debounce and waits for a running reload to finish. */
  close(): Promise<void>;
}

const DEBOUNCE_MS = 150;
/** The staged directories a reload always swaps in (`README_DIR`: `site.json` holds absolute paths into it). */
const SWAPPED_DIRS = ["public", README_DIR] as const;
/** The staged directory holding the docs `content.config.ts`, swapped in only when a reload writes one. */
const CONTENT_DIR = "src";
/** Directories whose churn never reaches the site: source readers only look at wire files, and
 * `.ocx-catalog` is the scratch/cache base when the project has no `node_modules`. */
const NOISE = new Set(["node_modules", ".git", ".ocx-catalog"]);

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

export const realWatch: WatchFn = (path, onChange, onError, options) => {
  // fs.watch throws ENOENT synchronously on some platforms/Node versions and reports it
  // asynchronously on others; stat first so the caller's catch sees one contract everywhere.
  statSync(path);
  const watcher = fsWatch(path, { recursive: options.recursive }, (_event, filename) => onChange(filename ?? ""));
  watcher.on("error", onError);
  return watcher;
};

const realTimers: ReloadTimers = {
  set: (action, ms) => setTimeout(action, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * One watcher. With `only`, the directory `path` itself, non-recursive, reacting
 * to just those entry names; without it, the whole tree beneath `path`.
 */
export interface WatchTarget {
  readonly path: string;
  readonly only?: readonly string[];
  /** Skipped without a warning while `path` does not exist (a source with no `c/` or `p/`); every reload retries it. */
  readonly optional?: boolean;
}

/** Everything a reload reads. */
export function watchTargets(loaded: LoadedConfig, configFile: string | undefined): WatchTarget[] {
  const { config, configDir } = loaded;
  const targets: WatchTarget[] = [];
  // A single file is watched through its directory: an editor that saves by
  // rename-replace leaves a watch on the file itself pointing at the old inode.
  const file = (path: string): void => {
    targets.push({ path: dirname(path), only: [basename(path)] });
  };
  if (configFile !== undefined) file(configFile);
  for (const { entry } of loaded.sources) {
    if (entry.path === undefined) continue;
    // The wire subtrees `readDirectoryTree` reads, never the root: that is often a whole checkout
    // (`node_modules`, `.git`), where a recursive watch costs seconds and hundreds of thousands of inotify watches.
    const root = resolve(configDir, entry.path);
    targets.push({ path: root, only: ["config.json", "c", "p"] });
    targets.push({ path: join(root, "c"), only: ["index.json"], optional: true });
    targets.push({ path: join(root, "p"), optional: true });
  }
  for (const relative of [config.docs, config.publicDir]) {
    if (relative !== undefined) targets.push({ path: resolve(configDir, relative) });
  }
  for (const relative of [config.css, config.brand?.logo]) {
    if (relative !== undefined) file(resolve(configDir, relative));
  }
  return targets;
}

const targetKey = (target: WatchTarget): string => JSON.stringify([target.path, target.only]);

const docsDirOf = (loaded: LoadedConfig): string | undefined =>
  loaded.config.docs === undefined ? undefined : join(loaded.configDir, loaded.config.docs);

export function startDevReload(options: DevReloadOptions): DevReload {
  const { scratch, port, remoteCache } = options;
  const watch = options.watch ?? realWatch;
  const timers = options.timers ?? realTimers;
  const rename_ = options.rename ?? rename;
  const stage = join(scratch, "next");
  const watchers = new Map<string, { path: string; watcher: { close(): void } }>();
  let lastGood = options.initial;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let again = false;
  let closed = false;

  const reportError = (what: string, err: unknown): void =>
    options.warn(`ocx-catalog dev: ${what}: ${(err as Error).message}`);

  const schedule = (): void => {
    if (closed) return;
    if (timer !== undefined) timers.clear(timer);
    timer = timers.set(() => {
      timer = undefined;
      void reload();
    }, options.debounceMs ?? DEBOUNCE_MS);
  };

  /** Ignores the scratch root (a watched source dir may contain it) and dependency/VCS churn. */
  const relevant = (root: string, relative: string): boolean => {
    const absolute = join(root, relative);
    if (absolute === scratch || absolute.startsWith(scratch + sep)) return false;
    return !relative.split(sep).some((segment) => NOISE.has(segment));
  };

  /** A non-recursive watch reacts to its named entries only; an event without a name might be any of them. */
  const matches = (target: WatchTarget, relative: string): boolean =>
    target.only === undefined ? relevant(target.path, relative) : relative === "" || target.only.includes(relative);

  const unwatchDir = (path: string): void => {
    for (const [key, entry] of watchers) {
      if (entry.path !== path) continue;
      entry.watcher.close();
      watchers.delete(key);
    }
  };

  /** Opens a watcher for each target not yet watched, closes those no longer read. */
  const syncWatchers = (loaded: LoadedConfig): void => {
    const wanted = new Map(watchTargets(loaded, options.configFile).map((target) => [targetKey(target), target]));
    for (const [key, { watcher }] of watchers) {
      if (wanted.has(key)) continue;
      watcher.close();
      watchers.delete(key);
    }
    for (const [key, target] of wanted) {
      if (watchers.has(key)) continue;
      try {
        const watcher = watch(
          target.path,
          (relative) => {
            if (!matches(target, relative)) return;
            // `c`/`p` replaced (a checkout recreates the directory): the watch on the old one is dead.
            // Dropped here, it is re-armed when the reload starts.
            if (relative !== "") unwatchDir(join(target.path, relative));
            schedule();
          },
          (err) => reportError(`watching ${target.path} failed`, err),
          { recursive: target.only === undefined },
        );
        watchers.set(key, { path: target.path, watcher });
      } catch (err) {
        if (target.optional && (err as NodeJS.ErrnoException).code === "ENOENT") continue;
        reportError(`cannot watch ${target.path}`, err);
      }
    }
  };

  /** `dirs` (the files `site.json` points at, and a new content config), then `site.json`, from `<scratch>/next/` into place; any failure restores what was swapped. */
  const swap = async (dirs: readonly string[]): Promise<void> => {
    const undo: (() => Promise<void>)[] = [];
    try {
      for (const name of dirs) {
        const live = join(scratch, name);
        const retired = join(scratch, `${name}.prev`);
        await rm(retired, { recursive: true, force: true });
        const hadLive = await exists(live);
        if (hadLive) await rename_(live, retired);
        undo.push(async () => {
          await rm(live, { recursive: true, force: true });
          if (hadLive) await rename_(retired, live);
        });
        await rename_(join(stage, name), live);
      }
      await rename_(join(stage, "site.json"), join(scratch, "site.json"));
    } catch (err) {
      for (const restore of undo.reverse()) await restore();
      throw err;
    }
    for (const name of dirs) await rm(join(scratch, `${name}.prev`), { recursive: true, force: true });
  };

  const reloadOnce = async (): Promise<void> => {
    // Before the read: a `c/` or `p/` created since the last reload is watched from here on, so a write
    // between its creation and this reload's end is not missed; and a failed reload still arms it.
    if (!closed) syncWatchers(lastGood);
    try {
      const { loaded, fallbackLabel } = await options.loadInputs();
      const catalog = await resolveCatalog(
        loaded.sources,
        loaded.configDir,
        fallbackLabel,
        await reservedNamesFor(loaded),
        remoteCache,
      );
      await rm(stage, { recursive: true, force: true });
      try {
        await writeRenderTree({ loaded, catalog, scratch, stage, outDir: join(scratch, "dist"), port });
        // A staged write leaves the live content config alone; a new docs directory stages its own, swapped in with the rest.
        const dirs: string[] = [...SWAPPED_DIRS];
        const docsDir = docsDirOf(loaded);
        if (docsDir !== undefined && docsDir !== docsDirOf(lastGood)) {
          await writeContentConfig(stage, docsDir);
          dirs.push(CONTENT_DIR);
        }
        await swap(dirs);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
      // `close()` came in while this reload ran: the swap is done, nothing else is wanted.
      if (closed) return;
      const baseChanged = loaded.config.base !== lastGood.config.base;
      lastGood = loaded;
      syncWatchers(loaded);
      options.log(`ocx-catalog dev: reloaded (${catalog.routes.length} packages)`);
      if (baseChanged) {
        options.log(`ocx-catalog dev: base is now ${loaded.config.base}, restarting the server`);
        await options.onBaseChange(loaded.config.base);
      }
    } catch (err) {
      reportError("reload failed, keeping the last good state", err);
    }
  };

  /** Serialises reloads: a request that arrives mid-reload runs one more pass afterwards. */
  const reload = (): Promise<void> => {
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await reloadOnce();
      } while (again && !closed);
    })().finally(() => {
      running = undefined;
    });
    return running;
  };

  syncWatchers(options.initial);
  return {
    reload,
    close: async () => {
      closed = true;
      if (timer !== undefined) timers.clear(timer);
      for (const { watcher } of watchers.values()) watcher.close();
      watchers.clear();
      await running;
    },
  };
}
