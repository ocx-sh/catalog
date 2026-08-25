/**
 * The forked child entry `dev.ts`'s `devServer()` spawns — the only place
 * `vitepress`'s `createServer()` ever runs (see `dev.ts`'s "Child-process
 * design" doc). Runs as a real, separate `node` process (never imported
 * in-process by anything, `dev.ts` included — only ever `fork()`-ed against
 * its compiled `dist/build/dev_worker.js`), so it's excluded from this
 * package's coverage instrumentation (`vitest.config.ts`, alongside
 * `src/cli/index.ts` for the identical reason: v8 coverage only observes
 * code loaded inside the instrumented vitest process, never a genuinely
 * separate OS process). `test/build/dev.test.ts`'s real, black-box
 * `devServer()` calls are this module's functional test coverage instead.
 *
 * Talks to the parent purely over IPC (`dev_worker_protocol.ts`'s shapes) —
 * boots on the single expected `{ type: "boot" }` message, reports
 * `ready`/`error`, then waits for `{ type: "shutdown" }` to tear down.
 */
import { join, resolve } from "node:path";
import { createServer } from "vitepress";
import { ConfigError } from "../config/errors.js";
import { loadConfig } from "../config/load.js";
import type { Brand, NavEntry, ResolvedSource } from "../config/types.js";
import { generateConfig } from "./config_gen.js";
import type { ParentToWorkerMessage, WorkerToParentMessage } from "./dev_worker_protocol.js";
import { synthesizePages } from "./pages.js";
import { createScratchRoot, type ScratchRoot } from "./scratch.js";
import { emitCatalogTree, resolveCatalog } from "./sources_pipeline.js";

const SRC_DIR = "src";

/** The label the `--source` sugar path falls back to for its one implicit
 * source, and ONLY when there is nothing to derive one from: `labels.ts`
 * rejects a source with no explicit label and no package roots, so an ad-hoc
 * `ocx-catalog dev --source <dir>` against an index that is still empty (or
 * mid-edit) would otherwise fail to boot rather than serving an empty
 * catalog. Same class of default as the generic `brand.title` below — there
 * is no config file to read a real one from.
 *
 * Passed as `resolveCatalog`'s `fallbackLabel`, never as an explicit
 * `label`. It used to be the latter, which meant a real index served through
 * this path was silently renamed to "local" — and, once a label had to agree
 * with the index's own name (`LABEL_PREFIX_MISMATCH`), refused to boot at
 * all. A populated index derives its real name here; only an empty one is
 * "local". */
const IMPLICIT_SOURCE_LABEL = "local";

interface DevInputs {
  /** Only the `--source` sugar path sets this — see IMPLICIT_SOURCE_LABEL. */
  readonly fallbackLabel: string | undefined;
  readonly brand: Brand;
  readonly nav: NavEntry[];
  readonly css: string | undefined;
  readonly siteUrl: string | undefined;
  readonly description: string | undefined;
  readonly favicon: string | undefined;
  readonly docsSourceDir: string | undefined;
  /** The sources to render, and the directory their `path` entries resolve
   * against — `configDir` for a real config, the `--source` directory
   * itself for the sugar path (whose implicit entry is therefore `"."`,
   * keeping `path.ts`'s containment check meaningful instead of asking it
   * to contain an arbitrary absolute path in an unrelated base). */
  readonly sources: readonly ResolvedSource[];
  readonly configDir: string;
}

/** Resolves everything `generateConfig()`/`synthesizePages()`/
 * `resolveCatalog()` need, per `dev.ts`'s "--source vs --config" doc: a real
 * `catalog.config.json` when `configPath` is given (same fields
 * `engine.ts`'s `buildCatalog` forwards — `css`/`docs` resolved against
 * `configDir`, same as there), or a single implicit `root: true` source for
 * the `sourcePath` sugar path (no theme customization available — there's no
 * config file to read it from). */
async function resolveDevInputs(configPath: string | undefined, sourcePath: string | undefined): Promise<DevInputs> {
  if (configPath === undefined) {
    return {
      fallbackLabel: IMPLICIT_SOURCE_LABEL,
      brand: { title: "OCX Catalog" },
      nav: [],
      css: undefined,
      siteUrl: undefined,
      description: undefined,
      favicon: undefined,
      docsSourceDir: undefined,
      sources: [{ entry: { path: ".", root: true }, label: null }],
      configDir: resolve(sourcePath ?? "."),
    };
  }
  const loaded = await loadConfig(configPath);
  return {
    fallbackLabel: undefined,
    brand: loaded.config.brand,
    nav: loaded.config.nav ?? [],
    css: loaded.config.css !== undefined ? join(loaded.configDir, loaded.config.css) : undefined,
    siteUrl: loaded.config.siteUrl,
    description: loaded.config.description,
    favicon: loaded.config.favicon,
    docsSourceDir: loaded.config.docs !== undefined ? join(loaded.configDir, loaded.config.docs) : undefined,
    sources: loaded.sources,
    configDir: loaded.configDir,
  };
}

