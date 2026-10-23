import { createHash } from "node:crypto";
import { type FSWatcher } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheBaseDir } from "../../src/build/cache_dir.js";
import { realWatch, startDevReload, watchTargets, type DevReloadOptions } from "../../src/build/dev_reload.js";
import { reservedNamesFor, resolveCatalog, type RemoteCache } from "../../src/build/sources_pipeline.js";
import { loadConfig } from "../../src/config/load.js";
import type { LoadedConfig } from "../../src/config/types.js";
import { rootJsonBytes, sha256Digest, utf8 } from "../sources/helpers.js";

/*
 * The reload loop (C-024, S-004) over real temp dirs and real source readers,
 * with an injected watcher and timers so no test waits on the clock. The
 * supervisor-level path (`devServer` -> reload -> respawn) is in dev.test.ts.
 */

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

const WIDGET = rootJsonBytes({ name: "ocx.sh/acme/widget", created: "2026-01-01" });
const GADGET = rootJsonBytes({ name: "ocx.sh/acme/gadget", created: "2026-01-02" });

interface Site {
  readonly dir: string;
  readonly configPath: string;
  readonly indexDir: string;
  readonly scratch: string;
}

/** A config over `./index` (one package, `widget`) plus a live scratch root as `dev` leaves it after boot. */
async function site(extraConfig: Record<string, unknown> = {}): Promise<Site> {
  const dir = await tempDir("catalog-reload-");
  const indexDir = join(dir, "index");
  await mkdir(join(indexDir, "p", "acme"), { recursive: true });
  await writeFile(join(indexDir, "config.json"), JSON.stringify({ format_version: 1 }));
  await writeFile(join(indexDir, "p", "acme", "widget.json"), WIDGET);
  const configPath = join(dir, "catalog.config.json");
  await writeConfig(configPath, extraConfig);
  const scratch = join(dir, "scratch");
  await mkdir(join(scratch, "public"), { recursive: true });
  await writeFile(join(scratch, "public", "marker.txt"), "boot");
  await mkdir(join(scratch, "readme"), { recursive: true });
  await writeFile(join(scratch, "readme", "boot.html"), "boot");
  await writeFile(join(scratch, "site.json"), "boot");
  return { dir, configPath, indexDir, scratch };
}

const writeConfig = (configPath: string, extra: Record<string, unknown> = {}): Promise<void> =>
  writeFile(
    configPath,
    JSON.stringify({ sources: [{ path: "./index", root: true, label: "ocx.sh" }], brand: { title: "T" }, ...extra }),
  );

interface Harness {
  readonly reload: ReturnType<typeof startDevReload>;
  readonly logs: string[];
  readonly warns: string[];
  readonly baseChanges: string[];
  readonly watches: { path: string; recursive: boolean; emit(relative: string): void; fail(err: Error): void; closed: boolean }[];
  /** How many timers are pending (0 or 1) and a way to run it. */
  pendingTimer(): boolean;
  fireTimer(): void;
  readonly loads: () => number;
}

async function start(s: Site, overrides: Partial<DevReloadOptions> = {}): Promise<Harness> {
  const logs: string[] = [];
  const warns: string[] = [];
  const baseChanges: string[] = [];
  const watches: Harness["watches"] = [];
  let timerAction: (() => void) | undefined;
  let loads = 0;
  const initial = await loadConfig(s.configPath);
  const reload = startDevReload({
    scratch: s.scratch,
    port: 4400,
    initial,
    configFile: s.configPath,
    remoteCache: new Map(),
    loadInputs: async () => {
      loads++;
      return { loaded: await loadConfig(s.configPath), fallbackLabel: undefined };
    },
    onBaseChange: async (base) => {
      baseChanges.push(base);
    },
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    watch: (path, onChange, onError, { recursive }) => {
      const watch = { path, recursive, emit: onChange, fail: onError, closed: false };
      watches.push(watch);
      return {
        close: () => {
          watch.closed = true;
        },
      };
    },
    timers: {
      set: (action) => {
        timerAction = action;
        return 1;
      },
      clear: () => {
        timerAction = undefined;
      },
    },
    ...overrides,
  });
  return {
    reload,
    logs,
    warns,
    baseChanges,
    watches,
    pendingTimer: () => timerAction !== undefined,
    fireTimer: () => {
      const action = timerAction;
      timerAction = undefined;
      action?.();
    },
    loads: () => loads,
  };
}

