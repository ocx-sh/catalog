import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Passthrough wrapper so one test can make the `robots.txt` write fail with a
// non-EEXIST error; every other write goes to the real fs.
const fsFault = vi.hoisted(() => ({ robotsError: undefined as NodeJS.ErrnoException | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: (async (path: Parameters<typeof real.writeFile>[0], ...rest: unknown[]) => {
      if (fsFault.robotsError !== undefined && String(path).endsWith("robots.txt")) throw fsFault.robotsError;
      return (real.writeFile as (...args: unknown[]) => Promise<void>)(path, ...rest);
    }) as typeof real.writeFile,
  };
});

import { assemblePublic, writeSiteJson } from "../../src/build/assemble.js";
import { BuildError } from "../../src/build/errors.js";
import { resolveCatalog, type ResolvedCatalog } from "../../src/build/sources_pipeline.js";
import { loadConfig } from "../../src/config/load.js";
import type { LoadedConfig } from "../../src/config/types.js";
import type { SiteInput } from "../../src/site/astro_config.js";
import { siteModel, type SiteModel } from "../../src/site/model/index.js";
import type { Catalog } from "../../src/viewmodel/types.js";

/*
 * Drives `assemblePublic`/`writeSiteJson` against a temp copy of the committed
 * site fixtures (`test/fixtures/site`), through the real `loadConfig` ->
 * `resolveCatalog` -> `emitCatalogTree` chain. Base "/" only.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/site/", import.meta.url));
const cleanupDirs: string[] = [];

afterEach(async () => {
  fsFault.robotsError = undefined;
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Project {
  readonly dir: string;
  readonly scratch: string;
  readonly loaded: LoadedConfig;
  readonly catalog: ResolvedCatalog;
}

/** A writable copy of the fixture tree, loaded through `root.config.json`. */
async function project(): Promise<Project> {
  const dir = await mkdtemp(join(tmpdir(), "assemble-"));
  cleanupDirs.push(dir);
  await cp(FIXTURE_DIR, dir, { recursive: true });
  const scratch = join(dir, "scratch");
  await mkdir(scratch);
  const loaded = await loadConfig(join(dir, "root.config.json"));
  const catalog = await resolveCatalog(loaded.sources, loaded.configDir);
  return { dir, scratch, loaded, catalog };
}

