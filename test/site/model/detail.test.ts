/**
 * `detailView` / `detailWire`: one small `DetailView` per route from the
 * route's `namespace`/`package`, status and supersession, the version table,
 * the per-tag releases the page swaps between, the install selectors, the
 * upstream notice and owner links from the owning source's template. Rows of
 * the 0.6.0 defect ledger (`.claude/artifacts/defects_ocx_theme_port.md`) are
 * named `D-xxx` in the test titles.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../../../src/config/types.js";
import { readDirectoryTree } from "../../../src/sources/path.js";
import { extractPackages } from "../../../src/sources/types.js";
import { detailView, detailWire, type DetailContext, type DetailWire } from "../../../src/site/model/detail.js";
import { siteModel } from "../../../src/site/model/index.js";
import { catalogEntry } from "../../../src/viewmodel/catalog.js";
import type { PackageRoute } from "../../../src/viewmodel/route.js";
import type {
  Catalog,
  CatalogEntry,
  CatalogIndexInfo,
  CatalogPackageRoot,
  CatalogSourcePackage,
  Status,
  TagEntry,
} from "../../../src/viewmodel/types.js";

const HEX = "a".repeat(64);
const DIGEST = `sha256:${HEX}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;
const THIRD_DIGEST = `sha256:${"c".repeat(64)}`;
const OBSERVED = "2026-01-01T00:00:00Z";
const YANK = { reason: "bad build", at: "2026-02-03T00:00:00Z" };

const FIXTURES = fileURLToPath(new URL("../../fixtures/site/", import.meta.url));

function tag(content = DIGEST, observed = OBSERVED, yanked: TagEntry["yanked"] = null): TagEntry {
  return { content, observed, yanked };
}

function imageIndex(platforms: [string, string][], annotations?: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 2,
      manifests: platforms.map(([os, architecture]) => ({ platform: { os, architecture } })),
      ...(annotations === undefined ? {} : { annotations }),
    }),
  );
}

interface SourceOptions {
  readonly root?: Partial<CatalogPackageRoot>;
  readonly contentByDigest?: Readonly<Record<string, Uint8Array>>;
  readonly wireBase?: string;
}

/** A source package `acme/tool` of index `idx` with one `1.0.0` tag on linux/amd64. */
function source({ root = {}, contentByDigest, wireBase = "" }: SourceOptions = {}): CatalogSourcePackage {
  return {
    packageId: { namespace: "acme", package: "tool" },
    root: {
      name: "idx/acme/tool",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      repository: null,
      owners: [],
      source: null,
      upstream: null,
      created: "2026-01-01",
      desc: null,
      tags: { "1.0.0": tag() },
      ...root,
    },
    contentByDigest: contentByDigest ?? { [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]]) },
    wireBase,
  };
}

function route(overrides: Partial<PackageRoute> = {}): PackageRoute {
  return { segments: ["acme", "tool"], namespace: "acme", package: "tool", wireBase: "", ...overrides };
}

function entryOf(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { ...catalogEntry(source()), ...overrides };
}

function indexes(...items: Partial<CatalogIndexInfo>[]): CatalogIndexInfo[] {
  return items.map((item) => ({ name: "idx", root: true, default: true, excludeFromAll: false, count: 1, ...item }));
}

function context(overrides: Partial<DetailContext> = {}): DetailContext {
  const catalog: Catalog = { generated: null, indexes: indexes({}), packages: [] };
  return { catalog, base: "/", ...overrides };
}

/**
 * The view of `pkg` the way `siteModel` builds it: wire facts reduced by `detailWire`. The catalog
 * entry is strict about image indexes (it feeds `catalog.json`), so it reads `pkg` with a stub index
 * for every digest the test left out; `detailWire` reads `pkg` as given, which is the point of D-062.
 */
function viewOf(pkg: CatalogSourcePackage, overrides: Partial<DetailContext> = {}, entry: Partial<CatalogEntry> = {}) {
  const stubs = Object.fromEntries(Object.values(pkg.root.tags).map(({ content }) => [`${content}.json`, imageIndex([])]));
  const entryPkg = { ...pkg, contentByDigest: { ...stubs, ...pkg.contentByDigest } };
  return detailView(route(), { ...catalogEntry(entryPkg), ...entry }, context({ wire: detailWire(pkg), ...overrides }));
}

const emptyWire: DetailWire = {
  owners: [],
  descTitle: null,
  source: null,
  upstream: null,
  repository: null,
  versions: { rows: [], tracks: [], unknownTags: [] },
  tagTotal: 0,
  releases: [],
  tagReleases: [],
};