/** The recursive watch on the index's `p/` tree. */
const pTree = (h: Harness): Harness["watches"][number] | undefined =>
  h.watches.find((watch) => watch.recursive && watch.path.endsWith(`${sep}p`));

const catalogJson = async (s: Site): Promise<string> =>
  readFile(join(s.scratch, "public", "data", "catalog", "catalog.json"), "utf8");

describe("watchTargets", () => {
  it("watches the config and single files through their directory, a path source by its wire subtrees, and docs/publicDir as trees", () => {
    const loaded: LoadedConfig = {
      config: {
        sources: [],
        base: "/",
        brand: { title: "T", logo: "brand/logo.svg" },
        docs: "docs",
        css: "site.css",
        publicDir: "static",
      },
      configDir: "/cfg",
      sources: [
        { entry: { path: "./a", root: true }, label: null },
        { entry: { url: "https://example.org" }, label: null },
        { entry: { git: "https://example.org/r.git" }, label: null },
      ],
    };

    expect(watchTargets(loaded, "/cfg/catalog.config.json")).toEqual([
      { path: "/cfg", only: ["catalog.config.json"] },
      { path: "/cfg/a", only: ["config.json", "c", "p"] },
      { path: "/cfg/a/c", only: ["index.json"], optional: true },
      { path: "/cfg/a/p", optional: true },
      { path: "/cfg/docs" },
      { path: "/cfg/static" },
      { path: "/cfg", only: ["site.css"] },
      { path: "/cfg/brand", only: ["logo.svg"] },
    ]);
  });

  it("omits the config file for --source and every optional path that is not set", () => {
    const loaded: LoadedConfig = {
      config: { sources: [], base: "/" },
      configDir: "/idx",
      sources: [{ entry: { path: ".", root: true }, label: null }],
    };

    expect(watchTargets(loaded, undefined)).toEqual([
      { path: "/idx", only: ["config.json", "c", "p"] },
      { path: "/idx/c", only: ["index.json"], optional: true },
      { path: "/idx/p", optional: true },
    ]);
  });

  it("never watches a path source root recursively (a checkout root holds node_modules and .git)", async () => {
    const s = await site();
    const h = await start(s);

    expect(h.watches.filter((watch) => watch.recursive).map((watch) => watch.path)).toEqual([join(s.indexDir, "p")]);
    expect(h.watches.find((watch) => watch.path === s.indexDir)?.recursive).toBe(false);
  });
});

describe("debounce and event filtering", () => {
  it("coalesces a burst of events into one pending timer and one reload", async () => {
    const s = await site();
    const h = await start(s);

    pTree(h)?.emit("acme/widget.json");
    pTree(h)?.emit("acme/gadget.json");
    expect(h.pendingTimer()).toBe(true);
    h.fireTimer();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    expect(h.loads()).toBe(1);
    expect(h.pendingTimer()).toBe(false);
  });

  it.each([
    ["node_modules churn", "node_modules/pkg/index.js"],
    ["git internals", ".git/index"],
    ["a nested cache base", "sub/.ocx-catalog/x"],
  ])("ignores %s", async (_name, relative) => {
    const s = await site();
    const h = await start(s);

    pTree(h)?.emit(relative.split("/").join(sep));

    expect(h.pendingTimer()).toBe(false);
  });

  it("ignores events for the scratch root and anything inside it, which a watched source directory may contain", async () => {
    const s = await site();
    // The scratch root lives inside the watched p/ tree.
    const scratch = join(s.indexDir, "p", ".scratch-x");
    const h = await start(s, { scratch });

    pTree(h)?.emit(".scratch-x");
    pTree(h)?.emit(join(".scratch-x", "public", "x.txt"));
    expect(h.pendingTimer()).toBe(false);

    pTree(h)?.emit(join("acme", "x.json")); // control: a sibling still schedules
    expect(h.pendingTimer()).toBe(true);
  });

  it("uses real timers by default: a burst of events reloads once after the quiet period", async () => {
    const s = await site();
    let loads = 0;
    const watches: ((relative: string) => void)[] = [];
    const reload = startDevReload({
      scratch: s.scratch,
      port: 4400,
      initial: await loadConfig(s.configPath),
      remoteCache: new Map(),
      debounceMs: 5,
      loadInputs: async () => {
        loads++;
        return { loaded: await loadConfig(s.configPath), fallbackLabel: undefined };
      },
      onBaseChange: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
      watch: (_path, onChange) => {
        watches.push(onChange);
        return { close: () => undefined };
      },
    });

    // No config file here: the watches are the source root, its c/ and its p/ tree.
    watches[2]?.("acme/widget.json");
    watches[2]?.("acme/widget.json");
    await vi.waitFor(() => expect(loads).toBe(1));
    await reload.close();
    expect(loads).toBe(1);
  });
});

