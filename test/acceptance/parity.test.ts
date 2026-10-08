/**
 * C-002 multi-index parity: the Astro build renders the route set and the
 * merged `data/catalog/catalog.json` bytes the 0.5.3 baselines pin
 * (`test/golden/baseline_0_5_3/**`, written by `test/golden/baseline.test.ts`).
 * Both baseline inputs are built through the real CLI here. Also S-003's route
 * rules (bare for the root source, `<label>/…` otherwise) and
 * `INDEX_LABEL_RESERVED`, plus the determinism the tree hash rests on.
 *
 * Builds its own sites; the `catalog` and `root` ones come from the setup.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rootJsonBytes } from "../sources/helpers.js";
import { ordered } from "../golden/multi_package/input.js";
import { FIXTURE_DIR, fixtureConfig, htmlRoutes, listTree, runBuild, site, treeHash } from "./helpers.js";

const BASELINE_ROOT = fileURLToPath(new URL("../golden/baseline_0_5_3/", import.meta.url));
const QUALITY_CONFIG = join(FIXTURE_DIR, "../quality-index/catalog.config.json");

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** The `multi_package` golden input written out as a one-source path index (as baseline.test.ts does), plus its config. */
async function multiPackageProject(): Promise<{ config: string; out: string }> {
  const dir = await tempDir("accept-parity-multi-");
  const files: Record<string, Uint8Array> = { "config.json": new TextEncoder().encode('{"format_version":1}') };
  for (const pkg of ordered) {
    const { namespace, package: name } = pkg.packageId;
    const { desc, tags } = pkg.root;
    files[`p/${namespace}/${name}.json`] = rootJsonBytes({
      name: pkg.root.name,
      created: pkg.root.created,
      desc:
        desc === null
          ? null
          : {
              title: desc.title,
              description: desc.description,
              keywords: [...desc.keywords],
              ...(desc.readme !== null ? { readme: desc.readme } : {}),
              ...(desc.logo !== null ? { logo: desc.logo } : {}),
            },
      tags: Object.fromEntries(
        Object.entries(tags).map(([tag, entry]) => [tag, { content: entry.content, observed: entry.observed }]),
      ),
    });
    for (const [key, bytes] of Object.entries(pkg.contentByDigest)) {
      const digest = key.slice("sha256:".length, "sha256:".length + 64);
      files[`p/${namespace}/${name}/o/sha256/${digest}.${key.slice(key.lastIndexOf(".") + 1)}`] = bytes;
    }
  }
  for (const [relPath, bytes] of Object.entries(files)) {
    const full = join(dir, "index", relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
  const config = join(dir, "catalog.config.json");
  await writeFile(
    config,
    JSON.stringify({ sources: [{ path: "./index", root: true }], brand: { title: "Multi", wordmark: "multi.ocx.test" } }),
  );
  return { config, out: join(dir, "out") };
}

interface BaselineRoute {
  readonly segments: readonly string[];
}

async function baselineRoutes(name: string): Promise<string[]> {
  const routes = JSON.parse(await readFile(join(BASELINE_ROOT, name, "routes.json"), "utf8")) as BaselineRoute[];
  return routes.map((route) => route.segments.join("/")).sort();
}

describe("C-002 parity with the 0.5.3 baselines", () => {
  it("quality-index: route pages and catalog.json bytes equal the baseline", async () => {
    const out = join(await tempDir("accept-parity-quality-"), "out");

    const result = await runBuild(QUALITY_CONFIG, out);

    expect(result.code, result.stderr).toBe(0);
    expect(await htmlRoutes(out)).toEqual(await baselineRoutes("quality-index"));
    const built = await readFile(join(out, "data/catalog/catalog.json"));
    const baseline = await readFile(join(BASELINE_ROOT, "quality-index/catalog.json"));
    expect(Buffer.compare(built, baseline)).toBe(0);
  });

  it("multi_package: route pages and catalog.json bytes equal the baseline", async () => {
    const project = await multiPackageProject();

    const result = await runBuild(project.config, project.out);

    expect(result.code, result.stderr).toBe(0);
    expect(await htmlRoutes(project.out)).toEqual(await baselineRoutes("multi_package"));
    const built = await readFile(join(project.out, "data/catalog/catalog.json"));
    const baseline = await readFile(join(BASELINE_ROOT, "multi_package/catalog.json"));
    expect(Buffer.compare(built, baseline)).toBe(0);
  });
});

describe("S-003 routes of a multi-index catalog", () => {
  it("catalog: bare routes for the root source, <label>/… for the other; flags carried into catalog.json", async () => {
    const dir = site("catalog");
    const routes = await htmlRoutes(dir);
    expect(routes.filter((route) => route.startsWith("index-b/")).sort()).toEqual([
      "index-b/hostile/metadata",
      "index-b/hostile/noreadme",
      "index-b/hostile/ownerlink",
      "index-b/hostile/readme",
    ]);
    expect(routes.filter((route) => !route.startsWith("index-b/")).length).toBe(26);
    expect(routes.some((route) => route.startsWith("index-a/"))).toBe(false);

    const catalog = JSON.parse(await readFile(join(dir, "data/catalog/catalog.json"), "utf8")) as {
      indexes: { name: string; root: boolean; default: boolean; excludeFromAll: boolean }[];
    };
    expect(catalog.indexes).toMatchObject([
      { name: "index-a", root: true, default: false, excludeFromAll: false },
      { name: "index-b", root: false, default: true, excludeFromAll: true },
    ]);
  });

  it.each([
    ["a publicDir entry (any case)", { publicDir: "./public" }, { "public/ACME/readme.txt": "x" }],
    ["the brand.logo file name", { brand: { title: "T", wordmark: "t", logo: "./brand/Acme" } }, { "brand/Acme": "<svg/>" }],
  ] as const)(
    "the root namespace acme colliding with %s is refused with INDEX_LABEL_RESERVED (exit 65), nothing written",
    async (_name, extra, files) => {
      const dir = await tempDir("accept-parity-reserved-");
      await cp(join(FIXTURE_DIR, "../quality-index/p"), join(dir, "index/p"), { recursive: true });
      await cp(join(FIXTURE_DIR, "../quality-index/config.json"), join(dir, "index/config.json"));
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text);
      }
      const config = join(dir, "catalog.config.json");
      await writeFile(
        config,
        JSON.stringify({ sources: [{ path: "./index", root: true }], brand: { title: "T", wordmark: "t" }, ...extra }),
      );
      const out = join(dir, "out");

      const result = await runBuild(config, out);

      expect(result.code).toBe(65);
      expect(result.stderr).toContain("the root source publishes namespace");
      expect(result.stderr).toContain("acme");
      expect(await listTree(dir).then((all) => all.filter((path) => path.startsWith("out")))).toEqual([]);
    },
  );
});

describe("determinism (the tree hash's premise)", () => {
  let first: string;
  beforeAll(async () => {
    first = await treeHash(site("rootbase"));
  });

  it("a second CLI build of the same config is byte-identical to the setup's build", async () => {
    const out = join(await tempDir("accept-parity-det-"), "out");

    const result = await runBuild(fixtureConfig("rootbase"), out);

    expect(result.code, result.stderr).toBe(0);
    expect(await treeHash(out)).toBe(first);
  });
});