describe("detailWire — facts reduced from one source package", () => {
  it("carries the owner logins, the root source and the title the source package holds", () => {
    const wire = detailWire(
      source({
        root: {
          owners: ["alice", "bob"],
          source: "https://github.com/from/root",
          desc: { title: "Tool", description: "d", keywords: [], readme: null, logo: null },
        },
      }),
    );

    expect(wire).toMatchObject({ owners: ["alice", "bob"], source: "https://github.com/from/root", descTitle: "Tool", tagTotal: 1 });
    expect(detailWire(source()).descTitle).toBeNull();
  });

  it("D-053: reduces every tag to the version table, yanked included, with no digest in it", () => {
    const wire = detailWire(
      source({
        root: { tags: { latest: tag(DIGEST), "1.0.0": tag(DIGEST), "0.9.0": tag(OTHER_DIGEST, OBSERVED, YANK) } },
        contentByDigest: {},
      }),
    );

    expect(wire.tagTotal).toBe(3);
    expect(wire.versions.rows[0]?.primaryTag).toBe("latest");
    expect(JSON.stringify(wire.versions)).not.toContain("sha256");
  });

  it("D-059: one release per distinct image index, shared by every tag that points at it", () => {
    const pkg = source({
      root: { tags: { latest: tag(DIGEST), "1.0.0": tag(DIGEST), "2.0.0": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]], { "org.opencontainers.image.licenses": "GPL-3.0" }),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "arm64"], ["darwin", "arm64"]], {
          "org.opencontainers.image.licenses": "MIT OR Apache-2.0",
          "org.opencontainers.image.source": "https://github.com/acme/tool",
          "org.opencontainers.image.revision": "9e8a183",
        }),
      },
    });

    const wire = detailWire(pkg);

    expect(wire.releases).toEqual([
      { platforms: ["linux/amd64"], license: "GPL-3.0", source: null, revision: null },
      {
        platforms: ["darwin/arm64", "linux/arm64"],
        license: "MIT OR Apache-2.0",
        source: "https://github.com/acme/tool",
        revision: "9e8a183",
      },
    ]);
    expect(wire.tagReleases).toEqual([["latest", 0], ["1.0.0", 0], ["2.0.0", 1]]);
  });

  it("D-060: two digests with identical facts share one release", () => {
    const pkg = source({
      root: { tags: { "1.0.0": tag(DIGEST), "1.0.1": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]]),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "amd64"]]),
      },
    });

    expect(detailWire(pkg).releases).toHaveLength(1);
  });

  it("D-072: reads a platform-agnostic tag and drops attestation descriptors", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        manifests: [
          { platform: { os: "any", architecture: "any" } },
          { digest: "sha256:att" },
          { platform: { os: "unknown", architecture: "unknown" } },
        ],
      }),
    );

    expect(detailWire(source({ contentByDigest: { [`${DIGEST}.json`]: bytes } })).releases[0]?.platforms).toEqual(["any/any"]);
  });

  it.each([
    ["a missing image index", {}],
    ["an unparseable image index", { [`${DIGEST}.json`]: new TextEncoder().encode("{not json") }],
    ["manifests that is not a list", { [`${DIGEST}.json`]: new TextEncoder().encode('{"manifests":{"a":1}}') }],
    ["a platform entry without os", { [`${DIGEST}.json`]: new TextEncoder().encode('{"manifests":[{"platform":{"architecture":"amd64"}}]}') }],
  ])("D-062: %s costs the tag its facts, never the build", (_label, contentByDigest) => {
    const wire = detailWire(source({ contentByDigest }));

    expect(wire.releases).toEqual([{ platforms: [], license: null, source: null, revision: null }]);
    expect(wire.tagTotal).toBe(1);
  });

  it("D-062: malformed annotations lose the annotations, not the platforms", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ manifests: [{ platform: { os: "linux", architecture: "amd64" } }], annotations: { "org.opencontainers.image.licenses": 5 } }),
    );

    expect(detailWire(source({ contentByDigest: { [`${DIGEST}.json`]: bytes } })).releases).toEqual([
      { platforms: ["linux/amd64"], license: null, source: null, revision: null },
    ]);
  });

  it.each([["null", "null"], ["a number", "7"], ["a list", "[]"]])("D-062: an image index that parses to %s is no image index", (_label, json) => {
    const bytes = new TextEncoder().encode(json);

    expect(detailWire(source({ contentByDigest: { [`${DIGEST}.json`]: bytes } })).releases).toEqual([
      { platforms: [], license: null, source: null, revision: null },
    ]);
  });

  it("D-062: a non-object annotations value is tolerated too", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ manifests: [], annotations: [1] }));

    expect(detailWire(source({ contentByDigest: { [`${DIGEST}.json`]: bytes } })).releases[0]).toMatchObject({ license: null });
  });

  it("a package with no tags has nothing to show", () => {
    expect(detailWire(source({ root: { tags: {} } }))).toMatchObject({ tagTotal: 0, releases: [], tagReleases: [] });
  });

  it("D-050: carries the upstream object as the source package holds it", () => {
    const upstream = { org: "sharkdp", repositoryUrl: "https://github.com/sharkdp/bat", disclaimer: "Unaffiliated." };

    expect(detailWire(source({ root: { upstream } })).upstream).toEqual(upstream);
  });
});