describe("a reload swaps in the new state (C-024)", () => {
  it("a nested file edit reaches the served catalog and leaves no staging behind", async () => {
    const s = await site();
    const h = await start(s);
    await writeFile(
      join(s.indexDir, "p", "acme", "widget.json"),
      rootJsonBytes({ name: "ocx.sh/acme/widget", created: "2026-01-01", desc: { title: "Renamed", description: "d", keywords: [] } }),
    );

    await h.reload.reload();

    expect(await catalogJson(s)).toContain("Renamed");
    expect((await readdir(s.scratch)).sort()).toEqual(["public", "readme", "site.json"]);
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toContain('"astro"');
    expect(h.logs).toEqual(["ocx-catalog dev: reloaded (1 packages)"]);
    expect(h.warns).toEqual([]);
  });

  it("a README edit in a path source is served from the live readme dir that site.json points at", async () => {
    const s = await site();
    const fixture = fileURLToPath(new URL("../fixtures/site/index-a", import.meta.url));
    const rootPath = join(s.indexDir, "p", "tools", "modern.json");
    await mkdir(join(s.indexDir, "p", "tools"), { recursive: true });
    await writeFile(
      rootPath,
      (await readFile(join(fixture, "p", "tools", "modern.json"), "utf8")).replace("index-a/tools/modern", "ocx.sh/tools/modern"),
    );
    await cp(join(fixture, "p", "tools", "modern"), join(s.indexDir, "p", "tools", "modern"), { recursive: true });
    const h = await start(s);
    await h.reload.reload();
    expect(h.warns).toEqual([]);
    const readmeOf = async (): Promise<string> => {
      const model = JSON.parse(await readFile(join(s.scratch, "site.json"), "utf8")) as { readme: Record<string, string | null> };
      const file = model.readme["tools/modern"];
      expect(file?.startsWith(join(s.scratch, "readme") + sep)).toBe(true);
      return readFile(file as string, "utf8");
    };
    expect(await readmeOf()).not.toContain("Edited README");

    // A README is content-addressed: an edit is a new file plus a root that points at its digest.
    const edited = utf8("# Edited README\n");
    const hex = sha256Digest(edited).slice("sha256:".length);
    await writeFile(join(s.indexDir, "p", "tools", "modern", "o", "sha256", `${hex}.md`), edited);
    const root = JSON.parse(await readFile(rootPath, "utf8")) as { desc: { readme: string } };
    root.desc.readme = `sha256:${hex}`;
    await writeFile(rootPath, JSON.stringify(root));

    await h.reload.reload();

    expect(h.warns).toEqual([]);
    expect(await readmeOf()).toContain("Edited README");
    await expect(stat(join(s.scratch, "readme", "boot.html"))).rejects.toThrow();
  });

  it("a new package appears", async () => {
    const s = await site();
    const h = await start(s);
    await writeFile(join(s.indexDir, "p", "acme", "gadget.json"), GADGET);

    await h.reload.reload();

    expect(await catalogJson(s)).toContain("gadget");
    expect(h.logs).toEqual(["ocx-catalog dev: reloaded (2 packages)"]);
  });

  it("a removed file disappears from the live public tree and the catalog", async () => {
    const s = await site();
    const h = await start(s);
    await h.reload.reload();
    expect(await catalogJson(s)).toContain("widget");

    await rm(join(s.indexDir, "p", "acme", "widget.json"));
    await h.reload.reload();

    expect(await catalogJson(s)).not.toContain("widget");
    await expect(stat(join(s.scratch, "public", "p", "acme", "widget.json"))).rejects.toThrow();
    // The boot-time marker was replaced with the rest of the old tree.
    await expect(stat(join(s.scratch, "public", "marker.txt"))).rejects.toThrow();
  });

  it("serialises overlapping reloads: a request mid-reload runs exactly one more pass", async () => {
    const s = await site();
    const h = await start(s);

    const first = h.reload.reload();
    const second = h.reload.reload();
    const third = h.reload.reload();
    await Promise.all([first, second, third]);

    expect(h.loads()).toBe(2);
  });
});