const withConfig = (loaded: LoadedConfig, patch: Partial<LoadedConfig["config"]>): LoadedConfig => ({
  ...loaded,
  config: { ...loaded.config, ...patch },
});

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("assemblePublic", () => {
  it("copies publicDir, mirrors the wire tree and _headers, and writes the merged catalog.json last", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    // A consumer file on the generated catalog's path must lose (last-write-wins).
    await mkdir(join(dir, "public-fixture", "data", "catalog"), { recursive: true });
    await writeFile(join(dir, "public-fixture", "data", "catalog", "catalog.json"), "{\"shadow\":true}");

    const publicDir = await assemblePublic({ scratch, loaded, catalog, base: "/" });

    expect(publicDir).toBe(join(scratch, "public"));
    expect(await readFile(join(publicDir, "favicon.svg"), "utf8")).toBe(
      await readFile(join(dir, "public-fixture", "favicon.svg"), "utf8"),
    );
    expect(await readFile(join(publicDir, "data", "catalog", "catalog.json"), "utf8")).toBe(catalog.catalogJson);
    expect(await exists(join(publicDir, "_headers"))).toBe(true);
    const root = JSON.parse(await readFile(join(publicDir, "p", "tools", "modern.json"), "utf8")) as { name: string };
    expect(root.name).toBe("index-a/tools/modern");
  });

  it("copies the configured css file to <public>/<basename> where the chrome links it", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await mkdir(join(dir, "theme"));
    await writeFile(join(dir, "theme", "custom.css"), ":root { --x: 1; }");

    const publicDir = await assemblePublic({
      scratch,
      loaded: withConfig(loaded, { css: "./theme/custom.css" }),
      catalog,
      base: "/",
    });

    expect(await readFile(join(publicDir, "custom.css"), "utf8")).toBe(":root { --x: 1; }");
  });

  it("chrome ocx without a consumer favicon.svg ships the theme logo there, so the Shell's icon link resolves", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await rm(join(dir, "public-fixture", "favicon.svg"));

    const publicDir = await assemblePublic({ scratch, loaded: withConfig(loaded, { chrome: "ocx" }), catalog, base: "/" });

    const logo = createRequire(import.meta.url).resolve("@ocx-sh/theme/logo.svg");
    expect(await readFile(join(publicDir, "favicon.svg"), "utf8")).toBe(await readFile(logo, "utf8"));
  });

  it("chrome ocx keeps a consumer favicon.svg over the theme logo", async () => {
    const { dir, scratch, loaded, catalog } = await project();

    const publicDir = await assemblePublic({ scratch, loaded: withConfig(loaded, { chrome: "ocx" }), catalog, base: "/" });

    expect(await readFile(join(publicDir, "favicon.svg"), "utf8")).toBe(
      await readFile(join(dir, "public-fixture", "favicon.svg"), "utf8"),
    );
  });

  it("chrome neutral never ships a favicon.svg of its own", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await rm(join(dir, "public-fixture", "favicon.svg"));

    const publicDir = await assemblePublic({ scratch, loaded: withConfig(loaded, { chrome: "neutral", favicon: undefined }), catalog, base: "/" });

    expect(await exists(join(publicDir, "favicon.svg"))).toBe(false);
  });

  it("keeps a consumer robots.txt over the default", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    const publicDir = await assemblePublic({ scratch, loaded, catalog, base: "/" });
    expect(await readFile(join(publicDir, "robots.txt"), "utf8")).toBe(
      await readFile(join(dir, "public-fixture", "robots.txt"), "utf8"),
    );
  });

  it("writes the default robots.txt with an absolute sitemap-index URL when siteUrl is set and the consumer has none", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await rm(join(dir, "public-fixture", "robots.txt"));
    const publicDir = await assemblePublic({ scratch, loaded, catalog, base: "/" });
    expect(await readFile(join(publicDir, "robots.txt"), "utf8")).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://fixture.ocx.test/sitemap-index.xml\n",
    );
  });

  it("writes no robots.txt without siteUrl", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await rm(join(dir, "public-fixture", "robots.txt"));
    const publicDir = await assemblePublic({
      scratch,
      loaded: withConfig(loaded, { siteUrl: undefined }),
      catalog,
      base: "/",
    });
    expect(await exists(join(publicDir, "robots.txt"))).toBe(false);
  });

  it("rethrows a robots.txt write failure that is not EEXIST", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await rm(join(dir, "public-fixture", "robots.txt"));
    fsFault.robotsError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    await expect(assemblePublic({ scratch, loaded, catalog, base: "/" })).rejects.toThrow("disk full");
  });

  it("copies brand.logo to its basename", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "mark.svg"), "<svg>logo</svg>");

    const publicDir = await assemblePublic({
      scratch,
      loaded: withConfig(loaded, { brand: { ...loaded.config.brand, logo: "./assets/mark.svg" } }),
      catalog,
      base: "/",
    });

    expect(await readFile(join(publicDir, "mark.svg"), "utf8")).toBe("<svg>logo</svg>");
  });

  it.each([
    ["brand.logo", "./assets/mark.svg", { brand: { title: "T", logo: "./assets/mark.svg" } }],
    ["css", "./assets/mark.svg", { css: "./assets/mark.svg" }],
  ] as const)("fails with a DATA BuildError when %s would overwrite a same-named publicDir file", async (key, configPath, patch) => {
    const { dir, scratch, loaded, catalog } = await project();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "mark.svg"), "<svg>config</svg>");
    await writeFile(join(dir, "public-fixture", "mark.svg"), "<svg>consumer</svg>");

    const error = await assemblePublic({ scratch, loaded: withConfig(loaded, patch), catalog, base: "/" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain(`${key} "${configPath}"`);
    expect((error as BuildError).message).toContain("/mark.svg");
    expect(await readFile(join(scratch, "public", "mark.svg"), "utf8")).toBe("<svg>consumer</svg>");
  });

  it.each([
    ["brand.logo", { brand: { title: "T", logo: "./public-fixture/mark.svg" } }],
    ["css", { css: "./public-fixture/mark.svg" }],
  ] as const)("skips the copy, without error, when %s already is the publicDir file it would collide with", async (_key, patch) => {
    const { dir, scratch, loaded, catalog } = await project();
    await writeFile(join(dir, "public-fixture", "mark.svg"), "<svg>in place</svg>");

    const publicDir = await assemblePublic({ scratch, loaded: withConfig(loaded, patch), catalog, base: "/" });

    expect(await readFile(join(publicDir, "mark.svg"), "utf8")).toBe("<svg>in place</svg>");
  });

  it("still refuses a logo inside publicDir when a different file of that name sits at the publicDir root", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await mkdir(join(dir, "public-fixture", "sub"));
    await writeFile(join(dir, "public-fixture", "sub", "mark.svg"), "<svg>nested</svg>");
    await writeFile(join(dir, "public-fixture", "mark.svg"), "<svg>root</svg>");

    await expect(
      assemblePublic({ scratch, loaded: withConfig(loaded, { brand: { title: "T", logo: "./public-fixture/sub/mark.svg" } }), catalog, base: "/" }),
    ).rejects.toMatchObject({ code: "DATA", message: expect.stringContaining("move one out of publicDir") });
  });

  it("fails with a DATA BuildError when brand.logo and css share a basename", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    await writeFile(join(dir, "a", "site.css"), "a");
    await writeFile(join(dir, "b", "site.css"), "b");

    await expect(
      assemblePublic({
        scratch,
        loaded: withConfig(loaded, { publicDir: undefined, brand: { title: "T", logo: "./a/site.css" }, css: "./b/site.css" }),
        catalog,
        base: "/",
      }),
    ).rejects.toMatchObject({ name: "BuildError", code: "DATA", message: expect.stringContaining('css "./b/site.css"') });
  });

  it("accepts a favicon that only brand.logo provides, and a site without publicDir", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await writeFile(join(dir, "icon.svg"), "<svg/>");
    await expect(
      assemblePublic({
        scratch,
        loaded: withConfig(loaded, {
          publicDir: undefined,
          favicon: "/icon.svg",
          brand: { ...loaded.config.brand, logo: "./icon.svg" },
        }),
        catalog,
        base: "/",
      }),
    ).resolves.toBe(join(scratch, "public"));
  });

  it("fails with a DATA BuildError, and mirrors nothing, when the favicon target is missing", async () => {
    const { scratch, loaded, catalog } = await project();
    const error = await assemblePublic({
      scratch,
      loaded: withConfig(loaded, { favicon: "/missing.ico" }),
      catalog,
      base: "/",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain("/missing.ico");
    expect(await exists(join(scratch, "public", "p"))).toBe(false);
  });

  it.each(["/favicon.svg?v=2", "/favicon.svg#x", "/fav%69con.svg?v=2"])("resolves the favicon file from the URL's path only (%s)", async (favicon) => {
    const { scratch, loaded, catalog } = await project();
    await expect(assemblePublic({ scratch, loaded: withConfig(loaded, { favicon }), catalog, base: "/" })).resolves.toBe(join(scratch, "public"));
  });

  it("decodes a percent-escaped favicon file name before looking it up", async () => {
    const { dir, scratch, loaded, catalog } = await project();
    await writeFile(join(dir, "public-fixture", "my icon.svg"), "<svg/>");
    await expect(
      assemblePublic({ scratch, loaded: withConfig(loaded, { favicon: "/my%20icon.svg" }), catalog, base: "/" }),
    ).resolves.toBe(join(scratch, "public"));
  });

  it("reports a favicon with a malformed percent escape as unresolvable, not as a crash", async () => {
    const { scratch, loaded, catalog } = await project();
    await expect(
      assemblePublic({ scratch, loaded: withConfig(loaded, { favicon: "/bad%zz.svg" }), catalog, base: "/" }),
    ).rejects.toMatchObject({ code: "DATA", message: expect.stringContaining("does not resolve") });
  });

  it.each(["https://cdn.test/icon.svg", "//cdn.test/icon.svg"])("does not check an off-site favicon (%s)", async (favicon) => {
    const { scratch, loaded, catalog } = await project();
    await expect(assemblePublic({ scratch, loaded: withConfig(loaded, { favicon }), catalog, base: "/" })).resolves.toBeTypeOf("string");
  });

  it("rethrows a favicon stat failure that is not ENOENT", async () => {
    const { scratch, loaded, catalog } = await project();
    // favicon.svg is a file, so resolving a child under it is ENOTDIR.
    await expect(
      assemblePublic({ scratch, loaded: withConfig(loaded, { favicon: "/favicon.svg/child" }), catalog, base: "/" }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

/** The model as the engine hands it to `writeSiteJson`: README paths point at rendered files under the scratch root. */
function modelOf({ loaded, catalog, scratch }: Project): SiteModel {
  const model = siteModel(JSON.parse(catalog.catalogJson) as Catalog, catalog.routes, loaded);
  const readme = Object.fromEntries(
    Object.entries(model.readme).map(([key, cas]) => [key, cas === null ? null : join(scratch, "readme", `${key.replaceAll("/", "_")}.html`)]),
  );
  return { ...model, readme };
}

const astroInput = (scratch: string): SiteInput => ({
  base: "/",
  siteUrl: "https://fixture.ocx.test",
  outDir: join(scratch, "staging"),
  publicDir: join(scratch, "public"),
  cacheDir: join(scratch, ".astro-cache"),
  sitePath: join(scratch, "site.json"),
  cspHashes: [],
  fsAllow: [scratch],
});

describe("writeSiteJson", () => {
  it("writes the model verbatim, plus the astro SiteInput under its own key, to <scratch>/site.json", async () => {
    const p = await project();
    const model = modelOf(p);
    const astro = astroInput(p.scratch);
    const path = await writeSiteJson(p.scratch, model, astro);
    expect(path).toBe(join(p.scratch, "site.json"));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(JSON.parse(JSON.stringify({ ...model, astro })));
    expect(model.routes.length).toBeGreaterThanOrEqual(24);
  });

  it("does not grow with README size: a 20 KB README leaves site.json byte-identical and under 64 KB", async () => {
    const p = await project();
    const before = await readFile(await writeSiteJson(p.scratch, modelOf(p), astroInput(p.scratch)), "utf8");

    const modern = join(p.dir, "index-a/p/tools/modern/o/sha256");
    const readmeFile = "4092c81a1202b0e599303e1dd869f4fafcadd5bfd10e7b3263f14f9f3595a9bb.md";
    await writeFile(join(modern, readmeFile), `# Big\n\n${"lorem ipsum dolor sit amet\n".repeat(800)}`);
    expect((await stat(join(modern, readmeFile))).size).toBeGreaterThan(20_000);

    const resolved = await resolveCatalog(p.loaded.sources, p.loaded.configDir);
    const after = await readFile(await writeSiteJson(p.scratch, modelOf({ ...p, catalog: resolved }), astroInput(p.scratch)), "utf8");

    expect(after).toBe(before);
    expect(Buffer.byteLength(after)).toBeLessThan(64 * 1024);
  });

  it.each(["# Title\n\nbody text", "/p/ns/pkg/o/sha256/aa.md", "relative/readme.html"])(
    "refuses a readme entry that is not a rendered file under the scratch readme directory (%j)",
    async (entry) => {
    const p = await project();
    const model = modelOf(p);
    const key = model.routes[0] as string;
    const bad: SiteModel = { ...model, readme: { ...model.readme, [key]: entry } };
    await expect(writeSiteJson(p.scratch, bad, astroInput(p.scratch))).rejects.toThrow(`readme of ${key} is not a rendered README file`);
    expect(await exists(join(p.scratch, "site.json"))).toBe(false);
    },
  );

  it("refuses a readme path that climbs out of the readme directory", async () => {
    const p = await project();
    const model = modelOf(p);
    const key = model.routes[0] as string;
    const climbing = `${p.scratch}/readme/../../etc/passwd`;
    await expect(
      writeSiteJson(p.scratch, { ...model, readme: { ...model.readme, [key]: climbing } }, astroInput(p.scratch)),
    ).rejects.toThrow("is not a rendered README file");
  });

  it("accepts a rendered README under a project directory whose own name contains '..'", async () => {
    const p = await project();
    const model = modelOf(p);
    const key = model.routes[0] as string;
    const scratch = join(p.dir, "my..proj", "scratch");
    await mkdir(scratch, { recursive: true });
    const readme = { ...Object.fromEntries(model.routes.map((route) => [route, null])), [key]: join(scratch, "readme", "page.html") };

    await expect(writeSiteJson(scratch, { ...model, readme }, astroInput(scratch))).resolves.toBe(join(scratch, "site.json"));
  });

  it("accepts a route without a README", async () => {
    const p = await project();
    const model = modelOf(p);
    const key = model.routes[0] as string;
    await expect(writeSiteJson(p.scratch, { ...model, readme: { ...model.readme, [key]: null } }, astroInput(p.scratch))).resolves.toBeTypeOf("string");
  });

  it.each(["manifests", "root", "imageIndex"])("refuses a wire-data key (%s) nested in a view, including inside arrays", async (forbidden) => {
    const p = await project();
    const model = modelOf(p);
    const key = model.routes[0] as string;
    const detail = model.details[key] as SiteModel["details"][string];
    const leaked = {
      ...model,
      details: { ...model.details, [key]: { ...detail, platforms: [{ [forbidden]: {} }] } },
    } as unknown as SiteModel;
    await expect(writeSiteJson(p.scratch, leaked, astroInput(p.scratch))).rejects.toThrow(`${forbidden} must not carry wire data`);
  });
});