describe("detailView — the registry row (D-052)", () => {
  const registryOf = (repository: string | null) => viewOf(source({ root: { repository } })).registry;

  it("D-052: carries the physical repository as written and the address to copy without the oci:// scheme", () => {
    expect(registryOf("oci://ghcr.io/ocx-sh/bat")).toEqual({ display: "oci://ghcr.io/ocx-sh/bat", address: "ghcr.io/ocx-sh/bat" });
  });

  it("D-052: a repository without the scheme copies as it is; only a leading oci:// is dropped", () => {
    expect(registryOf("ghcr.io/ocx-sh/bat")).toEqual({ display: "ghcr.io/ocx-sh/bat", address: "ghcr.io/ocx-sh/bat" });
    expect(registryOf("example.com/oci://x")?.address).toBe("example.com/oci://x");
  });

  it("D-052: a package whose root names no repository, an empty one, or a route without wire facts has no row", () => {
    expect(registryOf(null)).toBeNull();
    expect(registryOf("")).toBeNull();
    expect(detailView(route(), entryOf(), context()).registry).toBeNull();
  });

  it("D-052: detailWire carries the root's repository for the view", () => {
    expect(detailWire(source({ root: { repository: "oci://ghcr.io/ocx-sh/bat" } })).repository).toBe("oci://ghcr.io/ocx-sh/bat");
  });
});

describe("detailView — identity and status (C-013)", () => {
  it("takes identity from the route's namespace/package, never the URL or the root name", () => {
    const view = detailView(
      route({ segments: ["b", "acme", "tool"], wireBase: "index/b" }),
      entryOf({ name: "ocx.sh/something/else" }),
      context({ base: "/catalog/" }),
    );

    expect(view.key).toBe("b/acme/tool");
    expect(view.namespace).toBe("acme");
    expect(view.package).toBe("tool");
    expect(view.name).toBe("ocx.sh/something/else");
  });

  it("D-152: a package directory with an unusual name still gets a view — the view builds no path from it", () => {
    const view = detailView(
      route({ segments: ["Odd NS", "My Pkg"], namespace: "Odd NS", package: "My Pkg" }),
      entryOf({ name: "idx/Odd NS/My Pkg" }),
      context(),
    );

    expect(view).toMatchObject({ key: "Odd NS/My Pkg", namespace: "Odd NS", package: "My Pkg", name: "idx/Odd NS/My Pkg" });
  });

  it.each<[Status, string | null]>([
    ["active", null],
    ["deprecated", "use the new one"],
    ["yanked", null],
  ])("carries status %s and its deprecation message", (status, deprecatedMessage) => {
    const view = detailView(route(), entryOf({ status, deprecatedMessage }), context());

    expect(view.status).toBe(status);
    expect(view.deprecatedMessage).toBe(deprecatedMessage);
  });

  it("D-066: an empty deprecation message is no message", () => {
    expect(detailView(route(), entryOf({ status: "deprecated", deprecatedMessage: "" }), context()).deprecatedMessage).toBeNull();
  });

  it("carries description and keywords from the entry", () => {
    const view = detailView(route(), entryOf({ description: "Does things", keywords: ["cli", "<b>"] }), context());

    expect(view).toMatchObject({ description: "Does things", keywords: ["cli", "<b>"] });
  });

  it("D-078: the title is the wire title, else the leaf of the name, never the qualified name", () => {
    const withTitle = source({
      root: { desc: { title: "The Tool", description: "", keywords: [], readme: null, logo: null } },
    });

    expect(viewOf(withTitle).title).toBe("The Tool");
    expect(viewOf(source()).title).toBe("tool");
    expect(detailView(route({ package: "lib/core" }), entryOf({ title: "idx/acme/lib/core" }), context({ wire: emptyWire })).title).toBe("core");
    expect(detailView(route(), entryOf({ title: "Entry Title" }), context()).title).toBe("Entry Title");
  });

  it("D-079: a package without a wire carries the entry's tag count and no table", () => {
    const view = detailView(route(), entryOf({ tagCount: 7 }), context());

    expect(view.tagCount).toBe(7);
    expect(view.versions).toEqual({ rows: [], tracks: [], unknownTags: [] });
    expect(view.install).toEqual([]);
    expect(view.initialTag).toBeNull();
  });

  it("D-079: the tag count is every tag the wire lists, yanked included", () => {
    const pkg = source({ root: { tags: { "1.0.0": tag(), "0.9.0": tag(DIGEST, OBSERVED, YANK) } } });

    expect(viewOf(pkg).tagCount).toBe(2);
  });
});

