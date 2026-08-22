import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCatalog } from "../../src/build/sources_pipeline.js";
import { loadConfig } from "../../src/config/load.js";
import { readPathSource } from "../../src/sources/path.js";
import { extractPackages } from "../../src/sources/types.js";
import { readImageIndexAnnotations } from "../../src/viewmodel/catalog.js";
import type { Catalog, CatalogEntry, CatalogSourcePackage } from "../../src/viewmodel/types.js";

/*
 * Fast wire-validity guard for the Lighthouse quality-gate fixture
 * (`test/fixtures/quality-index/`). The fixture's ONLY other consumer is the
 * out-of-process `task quality:web` Lighthouse job — which is standalone, not
 * part of `verify`/CI's default gate — so without this test a wire-shape drift
 * (a source reader or view-model change the fixture no longer satisfies) would
 * stay green in `npm test` and surface only in that slow separate job, or not
 * until a real deploy. `test/` is not typechecked (tsconfig `include: ["src"]`),
 * so this runtime check is the only thing pinning the committed fixture to the
 * current wire contract.
 *
 * It drives the SAME entrypoint the real build uses — `loadConfig` ->
 * `resolveCatalog` (what `buildCatalog` itself calls) — plus the detail-page
 * annotation path (`readImageIndexAnnotations`), asserting the fixture exercises
 * every axis the gate needs it to span: active/deprecated/yanked status,
 * multi-platform image indices, OCI license/source/revision annotations,
 * readme+logo / readme-only / logo-only, and a derived variant.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/quality-index", import.meta.url));
const CONFIG_PATH = join(FIXTURE_DIR, "catalog.config.json");

function byId(catalog: Catalog): Map<string, CatalogEntry> {
  return new Map(catalog.packages.map((entry) => [`${entry.namespace}/${entry.package}`, entry]));
}

describe("quality-index fixture", () => {
  it("loads a config with the SEO/og prerequisites the gate depends on", async () => {
    const loaded = await loadConfig(CONFIG_PATH);
    // C-301/C-303 emit canonical/robots/sitemap/og only when siteUrl is set;
    // og:image needs brand.logo; the landing <h1> renders brand.title.
    expect(loaded.config.siteUrl).toBe("https://quality.ocx.test");
    expect(loaded.config.brand.title).toBe("Quality Fixture Catalog");
    expect(loaded.config.brand.logo).toBe("./brand/logo.svg");
    expect(loaded.config.favicon).toBe("/logo.svg");
  });

  it("resolves to the six spanning packages through the real build pipeline", async () => {
    const loaded = await loadConfig(CONFIG_PATH);
    const resolved = await resolveCatalog(loaded.sources, loaded.configDir);
    const catalog = JSON.parse(resolved.catalogJson) as Catalog;
    const entries = byId(catalog);

    expect([...entries.keys()].sort()).toEqual([
      "acme/gadget",
      "acme/husk",
      "acme/legacy-tool",
      "contrib/mono",
      "oxidize/ripgrep",
      "sharkdp/bat",
    ]);

    // Active, multi-platform, readme + logo, a derived variant.
    const gadget = entries.get("acme/gadget")!;
    expect(gadget.status).toBe("active");
    expect(gadget.platforms).toEqual([
      "darwin/amd64",
      "darwin/arm64",
      "linux/amd64",
      "linux/arm64",
      "windows/amd64",
      "windows/arm64",
    ]);
    expect(gadget.logoUrl).not.toBeNull();
    expect(gadget.readmeUrl).not.toBeNull();
    expect(gadget.variants).toContain("musl");
    expect(gadget.latestVersion).toBe("1.4.0");

    // Deprecated, with a successor pointer.
    const legacy = entries.get("acme/legacy-tool")!;
    expect(legacy.status).toBe("deprecated");
    expect(legacy.deprecatedMessage).not.toBeNull();
    expect(legacy.supersededBy).toBe("acme/gadget");

    // Whole-package yanked; readme-only (no logo).
    const husk = entries.get("acme/husk")!;
    expect(husk.status).toBe("yanked");
    expect(husk.readmeUrl).not.toBeNull();
    expect(husk.logoUrl).toBeNull();

    // Readme-only (no logo) and logo-only (no readme) — the two README states.
    expect(entries.get("oxidize/ripgrep")!.readmeUrl).not.toBeNull();
    expect(entries.get("oxidize/ripgrep")!.logoUrl).toBeNull();
    expect(entries.get("contrib/mono")!.readmeUrl).toBeNull();
    expect(entries.get("contrib/mono")!.logoUrl).not.toBeNull();

    // A per-tag yank never counts toward the live tag total.
    const bat = entries.get("sharkdp/bat")!;
    expect(bat.status).toBe("active");
    expect(bat.tagCount).toBe(4);
  });

  it("carries the OCI annotations the detail license/source row renders", async () => {
    const loaded = await loadConfig(CONFIG_PATH);
    const files = await readPathSource(loaded.sources[0]!.entry, loaded.configDir);
    const packages = extractPackages(files);
    const find = (ns: string, pkg: string): CatalogSourcePackage =>
      packages.find((p) => p.packageId.namespace === ns && p.packageId.package === pkg)!;

    // Mirrors the shipped client path exactly: `useImageIndex.ts` resolves
    // the active tag's `content` digest off the package root, fetches those
    // CAS bytes, and hands the parsed object to `readImageIndexAnnotations`.
    // Here the same bytes come from `contentByDigest` instead of `fetch`.
    const annotationsOfLatest = (source: CatalogSourcePackage) => {
      const digest = source.root.tags["latest"]!.content;
      const bytes = source.contentByDigest[`${digest}.json`]!;
      return readImageIndexAnnotations(
        JSON.parse(new TextDecoder().decode(bytes)) as { annotations?: unknown },
        digest,
      );
    };

    const gadget = annotationsOfLatest(find("acme", "gadget"));
    expect(gadget.license).toBe("MIT OR Apache-2.0");
    expect(gadget.sourceRepository).toBe("https://github.com/ocx-contrib/acme-gadget");
    expect(gadget.revision).toBe("2f8f59baab13db7e4dd35bfe2d1a95124de016d2");

    // A package whose image index carries no annotations reports none — never
    // a fabricated license.
    expect(annotationsOfLatest(find("oxidize", "ripgrep"))).toEqual({});
  });
});