interface Booted {
  readonly scratchRoot: ScratchRoot;
  readonly server: Awaited<ReturnType<typeof createServer>>;
}

async function boot(
  configPath: string | undefined,
  sourcePath: string | undefined,
  port: number | undefined,
): Promise<Booted> {
  const { brand, nav, css, siteUrl, description, favicon, docsSourceDir, sources, configDir, fallbackLabel } =
    await resolveDevInputs(configPath, sourcePath);
  const catalog = await resolveCatalog(sources, configDir, fallbackLabel);
  const scratchRoot = await createScratchRoot();
  await synthesizePages({ scratchRoot: scratchRoot.path, srcDir: SRC_DIR, packages: catalog.routes, docsSourceDir });
  // Live wire data (S-003): the same mirror tree + merged catalog `build`
  // writes to `dist/`, written instead into the scratch root's `public/` —
  // VitePress's own default `publicDir` (`pages.ts`), so Vite serves
  // `/p/**`, `/index/<label>/**` and `/data/catalog/catalog.json` straight
  // from disk with no build step. After `synthesizePages` on purpose: it is
  // what creates/populates that directory, and the generated catalog must
  // be the last writer on its own path (`sources_pipeline.ts`'s doc).
  await emitCatalogTree(catalog, join(scratchRoot.path, SRC_DIR, "public"));
  await generateConfig({
    scratchRoot: scratchRoot.path,
    srcDir: SRC_DIR,
    brand,
    // Same resolution `engine.ts` does — `brand.logo` is config-relative, and
    // `generateConfig` needs the real file to copy into the public mount.
    brandLogoSource: brand.logo !== undefined ? join(configDir, brand.logo) : undefined,
    nav,
    css,
    siteUrl,
    description,
    favicon,
    descLookup: catalog.descLookup,
  });
  // host pinned to IPv4 loopback: Vite's default (`localhost`) binds whichever
  // address family the machine's resolver returns first, so "port already in
  // use" (S-003, exit UNAVAILABLE) would depend on which loopback family a
  // conflicting listener happens to hold — deterministic bind, deterministic
  // error semantics.
  const server = await createServer(scratchRoot.path, {
    host: "127.0.0.1",
    port,
    strictPort: port !== undefined,
  });
  await server.listen();
  return { scratchRoot, server };
}

function boundPort(server: Booted["server"]): number | undefined {
  const address = server.httpServer?.address();
  return address !== null && address !== undefined && typeof address !== "string" ? address.port : undefined;
}

/** Sends a message to the parent, then exits — used for every BOOT-FAILURE
 * path. Without the exit, this process (and its scratch root, already
 * disposed by the caller before calling this) lives forever: the parent's
 * `devServer()` has already rejected and returned by the time this runs,
 * nothing else ever kills this child, and `scratch.ts`'s own exit-hook
 * backstop can only run once the process actually exits. Waits for
 * `process.send`'s own callback before exiting (not exiting synchronously
 * right after) — calling `process.exit()` immediately after `process.send()`
 * can drop the message before Node finishes writing it to the IPC pipe. */
function sendAndExit(message: WorkerToParentMessage): void {
  if (process.send) {
    process.send(message, () => process.exit(1));
  } else {
    process.exit(1);
  }
}

let booted: Booted | undefined;

process.on("message", async (message: ParentToWorkerMessage) => {
  if (message.type === "boot") {
    try {
      booted = await boot(message.configPath, message.sourcePath, message.port);
      const port = boundPort(booted.server);
      if (port === undefined) {
        await booted.server.close();
        await booted.scratchRoot.dispose();
        sendAndExit({ type: "error", message: "dev server started but has no bound TCP port" });
        return;
      }
      process.send?.({ type: "ready", port });
    } catch (err) {
      sendAndExit({
        type: "error",
        message: (err as Error).message,
        configErrorCode: err instanceof ConfigError ? err.code : undefined,
      });
    }
    return;
  }
  // message.type === "shutdown"
  if (booted !== undefined) {
    await booted.server.close();
    try {
      await booted.scratchRoot.dispose();
    } catch (err) {
      // This listener is `async`, so a rejection here becomes an unhandled
      // rejection and Node turns that into a raw uncaught-exception dump —
      // which is what a user saw on Ctrl-C instead of a clean shutdown.
      // `scratch.ts` already retries the ENOTEMPTY race that caused it; if
      // cleanup still fails, say so in one line and exit non-zero rather than
      // pretending it succeeded. The module-level exit hook is the backstop.
      process.stderr.write(
        `ocx-catalog dev: could not remove the scratch directory ${booted.scratchRoot.path}: ` +
          `${(err as Error).message}\n`,
      );
      process.exit(1);
    }
  }
  process.exit(0);
});