describe("detailView — the latest version chip (D-075, D-076)", () => {
  it("D-076: names the most precise alias of a live latest", () => {
    const pkg = source({ root: { tags: { latest: tag(), "1": tag(), "1.2": tag(), "1.2.3": tag() } } });

    expect(viewOf(pkg).latestVersion).toBe("1.2.3");
  });

  it("D-075: no live latest, no chip — a deprecated package's stray latest does not count", () => {
    const stray = source({ root: { status: "deprecated", tags: { latest: tag(), "1.0.0": tag() } } });

    expect(viewOf(stray).latestVersion).toBeNull();
    expect(viewOf(source({ root: { tags: {} } })).latestVersion).toBeNull();
    expect(viewOf(source({ root: { tags: { latest: tag(DIGEST, OBSERVED, YANK) } } })).latestVersion).toBeNull();
  });
});

describe("detailView — upstream (D-050, D-051, D-063)", () => {
  const withUpstream = (upstream: { org: string; repositoryUrl: string | null; disclaimer: string | null } | null) =>
    viewOf(source({ root: { upstream } })).upstream;

  it("D-050: carries the disclaimer, the org and the repository link", () => {
    expect(withUpstream({ org: "sharkdp", repositoryUrl: "https://github.com/sharkdp/bat", disclaimer: "Unaffiliated mirror." })).toEqual({
      org: "sharkdp",
      href: "https://github.com/sharkdp/bat",
      repository: "github.com/sharkdp/bat",
      disclaimer: "Unaffiliated mirror.",
    });
  });

  it("D-051: an upstream without a repository or a disclaimer keeps the org alone", () => {
    expect(withUpstream({ org: "sharkdp", repositoryUrl: null, disclaimer: null })).toEqual({
      org: "sharkdp",
      href: null,
      repository: null,
      disclaimer: null,
    });
    expect(withUpstream({ org: "o", repositoryUrl: "", disclaimer: "" })).toEqual({ org: "o", href: null, repository: null, disclaimer: null });
  });

  it("D-050: hostile upstream data stays inert — an unsafe repository is plain text, never a link", () => {
    const upstream = withUpstream({ org: "<img src=x onerror=alert(1)>", repositoryUrl: "javascript:alert(1)", disclaimer: "</script>" });

    expect(upstream?.href).toBeNull();
    expect(upstream?.repository).toBe("javascript:alert(1)");
    expect(upstream?.org).toBe("<img src=x onerror=alert(1)>");
  });

  it("a package with no upstream has none, and neither has a route without wire facts", () => {
    expect(withUpstream(null)).toBeNull();
    expect(detailView(route(), entryOf(), context()).upstream).toBeNull();
  });
});

describe("detailView — supersededBy (deprecation_banner_href)", () => {
  const deprecated = (supersededBy: string | null, name = "idx/acme/tool"): CatalogEntry =>
    entryOf({ name, status: "deprecated", supersededBy });

  it("links a safe bare ns/pkg through packageHref, in the same index, under base", () => {
    const root = detailView(route(), deprecated("acme/newer"), context({ base: "/catalog/" }));
    expect(root.supersededBy).toBe("acme/newer");
    expect(root.supersededByHref).toBe("/catalog/acme/newer/");

    const catalog: Catalog = { generated: null, indexes: indexes({ name: "a" }, { name: "b", root: false, default: false }), packages: [] };
    const other = detailView(route(), deprecated("acme/newer", "b/acme/tool"), context({ catalog, base: "/catalog/" }));
    expect(other.supersededByHref).toBe("/catalog/b/acme/newer/");
  });

  it("links a depth-N superseding package", () => {
    expect(detailView(route(), deprecated("acme/lib/core"), context()).supersededByHref).toBe("/acme/lib/core/");
  });

  it.each([
    ["a backslash open redirect", "\\evil.com/x"],
    ["an escaping dot segment", "acme/../../evil"],
    ["an embedded slash-slash", "acme//evil"],
    ["a quote and whitespace", 'x" onmouseover="alert(1)'],
    ["no slash at all", "justonename"],
    ["an uppercase namespace", "ACME/tool"],
  ])("renders %s as plain text, never a link", (_label, supersededBy) => {
    const view = detailView(route(), deprecated(supersededBy), context());

    expect(view.supersededBy).toBe(supersededBy);
    expect(view.supersededByHref).toBeNull();
  });

  it("has no supersession when none is set", () => {
    const view = detailView(route(), deprecated(null), context());

    expect(view.supersededBy).toBeNull();
    expect(view.supersededByHref).toBeNull();
  });
});

