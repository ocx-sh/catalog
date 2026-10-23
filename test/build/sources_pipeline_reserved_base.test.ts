/**
 * P-base B.3 through the pipeline entrypoints: reserved names (C-027, S-003)
 * reach `resolveCatalog` via `reservedNamesFor`, and `emitCatalogTree` is
 * base-independent for the data it writes (C-006, C-008, C-039). The unit
 * tests of `reservedNames`/`renderHeaders` stay green with these call sites
 * deleted; this file is what fails instead.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError } from "../../src/build/errors.js";
import { emitCatalogTree, reservedNamesFor, resolveCatalog } from "../../src/build/sources_pipeline.js";
import type { LoadedConfig, ResolvedSource } from "../../src/config/types.js";
import { rootJsonBytes, sha256Digest, utf8 } from "../sources/helpers.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-pipeline-base-"));
  cleanupDirs.push(dir);
  return dir;
}

async function writeTree(root: string, files: Readonly<Record<string, Uint8Array>>): Promise<void> {
  for (const [relPath, bytes] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
}

const CONFIG_JSON = utf8(JSON.stringify({ format_version: 1 }));
const LOGO = utf8("<svg xmlns='http://www.w3.org/2000/svg'/>");
const LOGO_DIGEST = sha256Digest(LOGO);
const LOGO_HEX = LOGO_DIGEST.slice("sha256:".length);

/** One package with a logo, so the catalog carries a non-null `logoUrl`. */
function treeFor(name: string): Readonly<Record<string, Uint8Array>> {
  const wirePath = name.split("/").slice(1).join("/");
  return {
    "config.json": CONFIG_JSON,
    [`p/${wirePath}.json`]: rootJsonBytes({
      name,
      created: "2026-01-01",
      desc: { title: "Thing", description: "A thing.", keywords: [], logo: LOGO_DIGEST },
    }),
    [`p/${wirePath}/o/sha256/${LOGO_HEX}.svg`]: LOGO,
  };
}

function pathSource(entryPath: string, root = false): ResolvedSource {
  return { entry: { path: entryPath, ...(root ? { root: true } : {}) }, label: null };
}

function loadedConfig(configDir: string, extra: Partial<LoadedConfig["config"]> = {}): LoadedConfig {
  return {
    config: { sources: [], base: "/", brand: { title: "Catalog" }, ...extra },
    configDir,
    sources: [],
  };
}

describe("reservedNamesFor (C-027)", () => {
  it("reserves the static list and the brand.logo file name without a publicDir", async () => {
    const dir = await tempDir();
    const isReserved = await reservedNamesFor(loadedConfig(dir, { brand: { title: "C", logo: "img/Mark.svg" } }));
    expect(isReserved("docs")).toBe(true);
    expect(isReserved("mark.svg")).toBe(true);
    expect(isReserved("acme")).toBe(false);
  });

  it("reserves every top-level publicDir entry", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "public"), { "humans.txt": utf8("x"), "Fonts/a.woff2": utf8("x") });
    const isReserved = await reservedNamesFor(loadedConfig(dir, { publicDir: "public" }));
    expect(isReserved("humans.txt")).toBe(true);
    expect(isReserved("fonts")).toBe(true);
    expect(isReserved("a.woff2")).toBe(false);
  });

  it("reports an unreadable publicDir as a DATA build error", async () => {
    const dir = await tempDir();
    const error = await reservedNamesFor(loadedConfig(dir, { publicDir: "missing" })).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(BuildError);
    expect(error).toMatchObject({ code: "DATA", message: expect.stringContaining('publicDir "missing"') });
  });
});

