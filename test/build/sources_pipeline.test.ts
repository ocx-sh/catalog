import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildError } from "../../src/build/errors.js";
import { cacheBaseDir } from "../../src/build/scratch.js";
import { emitCatalogTree, resolveCatalog, warnToStderr } from "../../src/build/sources_pipeline.js";
import type { ResolvedSource } from "../../src/config/types.js";
import { compareQualifiedIds } from "../../src/sources/mirror.js";
import { readPathSource } from "../../src/sources/path.js";
import { extractPackages } from "../../src/sources/types.js";
import { catalogIndex, serializeCatalog } from "../../src/viewmodel/catalog.js";
import { findFreePort } from "./helpers.js";
import { rootJsonBytes, sha256Digest, utf8 } from "../sources/helpers.js";

/*
 * Spec tests for `src/build/sources_pipeline.ts` — the source layer's wiring
 * into `build`/`dev`. Real readers against real fixtures (a directory tree, a
 * local HTTP server, a local git repo), no injected `fetch`/`git` seams:
 * the whole point of this module is that it composes the REAL readers, so a
 * test-only injection point here would prove nothing about the composition.
 *
 * `test/build/engine_sources_e2e.test.ts` is the end-to-end half (a real
 * `buildCatalog()` through a real `vitepress build()`); this file covers the
 * resolution/merge/error-mapping contract on its own.
 */

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
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

/** One tag's CAS bytes — a real OCI image index, since `catalogPlatforms`
 * parses it for every live tag. */
const IMAGE_INDEX = utf8(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: `sha256:${"b".repeat(64)}`,
        size: 512,
        platform: { os: "linux", architecture: "amd64" },
      },
    ],
  }),
);
const IMAGE_INDEX_DIGEST = sha256Digest(IMAGE_INDEX);
const IMAGE_INDEX_HEX = IMAGE_INDEX_DIGEST.slice("sha256:".length);

/** Depth-2 package WITH a `desc` block (feeds `descLookup`). */
const WIDGET_ROOT = rootJsonBytes({
  name: "ocx.sh/acme/widget",
  created: "2026-01-01",
  desc: { title: "Widget", description: "The widget.", keywords: ["widget"] },
  tags: { "1.0.0": { content: IMAGE_INDEX_DIGEST, observed: "2026-01-02T00:00:00Z" } },
});

/** Depth-3 package ([#716]) with NO `desc` block. */
const GADGET_ROOT = rootJsonBytes({ name: "ocx.sh/acme/tools/gadget", created: "2026-01-03" });

/** The same package id under a DIFFERENT index — every source in a
 * multi-source fixture must carry its own brand prefix, since a source's
 * label and that prefix are now required to agree (`LABEL_PREFIX_MISMATCH`). */
const CORP_BETA_ROOT = rootJsonBytes({ name: "corp.example/beta/thing", created: "2026-01-04" });
const CORP_WIDGET_ROOT = rootJsonBytes({ name: "corp.example/acme/widget", created: "2026-01-05" });

/** An index that names itself `acme` — which is also a NAMESPACE the root
 * fixture publishes (`ocx.sh/acme/widget`), so both would claim `/acme/**`. */
const ACME_BRAND_ROOT = rootJsonBytes({ name: "acme/tools/thing", created: "2026-01-07" });

/** An index whose own roots name it `docs` — no hostile intent needed, just
 * an org that called itself that. Its packages would be served at `/docs/**`,
 * the same prefix `pages.ts` mounts a configured docs tree at. */
const DOCS_BRAND_ROOT = rootJsonBytes({ name: "docs/guide/tool", created: "2026-01-06" });

/** The wire tree both the `path` and the `git` fixtures use. */
const WIRE_TREE: Readonly<Record<string, Uint8Array>> = {
  "config.json": CONFIG_JSON,
  "p/acme/widget.json": WIDGET_ROOT,
  [`p/acme/widget/o/sha256/${IMAGE_INDEX_HEX}.json`]: IMAGE_INDEX,
  "p/acme/tools/gadget.json": GADGET_ROOT,
};