describe("a failed reload keeps the last good state (C-024)", () => {
  it("an invalid config prints the error and changes nothing", async () => {
    const s = await site();
    const h = await start(s);
    await h.reload.reload();
    const goodSite = await readFile(join(s.scratch, "site.json"), "utf8");
    const goodCatalog = await catalogJson(s);

    await writeFile(s.configPath, "{ not json");
    await h.reload.reload();

    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toMatch(/^ocx-catalog dev: reload failed, keeping the last good state: /);
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toBe(goodSite);
    expect(await catalogJson(s)).toBe(goodCatalog);

    // Fixing the file recovers without a restart.
    await writeConfig(s.configPath);
    await h.reload.reload();
    expect(h.logs.at(-1)).toBe("ocx-catalog dev: reloaded (1 packages)");
  });

  it("a source that no longer reads (malformed root) fails before anything is staged", async () => {
    const s = await site();
    const h = await start(s);
    await writeFile(join(s.indexDir, "p", "acme", "widget.json"), "{ not json");

    await h.reload.reload();

    expect(h.warns[0]).toContain("widget.json");
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toBe("boot");
    expect(await readFile(join(s.scratch, "public", "marker.txt"), "utf8")).toBe("boot");
    expect(await readdir(s.scratch)).not.toContain("next");
  });

  it("a swap that fails halfway restores the previous public tree and leaves no staging", async () => {
    const s = await site();
    let calls = 0;
    const h = await start(s, {
      // 1: public -> public.prev, 2: next/public -> public (fails), 3: rollback
      rename: (from, to) => {
        calls++;
        if (calls === 2) return Promise.reject(new Error("EXDEV: cross-device link"));
        return rename(from, to);
      },
    });

    await h.reload.reload();

    expect(h.warns[0]).toContain("EXDEV: cross-device link");
    expect(await readFile(join(s.scratch, "public", "marker.txt"), "utf8")).toBe("boot");
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toBe("boot");
    expect(await readFile(join(s.scratch, "readme", "boot.html"), "utf8")).toBe("boot");
    expect((await readdir(s.scratch)).sort()).toEqual(["public", "readme", "site.json"]);
  });
});

describe("base change (C-024)", () => {
  it("is reported to the supervisor after the new state is in place", async () => {
    const s = await site();
    const h = await start(s);
    await writeConfig(s.configPath, { base: "/catalog/" });

    await h.reload.reload();

    expect(h.baseChanges).toEqual(["/catalog/"]);
    expect(JSON.parse(await readFile(join(s.scratch, "site.json"), "utf8")).astro.base).toBe("/catalog/");
    expect(h.logs).toContain("ocx-catalog dev: base is now /catalog/, restarting the server");
  });

  it("is not reported when the base is unchanged", async () => {
    const s = await site();
    const h = await start(s);

    await h.reload.reload();

    expect(h.baseChanges).toEqual([]);
  });
});