describe("resolveCatalog applies the reserved names (C-027, S-003)", () => {
  it("rejects a root-source namespace the build owns, by default", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "root"), treeFor("ocx.sh/docs/tool"));
    await expect(resolveCatalog([pathSource("root", true)], dir)).rejects.toMatchObject({
      code: "DATA",
      message: expect.stringContaining('root source publishes namespace "docs"'),
    });
  });

  it("rejects a root-source namespace equal to a publicDir entry, case-insensitively", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "root"), treeFor("ocx.sh/Fonts/tool"));
    await writeTree(join(dir, "public"), { "fonts/a.woff2": utf8("x") });
    const isReserved = await reservedNamesFor(loadedConfig(dir, { publicDir: "public" }));
    await expect(resolveCatalog([pathSource("root", true)], dir, undefined, isReserved)).rejects.toMatchObject({
      code: "DATA",
      message: expect.stringContaining('namespace "Fonts"'),
    });
  });

  it("rejects a non-root label equal to the brand.logo file name", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "other"), treeFor("mark.svg/acme/tool"));
    const isReserved = await reservedNamesFor(loadedConfig(dir, { brand: { title: "C", logo: "img/Mark.svg" } }));
    await expect(resolveCatalog([pathSource("other")], dir, undefined, isReserved)).rejects.toMatchObject({
      code: "DATA",
      message: expect.stringContaining("already owns"),
    });
  });

  it("accepts the same non-root label without the logo reservation", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "other"), treeFor("mark.svg/acme/tool"));
    await expect(resolveCatalog([pathSource("other")], dir)).resolves.toBeDefined();
  });
});

describe("emitCatalogTree is base-independent (C-006, C-008, C-039)", () => {
  async function emitAt(base: string): Promise<string> {
    const dir = await tempDir();
    await writeTree(join(dir, "root"), treeFor("ocx.sh/acme/tool"));
    await writeTree(join(dir, "corp"), treeFor("corp.example/acme/tool"));
    const catalog = await resolveCatalog([pathSource("root", true), pathSource("corp")], dir);
    const out = join(dir, "out");
    await emitCatalogTree(catalog, out, base);
    return out;
  }

  it("writes byte-identical merged catalog.json for base / and /catalog/", async () => {
    const atRoot = await readFile(join(await emitAt("/"), "data", "catalog", "catalog.json"));
    const atBase = await readFile(join(await emitAt("/catalog/"), "data", "catalog", "catalog.json"));
    expect(Buffer.compare(atRoot, atBase)).toBe(0);
  });

  it("keeps every URL catalog-root-relative: no base, never protocol-relative", async () => {
    const out = await emitAt("/catalog/");
    const catalog = JSON.parse(await readFile(join(out, "data", "catalog", "catalog.json"), "utf8")) as {
      packages: { logoUrl: string | null; readmeUrl: string | null }[];
    };
    const urls = catalog.packages.flatMap((pkg) => [pkg.logoUrl, pkg.readmeUrl]).filter((url) => url !== null);
    expect(urls.sort()).toEqual([
      `/index/corp.example/p/acme/tool/o/sha256/${LOGO_HEX}.svg`,
      `/p/acme/tool/o/sha256/${LOGO_HEX}.svg`,
    ]);
    for (const url of urls) {
      expect(url.startsWith("//")).toBe(false);
    }
  });

  it("prefixes the _headers patterns by base", async () => {
    const headers = await readFile(join(await emitAt("/catalog/"), "_headers"), "utf8");
    expect(headers).toContain("/catalog/p/*\n");
    expect(headers).toContain("/catalog/index/corp.example/p/*\n");
    expect(headers).not.toMatch(/^\/p\/\*$/m);
  });

  it("refuses to write over a file the output already holds", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "root"), treeFor("ocx.sh/acme/tool"));
    const catalog = await resolveCatalog([pathSource("root", true)], dir);
    const out = join(dir, "out");
    await writeTree(out, { _headers: utf8("/consumer\n  X-Mine: 1\n") });
    const error = await emitCatalogTree(catalog, out, "/").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain('refusing to overwrite "_headers"');
    expect((error as BuildError).message).toContain("remove it from publicDir");
  });

  it("lets a failure that is not a path collision through untouched", async () => {
    const dir = await tempDir();
    await writeTree(join(dir, "root"), treeFor("ocx.sh/acme/tool"));
    const catalog = await resolveCatalog([pathSource("root", true)], dir);
    const notADirectory = join(dir, "file");
    await writeFile(notADirectory, "x");
    const error = await emitCatalogTree(catalog, notADirectory, "/").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BuildError);
  });
});