/** One `packages[]` row of `/data/catalog/catalog.json`, narrowed to the two
 * URL fields under test — the emitter's own `CatalogEntry` is not imported
 * here on purpose: this asserts against the SERIALIZED bytes a browser
 * fetches, not against the type that produced them. */
interface CatalogRow {
  namespace: string;
  package: string;
  logoUrl: string | null;
  readmeUrl: string | null;
}

const LOGO_BYTES = utf8("<svg xmlns='http://www.w3.org/2000/svg'/>");
const LOGO_DIGEST = sha256Digest(LOGO_BYTES);
const LOGO_HEX = LOGO_DIGEST.slice("sha256:".length);
const README_BYTES = utf8("# Thing\n");
const README_DIGEST = sha256Digest(README_BYTES);
const README_HEX = README_DIGEST.slice("sha256:".length);

/** A one-package wire tree whose root publishes BOTH desc assets, with the
 * CAS blobs actually present — a dangling digest would throw instead, so the
 * URL assertions below can only be reached by a complete tree. */
function ASSET_TREE(name: string): Readonly<Record<string, Uint8Array>> {
  const wirePath = name.split("/").slice(1).join("/");
  return {
    "config.json": CONFIG_JSON,
    [`p/${wirePath}.json`]: rootJsonBytes({
      name,
      created: "2026-01-01",
      desc: {
        title: "Thing",
        description: "A thing.",
        keywords: [],
        readme: README_DIGEST,
        logo: LOGO_DIGEST,
      },
      tags: { "1.0.0": { content: IMAGE_INDEX_DIGEST, observed: "2026-01-02T00:00:00Z" } },
    }),
    [`p/${wirePath}/o/sha256/${IMAGE_INDEX_HEX}.json`]: IMAGE_INDEX,
    [`p/${wirePath}/o/sha256/${LOGO_HEX}.svg`]: LOGO_BYTES,
    [`p/${wirePath}/o/sha256/${README_HEX}.md`]: README_BYTES,
  };
}

function pathSource(
  entryPath: string,
  extra: { root?: boolean; label?: string; default?: boolean } = {},
): ResolvedSource {
  const { root, label } = extra;
  return {
    entry: {
      path: entryPath,
      ...(root !== undefined ? { root } : {}),
      ...(extra.default !== undefined ? { default: extra.default } : {}),
    },
    label: label ?? null,
  };
}