describe("watcher upkeep", () => {
  it("opens watchers for a source added by an edit and closes those of a source removed", async () => {
    const s = await site();
    const second = join(s.dir, "second");
    await mkdir(join(second, "p"), { recursive: true });
    await writeFile(join(second, "config.json"), JSON.stringify({ format_version: 1 }));
    const h = await start(s);
    expect(h.watches.map((watch) => watch.path)).toEqual([s.dir, s.indexDir, join(s.indexDir, "c"), join(s.indexDir, "p")]);

    await writeConfig(s.configPath, {
      sources: [
        { path: "./index", root: true, label: "ocx.sh" },
        { path: "./second", label: "second" },
      ],
    });
    await h.reload.reload();
    expect(h.watches.slice(4).map((watch) => watch.path)).toEqual([second, join(second, "c"), join(second, "p")]);

    await writeConfig(s.configPath);
    await h.reload.reload();
    expect(h.watches.slice(4).every((watch) => watch.closed)).toBe(true);
    expect(h.watches.slice(0, 4).some((watch) => watch.closed)).toBe(false);
  });

  it("watches a single file through its directory and reacts to its name only, so an atomic rename-replace still reloads", async () => {
    const s = await site();
    const h = await start(s);
    const dirWatch = h.watches[0];
    expect(dirWatch).toMatchObject({ path: s.dir, recursive: false });

    dirWatch?.emit("catalog.config.json.swp");
    dirWatch?.emit("unrelated.txt");
    expect(h.pendingTimer()).toBe(false);

    // What an editor's save-by-rename reports: the entry's name, in the directory.
    dirWatch?.emit("catalog.config.json");
    expect(h.pendingTimer()).toBe(true);
  });

  it("a source root watch reacts to config.json, c and p only, and to an event with no name", async () => {
    const s = await site();
    const h = await start(s);
    const rootWatch = h.watches.find((watch) => watch.path === s.indexDir);

    rootWatch?.emit("README.md");
    rootWatch?.emit("node_modules");
    expect(h.pendingTimer()).toBe(false);

    rootWatch?.emit("p");
    expect(h.pendingTimer()).toBe(true);
    h.fireTimer();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));

    rootWatch?.emit("config.json");
    expect(h.pendingTimer()).toBe(true);
    h.fireTimer();
    await vi.waitFor(() => expect(h.logs).toHaveLength(2));

    rootWatch?.emit("");
    expect(h.pendingTimer()).toBe(true);
  });

  it("skips c/ and p/ silently while they do not exist, and watches them once a reload finds them", async () => {
    const s = await site();
    const missing = new Set([join(s.indexDir, "c"), join(s.indexDir, "p")]);
    const opened: string[] = [];
    const h = await start(s, {
      watch: (path) => {
        if (missing.has(path)) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${path}'`), { code: "ENOENT" });
        opened.push(path);
        return { close: () => undefined };
      },
    });
    expect(h.warns).toEqual([]);
    expect(opened).toEqual([s.dir, s.indexDir]);

    missing.clear();
    await h.reload.reload();

    expect(opened).toEqual([s.dir, s.indexDir, join(s.indexDir, "c"), join(s.indexDir, "p")]);
  });

  it("arms a c/ or p/ created since the last reload before the reload reads, so a failed reload still arms it", async () => {
    const s = await site();
    const missing = new Set([join(s.indexDir, "c"), join(s.indexDir, "p")]);
    const opened: string[] = [];
    const h = await start(s, {
      watch: (path) => {
        if (missing.has(path)) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${path}'`), { code: "ENOENT" });
        opened.push(path);
        return { close: () => undefined };
      },
    });
    missing.clear();
    await writeFile(s.configPath, "{ not json");

    await h.reload.reload();

    expect(h.warns[0]).toContain("reload failed");
    expect(opened).toEqual([s.dir, s.indexDir, join(s.indexDir, "c"), join(s.indexDir, "p")]);
  });

  it("a reload requested after close arms nothing", async () => {
    const s = await site();
    const missing = new Set([join(s.indexDir, "p")]);
    const opened: string[] = [];
    const h = await start(s, {
      watch: (path) => {
        if (missing.has(path)) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${path}'`), { code: "ENOENT" });
        opened.push(path);
        return { close: () => undefined };
      },
    });
    await h.reload.close();
    missing.clear();

    await h.reload.reload();

    expect(opened).not.toContain(join(s.indexDir, "p"));
  });

  it("a p/ replaced under the source root (a checkout) drops its dead watch and re-arms a fresh one on the reload", async () => {
    const s = await site();
    const h = await start(s);
    const rootWatch = h.watches.find((watch) => watch.path === s.indexDir);
    const pBefore = pTree(h);
    expect(pBefore?.closed).toBe(false);

    rootWatch?.emit("p");

    expect(pBefore?.closed).toBe(true);
    h.fireTimer();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    const pAfter = h.watches.filter((watch) => watch.recursive && watch.path.endsWith(`${sep}p`));
    expect(pAfter).toHaveLength(2);
    expect(pAfter[1]?.closed).toBe(false);
    expect(h.watches.find((watch) => watch.path === s.indexDir)?.closed).toBe(false);
  });

  it("reports a path that cannot be watched and keeps running", async () => {
    const s = await site();
    const h = await start(s, {
      watch: (path) => {
        throw new Error(`ENOENT: no such file or directory, watch '${path}'`);
      },
    });

    // The config dir and the source root are required; c/ and p/ are optional only for ENOENT with a code.
    expect(h.warns).toHaveLength(4);
    expect(h.warns[0]).toBe(`ocx-catalog dev: cannot watch ${s.dir}: ENOENT: no such file or directory, watch '${s.dir}'`);
  });

  it("reports a watcher that fails later", async () => {
    const s = await site();
    const h = await start(s);

    h.watches[1]?.fail(new Error("EMFILE: too many open files"));

    expect(h.warns).toEqual([`ocx-catalog dev: watching ${s.indexDir} failed: EMFILE: too many open files`]);
  });

  it("close stops every watcher, cancels the pending debounce and waits for a running reload", async () => {
    const s = await site();
    const h = await start(s);
    pTree(h)?.emit("x.json");
    expect(h.pendingTimer()).toBe(true);
    const running = h.reload.reload();

    await h.reload.close();

    expect(h.pendingTimer()).toBe(false);
    expect(h.watches.every((watch) => watch.closed)).toBe(true);
    // The reload that was running finished before close resolved.
    expect(h.loads()).toBe(1);
    await running;
    // Events after close schedule nothing.
    pTree(h)?.emit("y.json");
    expect(h.pendingTimer()).toBe(false);
  });

  it("close with nothing pending or running resolves", async () => {
    const s = await site();
    const h = await start(s);

    await expect(h.reload.close()).resolves.toBeUndefined();
  });
});