describe("detailView — releases, platforms and annotations (D-060, D-061, D-072)", () => {
  const twoReleases = () =>
    source({
      root: { tags: { latest: tag(DIGEST), "1.0.0": tag(DIGEST), "0.9.0": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"], ["linux", "arm64"]], {
          "org.opencontainers.image.licenses": "MIT",
          "org.opencontainers.image.source": "https://github.com/acme/tool",
          "org.opencontainers.image.revision": "9e8a183",
        }),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "amd64"]]),
      },
    });

  it("D-060: each tag maps to its release; releases index shared platform sets", () => {
    const view = viewOf(twoReleases());

    expect(view.tagReleases).toEqual([["latest", 0], ["1.0.0", 0], ["0.9.0", 1]]);
    expect(view.platformSets).toEqual([["linux/amd64", "linux/arm64"], ["linux/amd64"]]);
    expect(view.releases).toEqual([
      { platformSet: 0, license: "MIT", sourceHref: "https://github.com/acme/tool", revision: "9e8a183" },
      { platformSet: 1, license: null, sourceHref: null, revision: null },
    ]);
    expect(view.initialRelease).toBe(0);
  });

  it("D-061: the platform sets are shared between releases with the same platforms", () => {
    const pkg = source({
      root: { tags: { "1.0.0": tag(DIGEST), "1.1.0": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]], { "org.opencontainers.image.licenses": "MIT" }),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "amd64"]], { "org.opencontainers.image.licenses": "Apache-2.0" }),
      },
    });

    const view = viewOf(pkg);

    expect(view.platformSets).toEqual([["linux/amd64"]]);
    expect(view.releases.map((r) => r.platformSet)).toEqual([0, 0]);
  });

  it("the root's own `source` wins over the annotation, which only backfills it", () => {
    const pkg = twoReleases();
    const rooted = { ...pkg, root: { ...pkg.root, source: "https://github.com/from/root" } };

    expect(viewOf(rooted).releases.map((r) => r.sourceHref)).toEqual(["https://github.com/from/root", "https://github.com/from/root"]);
    expect(viewOf(pkg).releases.map((r) => r.sourceHref)).toEqual(["https://github.com/acme/tool", null]);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "ftp://host/x", "/relative", "not a url", ""])(
    "drops a source that is not an absolute http(s) URL: %j",
    (src) => {
      const view = viewOf(source({ root: { source: src } }));

      expect(view.releases.map((r) => r.sourceHref)).toEqual([null]);
    },
  );

  it("D-062: a package whose image index is missing still builds, with an empty release", () => {
    const view = viewOf(source({ contentByDigest: {} }));

    expect(view.platformSets).toEqual([[]]);
    expect(view.releases).toEqual([{ platformSet: 0, license: null, sourceHref: null, revision: null }]);
    expect(view.install.length).toBeGreaterThan(0);
  });

  it("a primary tag the wire carries no release for opens on no release", () => {
    const wire = detailWire(source({ root: { tags: { latest: tag() } } }));

    const view = detailView(route(), entryOf(), context({ wire: { ...wire, tagReleases: [] } }));

    expect(view).toMatchObject({ initialTag: "latest", initialRelease: null });
  });

  it("a route without wire facts has no releases and opens on no release", () => {
    const view = detailView(route(), entryOf(), context());

    expect(view).toMatchObject({ releases: [], platformSets: [], tagReleases: [], initialRelease: null });
  });
});

describe("detailView — the install card (D-058, D-059, D-090, D-171)", () => {
  const rowCommands = (view: ReturnType<typeof viewOf>) => view.install.map((row) => row.command);

  it("renders every flavor for a live latest, the bare qualified name", () => {
    const view = viewOf(source({ root: { tags: { latest: tag() } } }));

    expect(rowCommands(view)).toEqual([
      "ocx add idx/acme/tool",
      "ocx --global add idx/acme/tool",
      "ocx package exec idx/acme/tool",
      "ocx package install idx/acme/tool",
    ]);
    expect(view.install.map((row) => row.label)).toEqual(["Add to project", "Add globally", "Run without installing", "Install package"]);
    expect(view.install.map((row) => row.icon)).toEqual(["project", "global", "exec", "install"]);
    expect(view.install.every((row) => row.template.includes("{name}"))).toBe(true);
    expect(view.initialTag).toBe("latest");
  });

  it("D-058: names name:tag when latest is not live; a deprecated package's stray latest does not count", () => {
    const view = viewOf(source({ root: { status: "deprecated", tags: { latest: tag(), "1.0.0": tag(OTHER_DIGEST) } }, contentByDigest: {} }));

    expect(view.initialTag).toBe("1.0.0");
    expect(rowCommands(view)[0]).toBe("ocx add idx/acme/tool:1.0.0");
  });

  it("D-059: offers the alias chain as options, the deepest labelled pinned", () => {
    const view = viewOf(source({ root: { tags: { latest: tag(), "1": tag(), "1.2": tag(), "1.2.3": tag() } } }));

    expect(view.installVariants).toHaveLength(1);
    expect(view.installVariants[0]).toMatchObject({ variant: null, label: "default", primaryTag: "latest" });
    expect(view.installVariants[0]?.options.map((o) => [o.tag, o.label])).toEqual([
      ["latest", "latest"],
      ["1", "major"],
      ["1.2", "minor"],
      ["1.2.3", "pinned"],
    ]);
  });

  it("the Pin picker never offers a pre-release, a build track or an ephemeral tag at a stable level", () => {
    const view = viewOf(
      source({
        root: {
          tags: {
            latest: tag(), "1": tag(), "1.2": tag(), "1.2.3": tag(),
            "1.2.4": { ...tag(), ephemeral: true },
            "2.0.0-rc.1": tag(), mr11_20261021T090000Z: { ...tag(), ephemeral: true },
          },
        },
      }),
    );

    expect(view.installVariants[0]?.options.map((o) => o.tag)).toEqual(["latest", "1", "1.2", "1.2.3"]);
    expect(view.versions.tracks.map((track) => track.key)).toEqual(["2.0.0-rc", "mr11"]);
  });

  it("D-090: a variant-only package installs its first variant's primary tag", () => {
    const view = viewOf(source({ root: { tags: { "slim-1.0.0": tag(), slim: tag() } } }));

    expect(view.initialTag).toBe("slim");
    expect(view.installVariants.map((v) => v.variant)).toEqual(["slim"]);
    expect(rowCommands(view)[0]).toBe("ocx add idx/acme/tool:slim");
  });

  it("D-059: every variant with a live tag is selectable; one without is not", () => {
    const view = viewOf(
      source({ root: { tags: { "1.0.0": tag(), "slim-1.0.0": tag(OTHER_DIGEST), "alpine-1.0.0": tag(THIRD_DIGEST, OBSERVED, YANK) } }, contentByDigest: {} }),
    );

    expect(view.installVariants.map((v) => v.variant)).toEqual([null, "slim"]);
    expect(view.versions.rows.map((row) => row.variant)).toEqual([null, "alpine", "slim"]);
  });

  it("a variant's yanked-only row neither opens the page nor offers a pick", () => {
    const view = viewOf(source({ root: { tags: { "alpine-1.0.0": tag(OTHER_DIGEST, OBSERVED, YANK), "1.0.0": tag() } }, contentByDigest: {} }));

    expect(view.initialTag).toBe("1.0.0");
  });

  it("D-054: a package whose every tag is yanked has nothing to install", () => {
    const view = viewOf(source({ root: { tags: { "1.0.0": tag(DIGEST, OBSERVED, YANK) } } }));

    expect(view).toMatchObject({ initialTag: null, initialRelease: null, install: [], installVariants: [] });
    expect(view.tagCount).toBe(1);
    expect(view.versions.rows[0]?.majorGroups).toHaveLength(1);
  });

  it("renders no install rows for a package with no tag", () => {
    expect(viewOf(source({ root: { tags: {} } })).install).toEqual([]);
    expect(detailView(route(), entryOf({ tagCount: 0 }), context()).install).toEqual([]);
  });
});