describe("sources_pipeline resolveCatalog — path source", () => {
  it("merges a source's packages into routes, descLookup and the catalog, in qualified-id order", async () => {
    const dir = await tempDir("catalog-pipeline-path-");
    await writeTree(join(dir, "index"), WIRE_TREE);

    const catalog = await resolveCatalog([pathSource("index", { root: true })], dir);

    // Label derived from the roots' own `name` prefix (no explicit label).
    expect(catalog.sources.map((source) => source.label)).toEqual(["ocx.sh"]);
    expect(catalog.sources[0]?.root).toBe(true);

    // Depth-N segments, sorted `acme/tools/gadget` < `acme/widget`; the
    // root:true source's packages carry the empty wireBase.
    expect(catalog.routes).toEqual([
      { segments: ["acme", "tools", "gadget"], namespace: "acme", package: "tools/gadget", wireBase: "" },
      { segments: ["acme", "widget"], namespace: "acme", package: "widget", wireBase: "" },
    ]);

    expect(catalog.descLookup(["acme", "widget"])).toEqual({ title: "Widget", description: "The widget." });
    // No `desc` block on the wire -> null, so config_gen falls back to its
    // own generic copy rather than baking in a made-up title.
    expect(catalog.descLookup(["acme", "tools", "gadget"])).toBeNull();

    const parsed = JSON.parse(catalog.catalogJson) as {
      generated: string | null;
      packages: { namespace: string; package: string; platforms: string[] }[];
    };
    expect(parsed.packages.map((entry) => `${entry.namespace}/${entry.package}`)).toEqual([
      "acme/tools/gadget",
      "acme/widget",
    ]);
    expect(parsed.generated).toBe("2026-01-02T00:00:00Z");
    expect(parsed.packages[1]?.platforms).toEqual(["linux/amd64"]);

    // Byte-identical to the same view model built straight off the reader,
    // GIVEN the same `indexes` argument — the pipeline adds ordering and the
    // envelope, never a re-serialization of its own. The envelope ships for
    // every catalog now, one source included, because route qualification
    // reads it; the Python-bot byte gate lives on `catalogIndex` itself
    // (`test/golden/**` calls it with one argument and never comes through
    // here), so it is unaffected either way.
    const files = await readPathSource({ path: "index" }, dir);
    const expectedJson = serializeCatalog(
      catalogIndex([...extractPackages(files)].sort(compareQualifiedIds), [
        { name: "ocx.sh", root: true, default: true, count: 2 },
      ]),
    );
    expect(catalog.catalogJson).toBe(expectedJson);
  });

  it("a non-root source's packages carry the index/<label> wireBase", async () => {
    const dir = await tempDir("catalog-pipeline-nonroot-");
    await writeTree(join(dir, "index"), WIRE_TREE);

    // An explicit label may only restate what the roots already say
    // (`labels.ts`'s LABEL_PREFIX_MISMATCH), so it is the roots' own prefix.
    const catalog = await resolveCatalog([pathSource("index", { label: "ocx.sh" })], dir);

    expect(catalog.sources[0]).toMatchObject({ label: "ocx.sh", root: false });
    expect(catalog.routes.map((route) => route.wireBase)).toEqual(["index/ocx.sh", "index/ocx.sh"]);
    // Non-root: every route leads with the index name.
    expect(catalog.routes.map((route) => route.segments[0])).toEqual(["ocx.sh", "ocx.sh"]);
  });

  // The bug this pins, and the reason it went unseen for a whole branch: the
  // suite asserted the ROUTE shape for exactly this config (the case above)
  // and never once looked at the catalog JSON it ships alongside. Route
  // qualification was decided per source (`root`), the `indexes` envelope per
  // catalog (`results.length > 1`), and with ONE non-root source those two
  // disagreed — pages written at `/ocx.sh/acme/widget`, no envelope for the
  // theme to resolve them with, so `packageRoutePath` fell back to the bare
  // path and every card, table row and ⌘K link 404'd. `scripts/dev-indexes.mjs`
  // even ships this config as its `single-noroot` case; nobody clicked a card.
  it("a SINGLE non-root source still publishes the envelope its qualified routes need", async () => {
    const dir = await tempDir("catalog-pipeline-lone-nonroot-");
    await writeTree(join(dir, "index"), WIRE_TREE);

    const catalog = await resolveCatalog([pathSource("index")], dir);

    expect(catalog.routes.map((route) => route.segments[0])).toEqual(["ocx.sh", "ocx.sh"]);

    const parsed = JSON.parse(catalog.catalogJson) as { indexes?: { name: string; root: boolean }[] };
    expect(parsed.indexes).toEqual([{ name: "ocx.sh", root: false, default: false, count: 2 }]);

    // The two halves agree by construction: no entry is `root`, so no bare
    // route exists, and every route is qualified.
    expect(parsed.indexes?.some((entry) => entry.root)).toBe(false);
  });

  // Same gap, the check that shipped first: `checkIndexNamespaceCollisions`
  // was exercised only in isolation, so deleting its call from the pipeline
  // left the whole suite green. A root source publishing namespace `acme`
  // beside a non-root index that names itself `acme` is the collision — the
  // root's `/acme/widget` page and the whole `acme` index both claim
  // `/acme/**`, and whichever page synthesis wrote last would win silently.
  it("rejects a non-root index whose label is a namespace the root source publishes", async () => {
    const dir = await tempDir("catalog-pipeline-nscollide-");
    await writeTree(join(dir, "root"), WIRE_TREE);
    await writeTree(join(dir, "other"), {
      "config.json": CONFIG_JSON,
      "p/tools/thing.json": ACME_BRAND_ROOT,
    });

    await expect(
      resolveCatalog([pathSource("root", { root: true }), pathSource("other")], dir),
    ).rejects.toMatchObject({
      code: "DATA",
      message: expect.stringContaining("namespace the root source publishes"),
    });
  });

  // The call site is the point. `checkReservedIndexLabels` has unit tests of
  // its own, and those stay green with the call below deleted — the exact
  // shape that let `checkIndexNamespaceCollisions` ship unreachable.
  it("rejects a non-root index whose derived label is a path the build owns", async () => {
    const dir = await tempDir("catalog-pipeline-reserved-");
    await writeTree(join(dir, "index"), {
      "config.json": CONFIG_JSON,
      "p/guide/tool.json": DOCS_BRAND_ROOT,
    });

    await expect(resolveCatalog([pathSource("index")], dir)).rejects.toMatchObject({
      code: "DATA",
      message: expect.stringContaining("already owns"),
    });
  });

  // The other end of the same rule: one ROOT source qualifies nothing, and
  // still publishes the envelope that says so.
  it("a single root source publishes a root envelope and keeps bare routes", async () => {
    const dir = await tempDir("catalog-pipeline-lone-root-");
    await writeTree(join(dir, "index"), WIRE_TREE);

    const catalog = await resolveCatalog([pathSource("index", { root: true })], dir);

    expect(catalog.routes.map((route) => route.segments[0])).toEqual(["acme", "acme"]);
    const parsed = JSON.parse(catalog.catalogJson) as { indexes?: { name: string; root: boolean }[] };
    expect(parsed.indexes).toEqual([{ name: "ocx.sh", root: true, default: true, count: 2 }]);
  });

  // The bug this pins: `wireBase` reached `routes` from the very first
  // release but never reached the CATALOG, so every non-root source's
  // `logoUrl`/`readmeUrl` in `/data/catalog/catalog.json` pointed at `/p/**`
  // — the site root, which only ever holds the `root: true` source's mirror
  // copy. The bytes existed the whole time, one directory over under
  // `/index/<label>/p/**`, and the grid's image-fallback chain swallowed
  // every 404 into a monogram tile.
  it("each package's catalog logoUrl/readmeUrl carries ITS OWN source's wireBase", async () => {
    const dir = await tempDir("catalog-pipeline-assets-");
    await writeTree(join(dir, "home"), ASSET_TREE("ocx.sh/acme/widget"));
    await writeTree(join(dir, "corp"), ASSET_TREE("corp.example/beta/thing"));

    const catalog = await resolveCatalog(
      [pathSource("home", { root: true }), pathSource("corp")],
      dir,
    );
    const packages = (JSON.parse(catalog.catalogJson) as { packages: CatalogRow[] }).packages;
    const byId = new Map(packages.map((row) => [`${row.namespace}/${row.package}`, row]));

    // Root source -> site root, exactly as before this field existed.
    expect(byId.get("acme/widget")).toMatchObject({
      logoUrl: `/p/acme/widget/o/sha256/${LOGO_HEX}.svg`,
      readmeUrl: `/p/acme/widget/o/sha256/${README_HEX}.md`,
    });
    // Non-root source -> the `index/<label>/` tree `mirror.ts` actually
    // wrote. Label is derived from the root name's first segment.
    expect(byId.get("beta/thing")).toMatchObject({
      logoUrl: `/index/corp.example/p/beta/thing/o/sha256/${LOGO_HEX}.svg`,
      readmeUrl: `/index/corp.example/p/beta/thing/o/sha256/${README_HEX}.md`,
    });
  });

  // This used to keep only the FIRST configured source's copy, because both
  // would otherwise claim one detail-page route. Index-qualified routes made
  // that unnecessary, and silently dropping a mirror's package was never an
  // honest rendering of an aggregating catalog.
  it("a package present in two sources is kept twice, one route per index", async () => {
    const dir = await tempDir("catalog-pipeline-dupe-");
    await writeTree(join(dir, "first"), WIRE_TREE);
    await writeTree(join(dir, "second"), { "p/acme/widget.json": CORP_WIDGET_ROOT });

    const catalog = await resolveCatalog(
      [pathSource("first", { root: true }), pathSource("second")],
      dir,
    );

    // Same `acme/widget` id from both indexes: the root source keeps the
    // bare route, the other one leads with its own index name. Equal ids
    // order by label, so `corp.example` precedes `ocx.sh`.
    expect(catalog.routes).toEqual([
      { segments: ["acme", "tools", "gadget"], namespace: "acme", package: "tools/gadget", wireBase: "" },
      {
        segments: ["corp.example", "acme", "widget"],
        namespace: "acme",
        package: "widget",
        wireBase: "index/corp.example",
      },
      { segments: ["acme", "widget"], namespace: "acme", package: "widget", wireBase: "" },
    ]);
    expect(catalog.sources.map((source) => source.label)).toEqual(["ocx.sh", "corp.example"]);

    // Both copies reach the grid, and the per-index counts add up.
    const parsed = JSON.parse(catalog.catalogJson) as {
      indexes: { name: string; root: boolean; count: number }[];
      packages: unknown[];
    };
    expect(parsed.packages).toHaveLength(3);
    expect(parsed.indexes).toEqual([
      { name: "ocx.sh", root: true, default: true, count: 2 },
      { name: "corp.example", root: false, default: false, count: 1 },
    ]);
  });
  // The `indexes` envelope answers two questions that used to be one boolean:
  // where a source's tree is MIRRORED (`root`, which decides route shape) and
  // which index the catalog OPENS on (`default`). A deployment with no root
  // source at all — every route qualified, nothing at the site root — still
  // needs somewhere to land, which is the whole reason the second flag exists.
  it("default: true names the opening index without touching a single route", async () => {
    const dir = await tempDir("catalog-pipeline-default-noroot-");
    await writeTree(join(dir, "first"), WIRE_TREE);
    await writeTree(join(dir, "second"), { "p/beta/thing.json": CORP_BETA_ROOT });

    const catalog = await resolveCatalog(
      [pathSource("first"), pathSource("second", { default: true })],
      dir,
    );

    const parsed = JSON.parse(catalog.catalogJson) as {
      indexes: { name: string; root: boolean; default: boolean; count: number }[];
    };
    expect(parsed.indexes).toEqual([
      { name: "ocx.sh", root: false, default: false, count: 2 },
      { name: "corp.example", root: false, default: true, count: 1 },
    ]);
    // No source is root, so EVERY route stays qualified — the default index's
    // included. A preselected tab must never move a page's URL.
    expect(catalog.routes.map((route) => route.segments[0])).toEqual([
      "ocx.sh",
      "ocx.sh",
      "corp.example",
    ]);
  });

  // An explicit `default` overrides the root fallback rather than fighting
  // it: `root` still decides placement, `default` still decides preselection,
  // and they are simply different entries here.
  it("an explicit default wins over the root source's fallback claim", async () => {
    const dir = await tempDir("catalog-pipeline-default-vs-root-");
    await writeTree(join(dir, "first"), WIRE_TREE);
    await writeTree(join(dir, "second"), { "p/beta/thing.json": CORP_BETA_ROOT });

    const catalog = await resolveCatalog(
      [pathSource("first", { root: true }), pathSource("second", { default: true })],
      dir,
    );

    const parsed = JSON.parse(catalog.catalogJson) as {
      indexes: { name: string; root: boolean; default: boolean }[];
    };
    expect(parsed.indexes).toMatchObject([
      { name: "ocx.sh", root: true, default: false },
      { name: "corp.example", root: false, default: true },
    ]);
    // Placement is untouched: the root source keeps its bare routes.
    expect(catalog.routes.map((route) => route.segments[0])).toEqual([
      "acme",
      "acme",
      "corp.example",
    ]);
  });

  // Neither flag anywhere: no entry is default, and the theme opens on "all".
  it("with neither root nor default configured, no index is the default", async () => {
    const dir = await tempDir("catalog-pipeline-no-default-");
    await writeTree(join(dir, "first"), WIRE_TREE);
    await writeTree(join(dir, "second"), { "p/beta/thing.json": CORP_BETA_ROOT });

    const catalog = await resolveCatalog([pathSource("first"), pathSource("second")], dir);

    const parsed = JSON.parse(catalog.catalogJson) as { indexes: { default: boolean }[] };
    expect(parsed.indexes.some((entry) => entry.default)).toBe(false);
  });
});