describe("docs content config", () => {
  it("is written when a reload introduces a docs directory, and not rewritten when it is unchanged", async () => {
    const s = await site();
    await mkdir(join(s.dir, "docs"), { recursive: true });
    await writeFile(join(s.dir, "docs", "guide.md"), "# Guide\n");
    const h = await start(s);
    const contentConfig = join(s.scratch, "src", "content.config.ts");

    await writeConfig(s.configPath, { docs: "docs" });
    await h.reload.reload();
    expect(await readFile(contentConfig, "utf8")).toContain("docs");
    expect(h.warns).toEqual([]);

    await rm(contentConfig);
    await writeFile(join(s.dir, "docs", "guide.md"), "# Guide, edited\n");
    await h.reload.reload();
    await expect(stat(contentConfig)).rejects.toThrow();
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toContain("guide");
  });
});

describe("docs content config is part of the transactional swap", () => {
  it("a swap that fails after the content config was staged leaves the previous content config in place", async () => {
    const s = await site();
    await mkdir(join(s.dir, "docs"), { recursive: true });
    await writeFile(join(s.dir, "docs", "guide.md"), "# Guide\n");
    await mkdir(join(s.scratch, "src"), { recursive: true });
    await writeFile(join(s.scratch, "src", "content.config.ts"), "previous");
    const h = await start(s, {
      // Fails the move of the staged src/ into place, after public/ and readme/ were already swapped.
      rename: (from, to) =>
        String(from).endsWith(join("next", "src")) ? Promise.reject(new Error("EXDEV: cross-device link")) : rename(from, to),
    });

    await writeConfig(s.configPath, { docs: "docs" });
    await h.reload.reload();

    expect(h.warns[0]).toContain("EXDEV: cross-device link");
    expect(await readFile(join(s.scratch, "src", "content.config.ts"), "utf8")).toBe("previous");
    expect(await readFile(join(s.scratch, "public", "marker.txt"), "utf8")).toBe("boot");
    expect(await readFile(join(s.scratch, "site.json"), "utf8")).toBe("boot");
    expect((await readdir(s.scratch)).sort()).toEqual(["public", "readme", "site.json", "src"]);
  });

  it("a swap that fails when no content config existed leaves none behind", async () => {
    const s = await site();
    await mkdir(join(s.dir, "docs"), { recursive: true });
    await writeFile(join(s.dir, "docs", "guide.md"), "# Guide\n");
    const h = await start(s, {
      rename: (from, to) =>
        String(from).endsWith(join("next", "src")) ? Promise.reject(new Error("EXDEV: cross-device link")) : rename(from, to),
    });

    await writeConfig(s.configPath, { docs: "docs" });
    await h.reload.reload();

    expect(h.warns[0]).toContain("EXDEV: cross-device link");
    expect((await readdir(s.scratch)).sort()).toEqual(["public", "readme", "site.json"]);
  });

  it("a changed docs directory replaces the previous content config", async () => {
    const s = await site();
    await mkdir(join(s.dir, "docs"), { recursive: true });
    await mkdir(join(s.dir, "docs2"), { recursive: true });
    await writeFile(join(s.dir, "docs", "guide.md"), "# Guide\n");
    await writeFile(join(s.dir, "docs2", "guide.md"), "# Guide\n");
    await writeConfig(s.configPath, { docs: "docs" });
    const h = await start(s);
    await h.reload.reload();
    await writeConfig(s.configPath, { docs: "docs2" });

    await h.reload.reload();

    expect(h.warns).toEqual([]);
    expect(await readFile(join(s.scratch, "src", "content.config.ts"), "utf8")).toContain("docs2");
    expect((await readdir(s.scratch)).sort()).toEqual(["public", "readme", "site.json", "src"]);
  });
});