describe("detailView — the version table (D-053, D-054, D-057, D-076)", () => {
  it("D-054: a yanked tag stays in the tree with its record", () => {
    const view = viewOf(source({ root: { tags: { latest: tag(), "1.0.0": tag(), "0.9.0": tag(DIGEST, OBSERVED, YANK) } } }));
    const patches = view.versions.rows[0]?.majorGroups.flatMap((m) => m.minorGroups.flatMap((minor) => minor.patches)) ?? [];

    expect(patches.find((p) => p.tag === "0.9.0")?.yanked).toEqual(YANK);
    expect(view.tagReleases.map(([name]) => name)).toContain("0.9.0");
  });

  it("D-057: tags outside the version grammar are listed as other", () => {
    expect(viewOf(source({ root: { tags: { nightly: tag(), "1.0.0": tag() } } })).versions.unknownTags).toEqual([{ tag: "nightly", yanked: null, ephemeral: false }]);
  });

  it("D-079: no tag is dropped — every one of a 25-tag package is in the tree", () => {
    const tags = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`1.${i}.0`, tag()]));
    const view = viewOf(source({ root: { tags } }));

    expect(view.tagCount).toBe(25);
    expect(view.tagReleases).toHaveLength(25);
  });
});



describe("detailView — owners (owner_url, S-003)", () => {
  const owned = (...owners: string[]): DetailContext["wire"] => ({ ...emptyWire, owners });

  it("falls back to the GitHub default when no template is set anywhere", () => {
    const view = detailView(route(), entryOf(), context({ wire: owned("ocx-sh") }));

    expect(view.owners).toEqual([{ login: "ocx-sh", href: "https://github.com/ocx-sh" }]);
  });

  it("uses the top-level ownerUrl template", () => {
    const view = detailView(route(), entryOf(), context({ ownerUrl: "https://gitlab.com/{login}", wire: owned("alice", "bob") }));

    expect(view.owners.map((owner) => owner.href)).toEqual(["https://gitlab.com/alice", "https://gitlab.com/bob"]);
  });

  it("lets the owning source's template win over the top-level one", () => {
    const view = detailView(
      route({ ownerUrl: "https://gitlab.corp.example/{login}" }),
      entryOf(),
      context({ ownerUrl: "https://github.com/{login}", wire: owned("alice") }),
    );

    expect(view.owners[0]?.href).toBe("https://gitlab.corp.example/alice");
  });

  it("applies a source's template even with no top-level ownerUrl", () => {
    const view = detailView(route({ ownerUrl: "https://gitlab.com/{login}" }), entryOf(), context({ wire: owned("bob") }));

    expect(view.owners[0]?.href).toBe("https://gitlab.com/bob");
  });

  it("encodes a hostile login into the template instead of splicing it raw", () => {
    const view = detailView(route(), entryOf(), context({ ownerUrl: "https://gitlab.com/{login}", wire: owned("a/../b?x=$&") }));

    expect(view.owners[0]?.href).toBe("https://gitlab.com/a%2F..%2Fb%3Fx%3D%24%26");
  });

  it("renders plain text (href null) when the template is not an http(s) URL", () => {
    const view = detailView(route(), entryOf(), context({ ownerUrl: "javascript:alert('{login}')", wire: owned("alice") }));

    expect(view.owners).toEqual([{ login: "alice", href: null }]);
  });

  it("renders plain text when the login cannot form a valid URL in the source's template", () => {
    const view = detailView(
      route({ ownerUrl: 'https://{login}.forge.test/u?next="><img src=x onerror=alert(1)>' }),
      entryOf(),
      context({ wire: owned("not/a-host", "ok") }),
    );

    expect(view.owners[0]).toEqual({ login: "not/a-host", href: null });
    expect(view.owners[1]?.login).toBe("ok");
  });

  it("has no owners when the wire lists none", () => {
    expect(detailView(route(), entryOf(), context({ wire: emptyWire })).owners).toEqual([]);
  });
});

