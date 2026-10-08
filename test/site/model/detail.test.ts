/**
 * `detailView` / `detailWire` (P-detail T.3; C-008, C-013, C-016, C-031,
 * C-039, S-003, S-007): one small `DetailView` per route from the route's
 * `namespace`/`package`, status and supersession, install rows, the latest
 * tag's licence/source/revision/platforms, owner links from the owning
 * source's template, the newest 20 tags, and base-joined wire URLs. Ported
 * model-behaviour assertions from `owner_url_wiring`,
 * `deprecation_banner_href_wiring`, `detail_page_annotations_wiring`,
 * `detail_page_wire_base_wiring` and `yanked_status_wiring`.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../../../src/config/types.js";
import { readDirectoryTree } from "../../../src/sources/path.js";
import { extractPackages } from "../../../src/sources/types.js";
import { detailView, detailWire, SSR_TAG_LIMIT, type DetailContext, type DetailWire } from "../../../src/site/model/detail.js";
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
const OBSERVED = "2026-01-01T00:00:00Z";

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

const emptyWire: DetailWire = { owners: [], tags: [], source: null, license: null, revision: null, platforms: [] };

describe("detailWire — facts reduced from one source package", () => {
  it("reads the latest version's image index, not the package-wide union", () => {
    const pkg = source({
      root: { tags: { "1.0.0": tag(DIGEST), "2.0.0": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]], { "org.opencontainers.image.licenses": "GPL-3.0" }),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "arm64"]], {
          "org.opencontainers.image.licenses": "MIT OR Apache-2.0",
          "org.opencontainers.image.source": "https://github.com/acme/tool",
          "org.opencontainers.image.revision": "9e8a183",
        }),
      },
    });

    expect(catalogEntry(pkg).platforms).toEqual(["linux/amd64", "linux/arm64"]);
    expect(detailWire(pkg)).toMatchObject({
      platforms: ["linux/arm64"],
      license: "MIT OR Apache-2.0",
      source: "https://github.com/acme/tool",
      revision: "9e8a183",
    });
  });

  it("takes the root's own `source` over the annotation, which only backfills it", () => {
    const annotations = { "org.opencontainers.image.source": "https://github.com/from/annotation" };
    const contentByDigest = { [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]], annotations) };

    expect(detailWire(source({ contentByDigest, root: { source: "https://github.com/from/root" } })).source).toBe(
      "https://github.com/from/root",
    );
    expect(detailWire(source({ contentByDigest })).source).toBe("https://github.com/from/annotation");
  });

  it("reports absent annotations as null, never fabricated", () => {
    expect(detailWire(source())).toMatchObject({ license: null, revision: null, source: null });
  });

  it("falls back to the `latest` tag when no plain version exists", () => {
    const pkg = source({ root: { tags: { latest: tag(OTHER_DIGEST) } }, contentByDigest: { [`${OTHER_DIGEST}.json`]: imageIndex([["darwin", "arm64"]]) } });

    expect(detailWire(pkg).platforms).toEqual(["darwin/arm64"]);
  });

  it("with no live latest tag takes the package-wide platform union and no annotations", () => {
    const pkg = source({
      root: { tags: { "1.0.0": tag(DIGEST, OBSERVED, { reason: "bad", at: OBSERVED }), "beta-1.0.0": tag(OTHER_DIGEST) } },
      contentByDigest: {
        [`${DIGEST}.json`]: imageIndex([["linux", "amd64"]]),
        [`${OTHER_DIGEST}.json`]: imageIndex([["linux", "arm64"]]),
      },
    });

    expect(detailWire(pkg)).toMatchObject({ platforms: ["linux/arm64"], license: null, revision: null, tags: ["beta-1.0.0"] });
  });

  it("a package with no tags has nothing to show", () => {
    expect(detailWire(source({ root: { tags: {} } }))).toMatchObject({ tags: [], platforms: [] });
  });

  it("throws, naming the digest, when the latest tag's image index is missing", () => {
    expect(() => detailWire(source({ contentByDigest: {} }))).toThrow(DIGEST);
  });

  it("lists live tags newest observation first, ties by descending numeric version, yanked excluded", () => {
    const pkg = source({
      root: {
        tags: {
          "1.0.0": tag(DIGEST, "2026-01-01T00:00:00Z"),
          "2.0.0": tag(DIGEST, "2026-02-01T00:00:00Z"),
          "10.0.0": tag(DIGEST, "2026-02-01T00:00:00Z"),
          "3.0.0": tag(DIGEST, "2026-03-01T00:00:00Z", { reason: "bad", at: "2026-03-02T00:00:00Z" }),
        },
      },
    });

    expect(detailWire(pkg).tags).toEqual(["10.0.0", "2.0.0", "1.0.0"]);
  });

  it("carries the owner logins the source package holds", () => {
    expect(detailWire(source({ root: { owners: ["alice", "bob"] } })).owners).toEqual(["alice", "bob"]);
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
    expect(view.rootUrl).toBe("/catalog/index/b/p/acme/tool.json");
  });

  it("refuses a route whose wire identity is not a safe package path", () => {
    expect(() => detailView(route({ package: "../../evil" }), entryOf(), context())).toThrow(/malformed package segment/);
    expect(() => detailView(route({ namespace: "a/b" }), entryOf(), context())).toThrow(/malformed namespace segment/);
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

  it("carries title, description, latest version and tag count from the entry", () => {
    const view = detailView(
      route(),
      entryOf({ title: "Tool", description: "Does things", keywords: ["cli", "<b>"], latestVersion: "1.2.3", tagCount: 7 }),
      context(),
    );

    expect(view).toMatchObject({
      title: "Tool",
      description: "Does things",
      keywords: ["cli", "<b>"],
      latestVersion: "1.2.3",
      tagCount: 7,
    });
  });

  it("uses the supplied wire platforms, else the entry's own union", () => {
    const entry = entryOf({ platforms: ["linux/amd64", "linux/arm64"] });

    expect(detailView(route(), entry, context({ wire: { ...emptyWire, platforms: ["linux/arm64"] } })).platforms).toEqual([
      "linux/arm64",
    ]);
    expect(detailView(route(), entry, context()).platforms).toEqual(["linux/amd64", "linux/arm64"]);
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

describe("detailView — install rows", () => {
  it("renders every flavor for the default `latest` target, the bare qualified name", () => {
    const view = detailView(route(), entryOf({ name: "idx/acme/tool", tagCount: 1 }), context());

    expect(view.install.map((row) => row.command)).toEqual([
      "ocx add idx/acme/tool",
      "ocx --global add idx/acme/tool",
      "ocx package exec idx/acme/tool",
      "ocx package install idx/acme/tool",
    ]);
    expect(view.install.map((row) => row.label)).toEqual([
      "Add to project",
      "Add globally",
      "Run without installing",
      "Install package",
    ]);
    expect(view.install.map((row) => row.icon)).toEqual(["project", "global", "exec", "install"]);
  });

  it("renders no install rows for a package with no live tag", () => {
    expect(detailView(route(), entryOf({ tagCount: 0 }), context()).install).toEqual([]);
  });
});

describe("detailView — licence, source, revision (detail_page_annotations)", () => {
  it("carries licence and revision as text and the source as a canonical link", () => {
    const wire: DetailWire = {
      ...emptyWire,
      license: "MIT",
      revision: "9e8a183",
      source: "https://github.com/acme/tool",
    };
    const view = detailView(route(), entryOf(), context({ wire }));

    expect(view).toMatchObject({ license: "MIT", revision: "9e8a183", sourceHref: "https://github.com/acme/tool" });
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "ftp://host/x", "/relative", "not a url", ""])(
    "drops a source that is not an absolute http(s) URL: %j",
    (source) => {
      expect(detailView(route(), entryOf(), context({ wire: { ...emptyWire, source } })).sourceHref).toBeNull();
    },
  );

  it("has no source link when none is known", () => {
    expect(detailView(route(), entryOf(), context({ wire: emptyWire })).sourceHref).toBeNull();
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

describe("detailView — wire URLs (C-008, C-016, C-039)", () => {
  it.each([
    ["/", "/p/acme/tool.json"],
    ["/catalog/", "/catalog/p/acme/tool.json"],
  ])("the root source's package root under base %s is %s, never //p/", (base, expected) => {
    const view = detailView(route(), entryOf(), context({ base }));

    expect(view.rootUrl).toBe(expected);
    expect(view.rootUrl).not.toContain("//p/");
    expect(view.wireBase).toBe("");
  });

  it("a non-root source's package root sits under index/<label>", () => {
    const view = detailView(route({ segments: ["b", "acme", "tool"], wireBase: "index/b" }), entryOf(), context({ base: "/catalog/" }));

    expect(view.wireBase).toBe("index/b");
    expect(view.rootUrl).toBe("/catalog/index/b/p/acme/tool.json");
  });

  it("joins the catalog-root-relative logo onto base, and keeps a missing logo null", () => {
    const logo = `/index/b/p/acme/tool/o/sha256/${HEX}.svg`;

    expect(detailView(route(), entryOf({ logoUrl: logo }), context({ base: "/catalog/" })).logoUrl).toBe(`/catalog${logo}`);
    expect(detailView(route(), entryOf({ logoUrl: null }), context()).logoUrl).toBeNull();
  });
});

describe("detailView — newest tags (C-016)", () => {
  it("renders at most SSR_TAG_LIMIT tags and keeps the full count", () => {
    const tags = Array.from({ length: 25 }, (_, i) => `1.${i}.0`);
    const view = detailView(route(), entryOf({ tagCount: 25 }), context({ wire: { ...emptyWire, tags } }));

    expect(SSR_TAG_LIMIT).toBe(20);
    expect(view.tags).toEqual(tags.slice(0, 20));
    expect(view.tagCount).toBe(25);
  });

  it("renders fewer tags when there are fewer", () => {
    const view = detailView(route(), entryOf(), context({ wire: { ...emptyWire, tags: ["1.0.0"] } }));

    expect(view.tags).toEqual(["1.0.0"]);
  });
});

describe("detailView over the committed site fixtures", () => {
  async function fixturePackage(index: string, id: string): Promise<CatalogSourcePackage> {
    const files = await readDirectoryTree(`${FIXTURES}${index}`);
    const found = extractPackages(files).find((pkg) => `${pkg.packageId.namespace}/${pkg.packageId.package}` === id);
    if (found === undefined) throw new Error(`fixture ${index}/${id} missing`);
    return found;
  }

  it("tools/many-tags: 25 tags render as the newest 20 with licence, source and owner", async () => {
    const pkg = await fixturePackage("index-a", "tools/many-tags");
    const view = detailView(
      route({ namespace: "tools", package: "many-tags", segments: ["tools", "many-tags"] }),
      catalogEntry(pkg),
      context({ base: "/catalog/", ownerUrl: "https://forge.example/{login}", wire: detailWire(pkg) }),
    );

    expect(view.tagCount).toBe(25);
    expect(view.tags).toHaveLength(20);
    expect(view.tags[0]).toBe("latest");
    expect(view.tags[1]).toBe("0.24.0");
    expect(view.tags[19]).toBe("0.6.0");
    expect(view.license).toBe("MIT");
    expect(view.sourceHref).toBe("https://github.com/ocx-contrib/tools-many-tags");
    expect(view.owners).toEqual([{ login: "ocx-bot", href: "https://forge.example/ocx-bot" }]);
    expect(view.rootUrl).toBe("/catalog/p/tools/many-tags.json");
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

  it("hostile/metadata: hostile owner, deprecation and supersession text stays inert data", async () => {
    const pkg = await fixturePackage("index-b", "hostile/metadata");
    const view = detailView(
      route({ namespace: "hostile", package: "metadata", segments: ["index-b", "hostile", "metadata"], wireBase: "index/index-b" }),
      catalogEntry(pkg),
      context({ wire: detailWire(pkg) }),
    );

    expect(view.status).toBe("deprecated");
    expect(view.supersededByHref).toBeNull();
    expect(view.supersededBy).toContain("onmouseover");
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
    const rootPkg = source({ root: { name: "idx/acme/tool", owners: ["alice"] } });
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
    expect(model.details["acme/tool"]?.rootUrl).toBe("/catalog/p/acme/tool.json");
    expect(model.details["b/acme/other"]?.rootUrl).toBe("/catalog/index/b/p/acme/other.json");
    expect(JSON.stringify(model)).not.toContain("//p/");
  });

  it("a route without wire facts renders the catalog entry's data only", () => {
    const pkg = source();
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [catalogEntry(pkg)] };

    const view = siteModel(catalog, [route()], loaded()).details["acme/tool"];

    expect(view?.owners).toEqual([]);
    expect(view?.tags).toEqual([]);
    expect(view?.platforms).toEqual(["linux/amd64"]);
  });

  it("refuses a route that has no catalog entry", () => {
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [] };

    expect(() => siteModel(catalog, [route()], loaded())).toThrow("route acme/tool has no catalog entry");
  });

  it("defaults to base `/` when the config sets none: root-source wire URLs start /p/, never //p/", () => {
    const pkg = source();
    const catalog: Catalog = { generated: null, indexes: indexes({ name: "idx" }), packages: [catalogEntry(pkg)] };
    const noBase: LoadedConfig = { config: { sources: [], brand: { title: "Mirror" } }, configDir: "/cfg", sources: [] };

    expect(siteModel(catalog, [route()], noBase).details["acme/tool"]?.rootUrl).toBe("/p/acme/tool.json");
  });
});