describe("url/git sources are read once per entry (C-024)", () => {
  it("a reload hits the remote cache; an edited entry misses it", async () => {
    let requests = 0;
    const files: Record<string, Uint8Array> = {
      "config.json": utf8(JSON.stringify({ format_version: 1 })),
      "c/index.json": utf8(JSON.stringify({ format_version: 1, packages: { "acme/widget": sha256Digest(WIDGET) } })),
      "p/acme/widget.json": WIDGET,
    };
    const server = createServer((req, res) => {
      requests++;
      const body = files[(req.url ?? "/").replace(/^\//, "")];
      res.statusCode = body === undefined ? 404 : 200;
      res.end(body === undefined ? undefined : Buffer.from(body));
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cleanup.push(join(await cacheBaseDir(), "url", createHash("sha256").update(url).digest("hex").slice(0, 16)));
    try {
      const dir = await tempDir("catalog-reload-url-");
      const scratch = join(dir, "scratch");
      await mkdir(join(scratch, "public"), { recursive: true });
      await mkdir(join(scratch, "readme"), { recursive: true });
      const loadedWith = (entryExtra: Record<string, unknown>): LoadedConfig => {
        const entry = { url, label: "ocx.sh", ...entryExtra };
        return { config: { sources: [entry], brand: { title: "T" }, base: "/" }, configDir: dir, sources: [{ entry, label: "ocx.sh" }] };
      };
      let current = loadedWith({});
      const remoteCache: RemoteCache = new Map();
      // What dev.ts does at boot: the first resolve fills the cache.
      await resolveCatalog(current.sources, dir, undefined, await reservedNamesFor(current), remoteCache);
      const afterBoot = requests;
      expect(afterBoot).toBeGreaterThan(0);
      const warns: string[] = [];
      const reload = startDevReload({
        scratch,
        port: 4400,
        initial: current,
        remoteCache,
        loadInputs: async () => ({ loaded: current, fallbackLabel: undefined }),
        onBaseChange: async () => undefined,
        log: () => undefined,
        warn: (line) => warns.push(line),
        watch: () => ({ close: () => undefined }),
      });

      await reload.reload();
      expect(warns).toEqual([]);
      expect(requests).toBe(afterBoot); // hit

      current = loadedWith({ excludeFromAll: true });
      await reload.reload();
      expect(warns).toEqual([]);
      expect(requests).toBeGreaterThan(afterBoot); // miss: the entry changed
    } finally {
      server.closeAllConnections();
      await new Promise((closed) => server.close(closed));
    }
  }, 30_000);
});

describe("default watcher and timers", () => {
  it("a file written into a watched source directory reloads the site, end to end", async () => {
    const s = await site();
    const warns: string[] = [];
    const reload = startDevReload({
      scratch: s.scratch,
      port: 4400,
      initial: await loadConfig(s.configPath),
      remoteCache: new Map(),
      debounceMs: 20,
      loadInputs: async () => ({ loaded: await loadConfig(s.configPath), fallbackLabel: undefined }),
      onBaseChange: async () => undefined,
      log: () => undefined,
      warn: (line) => warns.push(line),
    });
    try {
      await writeFile(join(s.indexDir, "p", "acme", "gadget.json"), GADGET);
      await vi.waitFor(async () => expect(await catalogJson(s)).toContain("gadget"), { timeout: 5_000 });
      expect(warns).toEqual([]);
    } finally {
      await reload.close();
    }
  });
});

describe("default watcher on a single file", () => {
  it("an atomic rename-replace of the config file (an editor save) still reloads, twice in a row", async () => {
    const s = await site();
    let loads = 0;
    const reload = startDevReload({
      scratch: s.scratch,
      port: 4400,
      initial: await loadConfig(s.configPath),
      configFile: s.configPath,
      remoteCache: new Map(),
      debounceMs: 20,
      loadInputs: async () => {
        loads++;
        return { loaded: await loadConfig(s.configPath), fallbackLabel: undefined };
      },
      onBaseChange: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    });
    try {
      for (let save = 0; save < 2; save++) {
        const before = loads;
        await writeConfig(`${s.configPath}.tmp`);
        await rename(`${s.configPath}.tmp`, s.configPath);
        await vi.waitFor(() => expect(loads).toBeGreaterThan(before), { timeout: 5_000 });
      }
    } finally {
      await reload.close();
    }
  });
});

describe("realWatch", () => {
  it("reports a nested file written under the watched directory, relative to it", async () => {
    const dir = await tempDir("catalog-watch-");
    await mkdir(join(dir, "p", "acme"), { recursive: true });
    const seen: string[] = [];
    const watcher = realWatch(dir, (relative) => seen.push(relative), () => undefined, { recursive: true });
    try {
      await writeFile(join(dir, "p", "acme", "widget.json"), "{}");
      await vi.waitFor(() => expect(seen.some((relative) => relative.endsWith("widget.json"))).toBe(true));
      expect(seen.find((relative) => relative.endsWith("widget.json"))).toBe(join("p", "acme", "widget.json"));
    } finally {
      watcher.close();
    }
  });

  it("forwards watcher errors and treats a missing filename as the root", async () => {
    const dir = await tempDir("catalog-watch-");
    const seen: string[] = [];
    const errors: Error[] = [];
    const watcher = realWatch(dir, (relative) => seen.push(relative), (err) => errors.push(err), { recursive: true });
    try {
      (watcher as FSWatcher).emit("change", "change", null);
      (watcher as FSWatcher).emit("error", new Error("boom"));
      expect(seen).toEqual([""]);
      expect(errors.map((err) => err.message)).toEqual(["boom"]);
    } finally {
      watcher.close();
    }
  });

  it("throws for a path that does not exist (the caller reports it)", () => {
    expect(() =>
      realWatch(join(tmpdir(), "catalog-watch-missing-xyz"), () => undefined, () => undefined, { recursive: true }),
    ).toThrow(/ENOENT/);
  });

  it("non-recursive: reports an entry of the directory by name and nothing below it", async () => {
    const dir = await tempDir("catalog-watch-");
    await mkdir(join(dir, "p"), { recursive: true });
    const seen: string[] = [];
    const watcher = realWatch(dir, (relative) => seen.push(relative), () => undefined, { recursive: false });
    try {
      await writeFile(join(dir, "p", "deep.json"), "{}");
      await writeFile(join(dir, "config.json"), "{}");
      await vi.waitFor(() => expect(seen).toContain("config.json"));
      expect(seen.some((relative) => relative.includes("deep.json"))).toBe(false);
    } finally {
      watcher.close();
    }
  });
});