describe("detailView — the logo (C-008, C-039)", () => {
  it("joins the catalog-root-relative logo onto base, and keeps a missing logo null", () => {
    const logo = `/index/b/p/acme/tool/o/sha256/${HEX}.svg`;

    expect(detailView(route(), entryOf({ logoUrl: logo }), context({ base: "/catalog/" })).logoUrl).toBe(`/catalog${logo}`);
    expect(detailView(route(), entryOf({ logoUrl: null }), context()).logoUrl).toBeNull();
  });
});

describe("detailView — the view stays small (C-047, D-167)", () => {
  it("D-167: carries no wire-root URL, wire root, image index, digest, manifest or README", () => {
    const pkg = source({ root: { tags: { latest: tag(), "1.0.0": tag(OTHER_DIGEST) } }, contentByDigest: {} });
    const json = JSON.stringify(viewOf(pkg));

    expect(json).not.toContain("sha256:");
    for (const key of ["readme", "wireRoot", "manifests", "imageIndex", "rootUrl"]) expect(json).not.toContain(`"${key}"`);
  });
});

describe("detailView over the committed site fixtures", () => {
  async function fixturePackage(index: string, id: string): Promise<CatalogSourcePackage> {
    const files = await readDirectoryTree(`${FIXTURES}${index}`);
    const found = extractPackages(files).find((pkg) => `${pkg.packageId.namespace}/${pkg.packageId.package}` === id);
    if (found === undefined) throw new Error(`fixture ${index}/${id} missing`);
    return found;
  }

  it("tools/many-tags: all 25 tags are in the view, with licence, source and owner", async () => {
    const pkg = await fixturePackage("index-a", "tools/many-tags");
    const view = detailView(
      route({ namespace: "tools", package: "many-tags", segments: ["tools", "many-tags"] }),
      catalogEntry(pkg),
      context({ base: "/catalog/", ownerUrl: "https://forge.example/{login}", wire: detailWire(pkg) }),
    );

    expect(view.tagCount).toBe(25);
    expect(view.tagReleases).toHaveLength(25);
    expect(view.releases[0]?.license).toBe("MIT");
    expect(view.releases[0]?.sourceHref).toBe("https://github.com/ocx-contrib/tools-many-tags");
    expect(view.owners).toEqual([{ login: "ocx-bot", href: "https://forge.example/ocx-bot" }]);
    expect(view.versions.rows[0]?.primaryTag).toBe("latest");
  });

  it("D-050: sharkdp/bat carries its upstream disclaimer to the view", async () => {
    const pkg = await fixturePackage("index-a", "sharkdp/bat");
    const view = detailView(route({ namespace: "sharkdp", package: "bat", segments: ["sharkdp", "bat"] }), catalogEntry(pkg), context({ wire: detailWire(pkg) }));

    expect(view.upstream).toEqual({
      org: "sharkdp",
      href: "https://github.com/sharkdp/bat",
      repository: "github.com/sharkdp/bat",
      disclaimer: "Unaffiliated mirror of the upstream sharkdp/bat project.",
    });
  });

  it("D-054: tools/flaky keeps its yanked tag in the tree", async () => {
    const pkg = await fixturePackage("index-a", "tools/flaky");
    const view = detailView(route({ namespace: "tools", package: "flaky", segments: ["tools", "flaky"] }), catalogEntry(pkg), context({ wire: detailWire(pkg) }));
    const all = view.versions.rows.flatMap((row) => [...row.aliasChain, ...row.yankedRolling, ...row.majorGroups.flatMap((m) => m.minorGroups.flatMap((minor) => minor.patches))]);

    expect(all.some((t) => t.yanked !== null)).toBe(true);
  });

  it("legacy/oldtool: a deprecated package's stray latest is not the install target", async () => {
    const pkg = await fixturePackage("index-a", "legacy/oldtool");
    const view = detailView(route({ namespace: "legacy", package: "oldtool", segments: ["legacy", "oldtool"] }), catalogEntry(pkg), context({ wire: detailWire(pkg) }));

    expect(view.status).toBe("deprecated");
    expect(view.latestVersion).toBeNull();
    expect(view.initialTag).not.toBe("latest");
  });

  it("hostile/ownerlink: the owner whose login cannot form a profile URL is plain text", async () => {
    const pkg = await fixturePackage("index-b", "hostile/ownerlink");
    const view = detailView(
      route({ namespace: "hostile", package: "ownerlink", segments: ["index-b", "hostile", "ownerlink"], wireBase: "index/index-b", ownerUrl: 'https://{login}.forge.test/u?next="><img src=x onerror=alert(1)>' }),
      catalogEntry(pkg),
      context({ wire: detailWire(pkg) }),
    );

    expect(view.owners).toEqual([{ login: "not/a-host", href: null }]);
  });

  it("hostile/metadata: hostile owner, deprecation, supersession and upstream text stays inert data", async () => {
    const pkg = await fixturePackage("index-b", "hostile/metadata");
    const view = detailView(
      route({ namespace: "hostile", package: "metadata", segments: ["index-b", "hostile", "metadata"], wireBase: "index/index-b" }),
      catalogEntry(pkg),
      context({ wire: detailWire(pkg) }),
    );

    expect(view.status).toBe("deprecated");
    expect(view.supersededByHref).toBeNull();
    expect(view.supersededBy).toContain("onmouseover");
    expect(view.upstream?.href).toBeNull();
    expect(view.upstream?.disclaimer).toContain("onmouseover");
    expect(view.owners.map((owner) => owner.href)).toEqual(["https://github.com/%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "https://github.com/ocx-bot"]);
  });
});

describe("siteModel carries the wire facts into the detail views (entrypoint)", () => {
  const loaded = (ownerUrl?: string): LoadedConfig => ({
    config: { sources: [], brand: { title: "Mirror" }, base: "/catalog/", ...(ownerUrl === undefined ? {} : { ownerUrl }) },
    configDir: "/cfg",
    sources: [],
  });

  it("flows wire facts, the top-level ownerUrl and the route's own ownerUrl through siteModel", () => {
    const rootPkg = source({ root: { name: "idx/acme/tool", owners: ["alice"], upstream: { org: "acme", repositoryUrl: null, disclaimer: "Not affiliated." } } });
    const otherPkg = source({ root: { name: "b/acme/other", owners: ["bob"] }, wireBase: "index/b" });
    const catalog: Catalog = {
      generated: null,
      indexes: indexes({ name: "idx" }, { name: "b", root: false, default: false }),
      packages: [catalogEntry(rootPkg), { ...catalogEntry(otherPkg), package: "other" }],
    };
    const routes: PackageRoute[] = [
      route(),
      route({ segments: ["b", "acme", "other"], package: "other", wireBase: "index/b", ownerUrl: "https://gitlab.b.example/{login}" }),
    ];

    const model = siteModel(catalog, routes, loaded("https://forge.example/{login}"), [], {
      "acme/tool": detailWire(rootPkg),
      "b/acme/other": detailWire(otherPkg),
    });

    expect(model.details["acme/tool"]?.owners).toEqual([{ login: "alice", href: "https://forge.example/alice" }]);
    expect(model.details["b/acme/other"]?.owners).toEqual([{ login: "bob", href: "https://gitlab.b.example/bob" }]);
    expect(model.details["acme/tool"]?.upstream?.disclaimer).toBe("Not affiliated.");
    expect(model.details["acme/tool"]?.initialTag).toBe("1.0.0");
  });

  it("a route without wire facts renders the catalog entry's data only", () => {
    const pkg = source();
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [catalogEntry(pkg)] };

    const view = siteModel(catalog, [route()], loaded()).details["acme/tool"];

    expect(view?.owners).toEqual([]);
    expect(view?.releases).toEqual([]);
    expect(view?.tagCount).toBe(1);
  });

  it("refuses a route that has no catalog entry", () => {
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [] };

    expect(() => siteModel(catalog, [route()], loaded())).toThrow("route acme/tool has no catalog entry");
  });

  it("defaults to base `/` when the config sets none: the logo URL starts /p/, never //p/", () => {
    const pkg = source();
    const logo = `/p/acme/tool/o/sha256/${HEX}.svg`;
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [{ ...catalogEntry(pkg), logoUrl: logo }] };
    const noBase: LoadedConfig = { config: { sources: [], brand: { title: "Mirror" } }, configDir: "/cfg", sources: [] };

    expect(siteModel(catalog, [route()], noBase).details["acme/tool"]?.logoUrl).toBe(logo);
  });
});
