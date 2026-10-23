/**
 * Pre-port baseline (0.5.3): `resolveCatalog`'s two build-visible outputs —
 * the route list and the merged `catalog.json` bytes — for two inputs, pinned
 * under `baseline_0_5_3/<case>/`. The theme port must leave both untouched;
 * a diff here is a behaviour change, not a snapshot to refresh.
 *
 *  - `quality-index`: `test/fixtures/quality-index/catalog.config.json`
 *    through `loadConfig` -> `resolveCatalog`, the path `buildCatalog` takes.
 *  - `multi_package`: the `test/golden/multi_package/input.ts` packages
 *    written out as a one-source path index, then resolved the same way.
 *
 * Regenerate (only for an intended change): `BASELINE_WRITE=1 npx vitest run
 * test/golden/baseline.test.ts --coverage.enabled=false`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCatalog } from "../../src/build/sources_pipeline.js";
import { loadConfig } from "../../src/config/load.js";
import type { ResolvedSource } from "../../src/config/types.js";
import { rootJsonBytes } from "../sources/helpers.js";
import { ordered } from "./multi_package/input.js";

const GOLDEN_ROOT = fileURLToPath(new URL(".", import.meta.url));
const BASELINE_ROOT = join(GOLDEN_ROOT, "baseline_0_5_3");
const QUALITY_CONFIG = join(GOLDEN_ROOT, "../fixtures/quality-index/catalog.config.json");

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Baseline {
  readonly routes: string;
  readonly catalog: string;
}

async function resolveBaseline(sources: readonly ResolvedSource[], configDir: string): Promise<Baseline> {
  const resolved = await resolveCatalog(sources, configDir);
  return { routes: `${JSON.stringify(resolved.routes, null, 2)}\n`, catalog: resolved.catalogJson };
}

async function qualityIndex(): Promise<Baseline> {
  const loaded = await loadConfig(QUALITY_CONFIG);
  return resolveBaseline(loaded.sources, loaded.configDir);
}

/** Writes the `multi_package` golden input as a wire tree and resolves it. */
async function multiPackage(): Promise<Baseline> {
  const dir = await mkdtemp(join(tmpdir(), "baseline-multi-package-"));
  cleanupDirs.push(dir);
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
      const [digest, ext] = [key.slice("sha256:".length, "sha256:".length + 64), key.slice(key.lastIndexOf(".") + 1)];
      files[`p/${namespace}/${name}/o/sha256/${digest}.${ext}`] = bytes;
    }
  }
  for (const [relPath, bytes] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
  return resolveBaseline([{ entry: { path: ".", root: true }, label: null }], dir);
}

const cases: Readonly<Record<string, () => Promise<Baseline>>> = {
  "quality-index": qualityIndex,
  multi_package: multiPackage,
};

describe("0.5.3 resolveCatalog baseline", () => {
  for (const [name, compute] of Object.entries(cases)) {
    it(`${name}: routes.json and catalog.json match the committed baseline`, async () => {
      const actual = await compute();
      if (process.env.BASELINE_WRITE === "1") {
        await mkdir(join(BASELINE_ROOT, name), { recursive: true });
        await writeFile(join(BASELINE_ROOT, name, "routes.json"), actual.routes, "utf8");
        await writeFile(join(BASELINE_ROOT, name, "catalog.json"), actual.catalog, "utf8");
      }
      expect(actual.routes).toBe(await readFile(join(BASELINE_ROOT, name, "routes.json"), "utf8"));
      expect(actual.catalog).toBe(await readFile(join(BASELINE_ROOT, name, "catalog.json"), "utf8"));
    });
  }
});
