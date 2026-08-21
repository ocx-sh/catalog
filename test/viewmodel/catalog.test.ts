/**
 * Unit spec for `catalog.ts`'s `catalogPlatforms`/`latestActivity`/
 * `catalogEntry`/`generatedTimestamp` branches NOT reachable through any of
 * the 9 `test/golden/**` fixtures — each case cites the `core/render.py`
 * line/behavior it pins. Byte-exact end-to-end coverage of the reachable
 * branches lives in `test/golden/golden.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  catalogEntry,
  catalogPlatforms,
  generatedTimestamp,
  latestActivity,
} from "../../src/viewmodel/catalog.js";
import { digest, indexOf } from "../golden/_helpers.js";
import type { CatalogPackageRoot, CatalogSourcePackage } from "../../src/viewmodel/types.js";

function emptyRoot(overrides: Partial<CatalogPackageRoot> = {}): CatalogPackageRoot {
  return {
    name: "ocx.sh/ns/pkg",
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01",
    desc: null,
    tags: {},
    ...overrides,
  };
}

function sourceOf(
  root: CatalogPackageRoot,
  contentByDigest: Readonly<Record<string, Uint8Array>> = {},
): CatalogSourcePackage {
  return { packageId: { namespace: "ns", package: "pkg" }, root, contentByDigest };
}

function sourceWithId(
  packageId: CatalogSourcePackage["packageId"],
  root: CatalogPackageRoot,
  contentByDigest: Readonly<Record<string, Uint8Array>> = {},
): CatalogSourcePackage {
  return { packageId, root, contentByDigest };
}

describe("catalogPlatforms", () => {
  // render.py:180-193 — `_live_tag_content_digests` iterates an empty
  // `root.tags`, so the for-loop body never runs: `sorted(set())` == [].
  it("returns an empty array when the package has no tags at all", () => {
    expect(catalogPlatforms(sourceOf(emptyRoot()))).toEqual([]);
  });

  // render.py:184-185: `platform = descriptor.get("platform")`, then
  // `if not isinstance(platform, dict): continue`. The `attestation_descriptor`
  // golden only exercises the "no platform key at all" shape of this branch
  // (platform absent -> undefined); this pins the case where `platform` IS
  // present but is not an object at all (a string, here).
  it("skips a descriptor whose platform field is present but not an object", () => {
    const d = digest("a");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    const source = sourceOf(root, {
      [`${d}.json`]: indexOf({
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: "sha256:placeholder",
        size: 1,
        platform: "linux/amd64",
      }),
    });
    expect(catalogPlatforms(source)).toEqual([]);
  });

  // JSDoc: "a live-tag digest missing from contentByDigest" must propagate
  // as a lookup failure, never be silently swallowed into an empty result.
  it("throws when a live tag's digest is missing from contentByDigest", () => {
    const d = digest("b");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    expect(() => catalogPlatforms(sourceOf(root, {}))).toThrow();
  });

  // JSDoc: "a malformed CAS blob" must propagate as a parse failure.
  it("throws when a live tag's CAS bytes are not valid JSON", () => {
    const d = digest("c");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    const source = sourceOf(root, { [`${d}.json`]: new TextEncoder().encode("not json") });
    expect(() => catalogPlatforms(source)).toThrow();
  });

  // JSDoc: "an index with no manifests key" must propagate as a failure.
  it("throws when a live tag's image index has no manifests key", () => {
    const d = digest("e");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    const source = sourceOf(root, {
      [`${d}.json`]: new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json" }),
      ),
    });
    expect(() => catalogPlatforms(source)).toThrow();
  });

  // Security panel finding: a `manifests[]` entry that is not itself an
  // object (null, here) must throw — matching Python's `descriptor.get()`
  // AttributeError posture — not be silently skipped as if it were merely a
  // platform-less descriptor.
  it("throws when a manifests[] descriptor is not an object", () => {
    const d = digest("i");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    const source = sourceOf(root, {
      [`${d}.json`]: new TextEncoder().encode(JSON.stringify({ manifests: [null] })),
    });
    expect(() => catalogPlatforms(source)).toThrow();
  });
});

describe("latestActivity", () => {
  // render.py:203-208: `max(timestamps, default=None)` over the empty list
  // an empty `root.tags` produces.
  it("returns null when the package has no tags at all", () => {
    expect(latestActivity(emptyRoot())).toBeNull();
  });
});

describe("catalogEntry", () => {
  // render.py:249-251: `status`/`deprecatedMessage`/`supersededBy` pass
  // through verbatim. No golden fixture uses a non-"active" status.
  it("passes through a deprecated status with its message and supersededBy pointer", () => {
    const root = emptyRoot({
      status: "deprecated",
      deprecatedMessage: "use acme/other instead",
      supersededBy: "ocx.sh/acme/other",
    });
    const entry = catalogEntry(sourceOf(root));
    expect(entry.status).toBe("deprecated");
    expect(entry.deprecatedMessage).toBe("use acme/other instead");
    expect(entry.supersededBy).toBe("ocx.sh/acme/other");
  });

  // render.py:249: same pass-through, "yanked" status.
  it("passes through a yanked status", () => {
    expect(catalogEntry(sourceOf(emptyRoot({ status: "yanked" }))).status).toBe("yanked");
  });

  // render.py:136-145 (_cas_url): a configured digest missing from
  // ext_lookup is a dangling reference — the JSDoc's trust posture is
  // "render trusts its input and lets KeyError propagate ... rather than
  // silently degrading the catalog entry". No golden fixture can reach
  // this (the upstream validation gate never lets a dangling reference
  // reach render in practice); this pins the throw contract directly.
  it("throws when desc.logo's digest is missing from contentByDigest", () => {
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: digest("z") },
    });
    expect(() => catalogEntry(sourceOf(root, {}))).toThrow();
  });

  // Security panel finding: casRelpath fullmatch-validates digest/ext at the
  // path-join point (quality-indexbot-security.md: "digest re.fullmatch
  // before any path join"). A digest carrying a traversal payload must
  // throw, never produce a path that escapes p/<ns>/<pkg>/o/sha256/.
  it("throws when desc.logo's digest is not a well-formed sha256 digest (path traversal payload)", () => {
    const badDigest = "sha256:../../../../etc/passwd";
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: badDigest },
    });
    const source = sourceOf(root, { [`${badDigest}.json`]: new Uint8Array() });
    expect(() => catalogEntry(source)).toThrow();
  });

  // Same guard, the extension half: a content-key extension outside
  // [a-z0-9]{1,16} (here, an HTML/script injection payload) must throw
  // rather than be woven into a URL.
  it("throws when desc.logo's content-key extension is malformed", () => {
    const d = digest("f");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceOf(root, { [`${d}.evil"/><script>x`]: new Uint8Array() });
    expect(() => catalogEntry(source)).toThrow();
  });

  // Mirroring guard: casRelpath interpolates namespace and pkg too — a
  // crafted namespace carrying a traversal payload must throw exactly like
  // a crafted digest, not sail into logoUrl/readmeUrl unchecked.
  it("throws when packageId.namespace carries a path traversal payload", () => {
    const d = digest("h");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceWithId({ namespace: "../../etc", package: "pkg" }, root, {
      [`${d}.png`]: new Uint8Array(),
    });
    expect(() => catalogEntry(source)).toThrow();
  });

  // Same guard, the package segment half.
  it("throws when packageId.package carries a path traversal payload", () => {
    const d = digest("j");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceWithId({ namespace: "ns", package: "../../etc/passwd" }, root, {
      [`${d}.png`]: new Uint8Array(),
    });
    expect(() => catalogEntry(source)).toThrow();
  });

  // Positive case: a well-formed digest + extension still produces the
  // expected CAS URL — the validation above is a rejection allowlist, not a
  // functional regression for legitimate input.
  it("accepts a well-formed digest and extension for desc.logo", () => {
    const d = digest("g");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceOf(root, { [`${d}.png`]: new Uint8Array() });
    expect(catalogEntry(source).logoUrl).toBe(`/p/ns/pkg/o/sha256/${"g".repeat(64)}.png`);
  });

  // Depth semantics settled 2026-08-22 (WP-07 panel, plan C-003): the
  // package guard validates 1..N `/`-joined segments, each on its own —
  // S-008's N-depth scenario needs a depth-3 package to build a CAS URL,
  // which the OLD single-segment `PACKAGE_RE.test(pkg)` guard rejected
  // outright.
  it("builds a CAS URL for a depth-3 package (multi-segment packageId.package)", () => {
    const d = digest("k");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceWithId({ namespace: "a", package: "b/c" }, root, {
      [`${d}.svg`]: new Uint8Array(),
    });
    expect(catalogEntry(source).logoUrl).toBe(`/p/a/b/c/o/sha256/${"k".repeat(64)}.svg`);
  });

  // A traversal payload buried INSIDE a multi-segment package (not just as
  // the whole-string prefix the existing "../../etc/passwd" case covers)
  // must still throw — each split segment is checked on its own, so a `..`
  // segment anywhere in the chain is caught, not just a leading one.
  it("throws when a traversal segment is buried inside an otherwise well-formed multi-segment package", () => {
    const d = digest("l");
    const root = emptyRoot({
      desc: { title: "T", description: "d", keywords: [], readme: null, logo: d },
    });
    const source = sourceWithId({ namespace: "ns", package: "b/../etc" }, root, {
      [`${d}.png`]: new Uint8Array(),
    });
    expect(() => catalogEntry(source)).toThrow();
  });
});

describe("generatedTimestamp", () => {
  // render.py:287-290: `max(timestamps, default=None)` over an empty ordered list.
  it("returns null for an empty package list", () => {
    expect(generatedTimestamp([])).toBeNull();
  });

  // render.py:287-289: the filtered comprehension SKIPS any package whose
  // own latestActivity is null (no tags) when folding the max across
  // packages — proving it is skipped, not treated as some empty/low-sorting
  // value that would corrupt the max. No single-package golden can reach
  // this: it only exists once 2+ packages are folded together.
  it("skips a package with no tags when computing the max across packages", () => {
    const noActivity = sourceOf(emptyRoot({ name: "ocx.sh/ns/quiet" }));
    const earlier = sourceOf(
      emptyRoot({
        name: "ocx.sh/ns/early",
        tags: { "1.0.0": { content: digest("x"), observed: "2026-01-01T00:00:00Z", yanked: null } },
      }),
    );
    const later = sourceOf(
      emptyRoot({
        name: "ocx.sh/ns/late",
        tags: { "1.0.0": { content: digest("y"), observed: "2026-06-01T00:00:00Z", yanked: null } },
      }),
    );
    expect(generatedTimestamp([noActivity, earlier, later])).toBe("2026-06-01T00:00:00Z");
  });
});