describe("sources_pipeline resolveCatalog — url source", () => {
  interface FakeIndexServer {
    readonly url: string;
    close(): Promise<void>;
  }

  async function serveTree(files: Readonly<Record<string, Uint8Array>>): Promise<FakeIndexServer> {
    const server = createHttpServer((req, res) => {
      const body = files[(req.url ?? "/").replace(/^\//, "")];
      if (body === undefined) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end(Buffer.from(body));
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise((closed) => {
          server.closeAllConnections();
          server.close(() => closed());
        }),
    };
  }

  it("fetches a remote index and caches it OUTSIDE any scratch root (cross-build cache)", async () => {
    const server = await serveTree({
      "config.json": CONFIG_JSON,
      "c/index.json": utf8(
        JSON.stringify({ format_version: 1, packages: { "acme/widget": sha256Digest(WIDGET_ROOT) } }),
      ),
      "p/acme/widget.json": WIDGET_ROOT,
      [`p/acme/widget/o/sha256/${IMAGE_INDEX_HEX}.json`]: IMAGE_INDEX,
    });
    const expectedCacheDir = join(
      await cacheBaseDir(),
      "url",
      createHash("sha256").update(server.url).digest("hex").slice(0, 16),
    );
    cleanupDirs.push(expectedCacheDir);

    try {
      const catalog = await resolveCatalog([{ entry: { url: server.url }, label: "ocx.sh" }], process.cwd());

      // Non-root: the route leads with the index name, and wireBase points at
      // the `index/<label>/` tree the mirror writes.
      expect(catalog.routes).toEqual([
        {
          segments: ["ocx.sh", "acme", "widget"],
          namespace: "acme",
          package: "widget",
          wireBase: "index/ocx.sh",
        },
      ]);
      expect(catalog.sources[0]?.files.has("p/acme/widget.json")).toBe(true);
      // The cached enumeration lands in the consumer's node_modules cache,
      // which survives between builds — a scratch-root cache would be swept
      // at the end of every run and silently defeat the conditional GET.
      expect(await readdir(expectedCacheDir)).toContain("index.json");
    } finally {
      await server.close();
    }
  }, 20_000);

  it(
    "an unreachable url source maps to BuildError UNAVAILABLE naming the source",
    async () => {
      const deadPort = await findFreePort();
      const url = `http://127.0.0.1:${deadPort}`;
      cleanupDirs.push(join(await cacheBaseDir(), "url", createHash("sha256").update(url).digest("hex").slice(0, 16)));

      const error = await resolveCatalog([{ entry: { url }, label: "dead" }], process.cwd()).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).code).toBe("UNAVAILABLE");
      expect((error as BuildError).message).toContain("sources[0]");
      expect((error as BuildError).message).toContain(url);
    },
    30_000,
  );
});

describe("sources_pipeline resolveCatalog — git source", () => {
  it("clones a git source and renders its packages", async () => {
    const repo = await tempDir("catalog-pipeline-git-");
    await writeTree(repo, WIRE_TREE);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "wire tree"], { cwd: repo });

    const catalog = await resolveCatalog([{ entry: { git: repo }, label: "ocx.sh" }], process.cwd());

    expect(catalog.routes.map((route) => route.segments.join("/"))).toEqual([
      "ocx.sh/acme/tools/gadget",
      "ocx.sh/acme/widget",
    ]);
    expect(catalog.sources[0]?.label).toBe("ocx.sh");
  }, 30_000);
});

