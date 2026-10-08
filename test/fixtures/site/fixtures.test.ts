import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCatalog } from "../../../src/build/sources_pipeline.js";
import { loadConfig } from "../../../src/config/load.js";
import type { Catalog, CatalogEntry } from "../../../src/viewmodel/types.js";
// @ts-expect-error -- plain .mjs generator, no type declarations (test/ is outside tsconfig anyway)
import { generate } from "./generate.mjs";

/*
 * Pins the committed site fixtures (`test/fixtures/site/`) to the wire
 * contract and to their generator. Later steps (page synthesis, island
 * hydration, hostile-content rendering) build real sites from these trees, so
 * a drift here would surface as a confusing failure far from its cause.
 *
 * It drives the shipped entrypoints (`loadConfig` -> `resolveCatalog`, what
 * `buildCatalog` itself calls), not the readers directly.
 */

const SITE_DIR = fileURLToPath(new URL(".", import.meta.url));

async function resolve(configName: string): Promise<{ catalog: Catalog; entries: Map<string, CatalogEntry> }> {
  const loaded = await loadConfig(join(SITE_DIR, configName));
  const resolved = await resolveCatalog(loaded.sources, loaded.configDir);
  const catalog = JSON.parse(resolved.catalogJson) as Catalog;
  return { catalog, entries: new Map(catalog.packages.map((entry) => [entry.name, entry])) };
}

