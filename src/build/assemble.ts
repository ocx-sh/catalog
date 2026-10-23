/**
 * Scratch `public/` assembly and `site.json` (ADR D2 "Data handoff", C-004,
 * C-047). Both run inside the Astro render's scratch root: `public/` becomes
 * the staged `outDir`'s static layer, `site.json` the pages' only data input.
 */
import { type Stats } from "node:fs";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LoadedConfig } from "../config/types.js";
import type { SiteInput } from "../site/astro_config.js";
import type { SiteModel } from "../site/model/index.js";
import { BuildError } from "./errors.js";
import { emitCatalogTree, type ResolvedCatalog } from "./sources_pipeline.js";

export interface AssembleInput {
  readonly scratch: string;
  readonly loaded: LoadedConfig;
  readonly catalog: ResolvedCatalog;
  readonly base: string;
}

/** `stat`, or `undefined` for a path that is not there; any other failure is real. */
async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

const exists = async (path: string): Promise<boolean> => (await statIfPresent(path)) !== undefined;

/**
 * Copies `brand.logo` to `<publicDir>/<basename>` (the chrome links it as `/<basename>`; the
 * basename collapses any directory part so the target cannot leave publicDir). A file that already
 * IS the `consumerPublic` file at that path (a logo kept inside `publicDir`) is already in place.
 * Any other file there is refused rather than replaced.
 */
async function copyBasenamed(
  key: string,
  configDir: string,
  configPath: string,
  publicDir: string,
  consumerPublic: string | undefined,
): Promise<void> {
  const target = join(publicDir, basename(configPath));
  if (await exists(target)) {
    const source = resolve(configDir, configPath);
    if (consumerPublic !== undefined && source === resolve(configDir, consumerPublic, basename(configPath))) return;
    throw new BuildError(
      "DATA",
      `${key} "${configPath}" would be copied to /${basename(configPath)}, which publicDir already provides: rename one of them, or move one out of publicDir`,
    );
  }
  await cp(join(configDir, configPath), target);
}

/**
 * Builds `<scratch>/public/`: consumer `publicDir` first, `brand.logo`, the ocx chrome's `favicon.svg` (the
 * theme's logo, unless the consumer ships one), the default `robots.txt` (`wx`, a consumer file wins), then
 * `emitCatalogTree(catalog, publicDir, base)` last so the wire mirror,
 * `_headers` and the merged `catalog.json` are never shadowed by a consumer
 * file. Returns the `public/` path.
 */
export async function assemblePublic(input: AssembleInput): Promise<string> {
  const { scratch, loaded, catalog, base } = input;
  const { config, configDir } = loaded;
  const publicDir = join(scratch, "public");
  await mkdir(publicDir, { recursive: true });

  if (config.publicDir !== undefined) {
    await cp(join(configDir, config.publicDir), publicDir, { recursive: true });
  }
  if (config.brand?.logo !== undefined) {
    await copyBasenamed("brand.logo", configDir, config.brand.logo, publicDir, config.publicDir);
  }
  // `css` is not copied: Vite bundles it from its own location (`integration.ts`), so its relative
  // `@import`/`url()` resolve. A missing file or a directory fails here, with a name, not deep inside the bundler.
  if (config.css !== undefined) {
    const info = await statIfPresent(join(configDir, config.css));
    if (info === undefined) throw new BuildError("DATA", `css "${config.css}" does not exist`);
    if (!info.isFile()) throw new BuildError("DATA", `css "${config.css}" is not a regular file`);
  }
  if (config.chrome === "ocx" && !(await exists(join(publicDir, "favicon.svg")))) {
    // The theme Shell links `<base>favicon.svg` and ships no such file; copy the theme's exported logo.
    await cp(createRequire(import.meta.url).resolve("@ocx-sh/theme/logo.svg"), join(publicDir, "favicon.svg"));
  }
  if (config.siteUrl !== undefined) {
    const sitemap = new URL(`${base}sitemap-index.xml`, config.siteUrl).href;
    try {
      await writeFile(join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  await emitCatalogTree(catalog, publicDir, base);
  return publicDir;
}

/** Keys that would mean a README body, a wire root or an image index leaked into the model. */
const FORBIDDEN_KEYS = new Set(["readme", "readmeBody", "root", "wireRoot", "manifests", "imageIndex"]);
/** Directory under the scratch root holding each route's sanitised README HTML (`readmes.ts`). */
export const README_DIR = "readme";

function assertSlim(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSlim(item, `${path}[${i}]`));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`site.json: ${path}.${key} must not carry wire data (C-047)`);
      assertSlim(child, `${path}.${key}`);
    }
  }
}

/** The consumer stylesheet and the directory (the config's) every file of its `@import`/`url()` graph must stay inside. */
export interface ConsumerCss {
  readonly file: string;
  readonly root: string;
}

/**
 * Writes `<scratch>/site.json` — the one file both Astro-side readers consume:
 * the model (served to the pages as `virtual:ocx-catalog/site`) plus the
 * `astro` key, the `SiteInput` the generated `astro.config.mjs` feeds
 * `astroConfig`, and `consumerCss`/`consumerRoot`, the absolute path of the consumer stylesheet the
 * integration hands to Vite to bundle and the directory its graph must stay inside (only when `css` is set). Asserts the model's shape: route keys and small views only —
 * no README body, wire root or image index (C-047): `model.readme` holds the
 * path of each route's rendered file (`renderReadmes`), not its content.
 * Returns the written path.
 */
export async function writeSiteJson(
  scratch: string,
  model: SiteModel,
  astro: SiteInput,
  consumer?: ConsumerCss,
): Promise<string> {
  const { readme, details, ...rest } = model;
  // A README is referenced by the path of its rendered file, never inlined. The
  // path is where the file will be LIVE (`sitePath`'s scratch root), which is
  // not `scratch` while a `dev` reload stages beside the live tree.
  const readmeRoot = join(dirname(astro.sitePath), README_DIR) + sep;
  for (const [key, file] of Object.entries(readme)) {
    // Segments of the path below the README root, not the whole path: a project directory may itself be named `my..proj`.
    if (file !== null && !(isAbsolute(file) && file.startsWith(readmeRoot) && !relative(readmeRoot, file).split(sep).includes(".."))) {
      throw new Error(`site.json: readme of ${key} is not a rendered README file under ${readmeRoot} (C-047)`);
    }
  }
  assertSlim({ details, ...rest }, "site");
  const path = join(scratch, "site.json");
  await writeFile(path, JSON.stringify({ ...model, astro, ...(consumer === undefined ? {} : { consumerCss: consumer.file, consumerRoot: consumer.root }) }), "utf8");
  return path;
}