describe("sources_pipeline resolveCatalog — failures map to the CLI's exit codes", () => {
  it("malformed root JSON is DATA (exit 65) and names both the source and the file", async () => {
    const dir = await tempDir("catalog-pipeline-malformed-");
    await writeTree(join(dir, "index"), { "p/acme/widget.json": utf8("{ not json") });

    const error = await resolveCatalog([pathSource("index", { label: "ocx.sh" })], dir).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain("sources[0] (index)");
    expect((error as BuildError).message).toContain("p/acme/widget.json");
  });

  it("a git source that cannot be cloned is DATA, naming the repository", async () => {
    const dir = await tempDir("catalog-pipeline-badgit-");
    const missingRepo = join(dir, "no-such-repo");

    const error = await resolveCatalog([{ entry: { git: missingRepo }, label: "gone" }], dir).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain(`sources[0] (${missingRepo})`);
  }, 20_000);

  it("a source with no label and no package roots to derive one from is DATA", async () => {
    const dir = await tempDir("catalog-pipeline-empty-");
    await writeTree(join(dir, "index"), { "config.json": CONFIG_JSON });

    const error = await resolveCatalog([pathSource("index", { root: true })], dir).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain("zero package roots");
  });

  it("two sources resolving to the same final label is DATA, naming both indices", async () => {
    const dir = await tempDir("catalog-pipeline-conflict-");
    await writeTree(join(dir, "a"), WIRE_TREE);
    await writeTree(join(dir, "b"), WIRE_TREE);

    // Both derive "ocx.sh" from their own roots — the conflict `loadConfig`
    // structurally cannot see (it only ever compares EXPLICIT labels).
    const error = await resolveCatalog([pathSource("a", { root: true }), pathSource("b")], dir).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain("sources[0] and sources[1]");
  });

  it("a live tag whose image index is missing from the source is DATA", async () => {
    const dir = await tempDir("catalog-pipeline-dangling-");
    // The root references an image index digest, but its CAS blob is absent
    // — `catalogEntry` raises, and that must be exit 65, not a crash.
    await writeTree(join(dir, "index"), { "p/acme/widget.json": WIDGET_ROOT });

    const error = await resolveCatalog([pathSource("index", { label: "ocx.sh" })], dir).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).code).toBe("DATA");
    expect((error as BuildError).message).toContain("catalog:");
  });
});