async function listTree(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listTree(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

describe("site fixture configs", () => {
  it("root: one root index with the neutral chrome, docs, publicDir and siteUrl", async () => {
    const loaded = await loadConfig(join(SITE_DIR, "root.config.json"));
    expect(loaded.config).toMatchObject({
      base: "/",
      chrome: "neutral",
      docs: "./docs-fixture",
      publicDir: "./public-fixture",
      siteUrl: "https://fixture.ocx.test",
      favicon: "/favicon.svg",
    });
    expect(loaded.config.brand.title).toBeTruthy();
    expect(loaded.config.nav).toHaveLength(1);
    expect(loaded.config.footer?.links).toHaveLength(1);
    expect(loaded.sources.map((s) => s.entry.root)).toEqual([true]);

    const { catalog, entries } = await resolve("root.config.json");
    expect(catalog.indexes.map((i) => i.name)).toEqual(["index-a"]);
    expect(catalog.packages.length).toBeGreaterThanOrEqual(24);
    expect(entries.get("index-a/tools/many-tags")?.tagCount).toBe(25);
  });

  it("rootbase: identical to root except base and the matching siteUrl path", async () => {
    const root = JSON.parse(await readFile(join(SITE_DIR, "root.config.json"), "utf8")) as Record<string, unknown>;
    const rootbase = JSON.parse(await readFile(join(SITE_DIR, "rootbase.config.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect({ ...rootbase, base: root.base, siteUrl: root.siteUrl }).toEqual(root);
    expect(rootbase.base).toBe("/catalog/");
    expect(rootbase.siteUrl).toBe("https://fixture.ocx.test/catalog/");

    const loaded = await loadConfig(join(SITE_DIR, "rootbase.config.json"));
    expect(loaded.config.base).toBe("/catalog/");
  });

  it("catalog: root index-a plus default, excludeFromAll index-b with its own ownerUrl", async () => {
    const loaded = await loadConfig(join(SITE_DIR, "catalog.config.json"));
    expect(loaded.config).toMatchObject({
      base: "/catalog/",
      chrome: "ocx",
      siteUrl: "https://fixture.ocx.test",
      ownerUrl: "https://forge.example/{login}",
    });
    expect(new URL(loaded.config.siteUrl!).pathname).toBe("/");
    expect(loaded.config.brand).toBeUndefined();
    const [a, b] = loaded.sources.map((s) => s.entry);
    expect(a).toMatchObject({ path: "./index-a", root: true });
    expect(b).toMatchObject({ path: "./index-b", default: true, excludeFromAll: true });
    expect(b!.ownerUrl).toContain("{login}");

    const { catalog } = await resolve("catalog.config.json");
    expect(catalog.indexes).toMatchObject([
      { name: "index-a", root: true, default: false, excludeFromAll: false },
      { name: "index-b", root: false, default: true, excludeFromAll: true },
    ]);
    const inAll = catalog.packages.filter((p) => !p.name.startsWith("index-b/"));
    expect(inAll.length).toBeGreaterThanOrEqual(24);
  });
});

describe("index-a", () => {
  it("spans volume, a 25-tag package and the status spread", async () => {
    const { entries } = await resolve("root.config.json");
    expect(entries.size).toBe(26);
    expect(entries.get("index-a/tools/many-tags")!.tagCount).toBe(25);

    const oldtool = entries.get("index-a/legacy/oldtool")!;
    expect(oldtool.status).toBe("deprecated");
    expect(oldtool.supersededBy).toBe("tools/modern");
    expect(entries.has(`index-a/${oldtool.supersededBy}`)).toBe(true);

    expect(entries.get("index-a/legacy/husk")!.status).toBe("yanked");

    const flaky = entries.get("index-a/tools/flaky")!;
    expect(flaky.status).toBe("active");
    expect(flaky.tagCount).toBe(2);
  });

  it("publishes image-free READMEs", async () => {
    const readmes = (await listTree(join(SITE_DIR, "index-a"))).filter((p) => p.endsWith(".md"));
    expect(readmes.length).toBeGreaterThanOrEqual(24);
    for (const path of readmes) {
      const text = await readFile(join(SITE_DIR, "index-a", path), "utf8");
      expect(text, path).not.toMatch(/!\[|<img/i);
    }
  });
});

describe("index-b (hostile)", () => {
  it("carries the hostile-README, hostile-metadata, bad-owner and no-README packages", async () => {
    const { entries } = await resolve("catalog.config.json");

    const readme = entries.get("index-b/hostile/readme")!;
    expect(readme.readmeUrl).not.toBeNull();
    const readmeSrc = await readFile(join(SITE_DIR, "index-b/p/hostile/readme.json"), "utf8");
    const readmeDigest = (JSON.parse(readmeSrc) as { desc: { readme: string } }).desc.readme.slice("sha256:".length);
    const markdown = await readFile(join(SITE_DIR, `index-b/p/hostile/readme/o/sha256/${readmeDigest}.md`), "utf8");
    for (const needle of [
      "<script>",
      "javascript:",
      "java&#9;script:",
      "onerror=",
      "onclick=",
      "<svg>",
      "<math>",
      "](//x",
      "](/x)",
      "](./x)",
    ]) {
      expect(markdown, needle).toContain(needle.startsWith("](//x") ? "](//evil.example/x)" : needle);
    }

    const metadata = entries.get("index-b/hostile/metadata")!;
    expect(metadata.status).toBe("deprecated");
    expect(metadata.description).toContain("</script>");
    expect(metadata.description).toContain("\n---");
    expect(metadata.description).toContain("${process.env.SECRET}");
    expect(metadata.keywords).toEqual(expect.arrayContaining(['"quoted"', "line\n---", "</script>", "${keyword}"]));
    expect(metadata.supersededBy).toContain("<img src=x onerror=alert(1)>");
    expect(metadata.tagCount).toBe(7);

    expect(entries.get("index-b/hostile/ownerlink")).toBeDefined();
    expect(entries.get("index-b/hostile/noreadme")!.readmeUrl).toBeNull();
  });
});

describe("docs-fixture", () => {
  it("holds five .md pages (a root index and a guide index among them), plus one .mdx that must not be mounted", async () => {
    const tree = await listTree(join(SITE_DIR, "docs-fixture"));
    expect(tree).toEqual([
      "guide/getting-started.md",
      "guide/index.md",
      "guide/install.md",
      "index.md",
      "reference/cli.md",
      "reference/notes.mdx",
    ]);
    const install = await readFile(join(SITE_DIR, "docs-fixture/guide/install.md"), "utf8");
    expect(install).toContain("::: details");
    const started = await readFile(join(SITE_DIR, "docs-fixture/guide/getting-started.md"), "utf8");
    expect(started).toContain("{#custom-anchor}");
    expect(started).toMatch(/^order: 1$/m);
  });
});

describe("generate.mjs", () => {
  let scratch: string | undefined;
  afterEach(async () => {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it("reproduces the committed index trees byte for byte", async () => {
    scratch = await mkdtemp(join(tmpdir(), "site-fixtures-"));
    await generate(scratch);
    for (const name of ["index-a", "index-b"]) {
      const regenerated = await listTree(join(scratch, name));
      expect(regenerated, `${name} file list`).toEqual(await listTree(join(SITE_DIR, name)));
      for (const path of regenerated) {
        const fresh = await readFile(join(scratch, name, path));
        const committed = await readFile(join(SITE_DIR, name, path));
        expect(fresh.equals(committed), `${name}/${path}`).toBe(true);
      }
    }
  });
});