describe("sources_pipeline emitCatalogTree", () => {
  it("writes the mirror tree, _headers, and the MERGED catalog last", async () => {
    const dir = await tempDir("catalog-pipeline-emit-");
    await writeTree(join(dir, "primary"), WIRE_TREE);
    await writeTree(join(dir, "extra"), { "p/beta/thing.json": CORP_BETA_ROOT });
    const outDir = join(dir, "out");

    const catalog = await resolveCatalog(
      [pathSource("primary", { root: true, label: "ocx.sh" }), pathSource("extra", { label: "corp.example" })],
      dir,
    );
    await emitCatalogTree(catalog, outDir);

    // C-006: the root source at the dist root, EVERY source under index/<label>/.
    expect(await readFile(join(outDir, "p", "acme", "widget.json"))).toEqual(Buffer.from(WIDGET_ROOT));
    expect(await readFile(join(outDir, "index", "ocx.sh", "p", "acme", "widget.json"))).toEqual(
      Buffer.from(WIDGET_ROOT),
    );
    expect(await readFile(join(outDir, "index", "corp.example", "p", "beta", "thing.json"))).toEqual(
      Buffer.from(CORP_BETA_ROOT),
    );

    const headers = await readFile(join(outDir, "_headers"), "utf8");
    expect(headers).toContain("/p/*");
    expect(headers).toContain("/index/ocx.sh/p/*");
    expect(headers).toContain("/index/corp.example/p/*");

    // `mirrorSources` writes the ROOT SOURCE's own catalog at this path
    // first; the merged one (all three packages) must be what survives.
    const written = await readFile(join(outDir, "data", "catalog", "catalog.json"), "utf8");
    expect(written).toBe(catalog.catalogJson);
    const parsed = JSON.parse(written) as { packages: { namespace: string; package: string }[] };
    expect(parsed.packages.map((entry) => `${entry.namespace}/${entry.package}`)).toEqual([
      "acme/tools/gadget",
      "acme/widget",
      "beta/thing",
    ]);
    // The per-source copy under index/<label>/ stays exactly as mirror.ts
    // wrote it — only the site-root one is the merged view.
    const perSource = JSON.parse(
      await readFile(join(outDir, "index", "corp.example", "data", "catalog", "catalog.json"), "utf8"),
    ) as { packages: unknown[] };
    expect(perSource.packages).toHaveLength(1);
  });
});

describe("sources_pipeline warnToStderr", () => {
  it("surfaces a source reader's warning on stderr", () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      warnToStderr("submodules are not cloned: .gitmodules");
      expect(errSpy).toHaveBeenCalledWith("ocx-catalog: submodules are not cloned: .gitmodules\n");
    } finally {
      errSpy.mockRestore();
    }
  });
});
