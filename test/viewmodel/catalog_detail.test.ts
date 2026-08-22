/**
 * Spec tests for `readImageIndexAnnotations` (C-600, `src/viewmodel/
 * catalog.ts`) — reads `org.opencontainers.image.{licenses,source,revision}`
 * off one already-parsed OCI image-index object's `annotations`. Every
 * branch: an absent annotations key (omitted, not an error — `annotations`
 * is spec-optional), a malformed `annotations` value (reported as an error,
 * never coerced), a malformed individual annotation value (reported as an
 * error), and each field's present/absent merge side.
 *
 * Plus the C-503 byte-stability boundary: these annotations are a detail-page
 * surface only and must never reach `/data/catalog/catalog.json`.
 */
import { describe, expect, it } from "vitest";
import {
  catalogEntry,
  catalogIndex,
  readImageIndexAnnotations,
  serializeCatalog,
} from "../../src/viewmodel/catalog.js";
import { digest } from "../golden/_helpers.js";
import type { CatalogPackageRoot, CatalogSourcePackage } from "../../src/viewmodel/types.js";

function emptyRoot(overrides: Partial<CatalogPackageRoot> = {}): CatalogPackageRoot {
  return {
    name: "ocx.sh/ns/pkg",
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    repository: null,
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

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** One tag's OCI image-index CAS bytes, `annotations` set to whatever the
 * caller passes — full control, unlike `test/golden/_helpers.ts`'s `indexOf`,
 * which has no `annotations` support at all. */
function indexWithAnnotations(annotations: unknown): Uint8Array {
  const obj: Record<string, unknown> = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [],
  };
  if (annotations !== undefined) {
    obj.annotations = annotations;
  }
  return utf8(JSON.stringify(obj));
}

describe("readImageIndexAnnotations", () => {
  const d = digest("n");

  it("returns {} when annotations is absent", () => {
    expect(readImageIndexAnnotations({}, d)).toEqual({});
    expect(readImageIndexAnnotations({ annotations: undefined }, d)).toEqual({});
  });

  it("reads all three annotations verbatim when present", () => {
    expect(
      readImageIndexAnnotations(
        {
          annotations: {
            "org.opencontainers.image.licenses": "MIT OR Apache-2.0",
            "org.opencontainers.image.source": "https://github.com/acme/widget",
            "org.opencontainers.image.revision": "abc123",
          },
        },
        d,
      ),
    ).toEqual({
      license: "MIT OR Apache-2.0",
      sourceRepository: "https://github.com/acme/widget",
      revision: "abc123",
    });
  });

  it("omits only the individually-absent keys within a present annotations object", () => {
    expect(
      readImageIndexAnnotations({ annotations: { "org.opencontainers.image.licenses": "MIT" } }, d),
    ).toEqual({ license: "MIT" });
  });

  // Branch completeness: the above always has `license` present — this
  // covers the FALSE side of the `license !== undefined` merge ternary
  // (every other field's true/false side is already exercised above).
  it("omits license specifically when only source/revision are present", () => {
    expect(
      readImageIndexAnnotations(
        { annotations: { "org.opencontainers.image.source": "https://github.com/acme/widget" } },
        d,
      ),
    ).toEqual({ sourceRepository: "https://github.com/acme/widget" });
  });

  it("throws naming the digest when annotations is present but not an object", () => {
    expect(() => readImageIndexAnnotations({ annotations: "oops" }, d)).toThrow(/malformed "annotations"/);
    expect(() => readImageIndexAnnotations({ annotations: "oops" }, d)).toThrow(d);
    expect(() => readImageIndexAnnotations({ annotations: null }, d)).toThrow(/malformed "annotations"/);
    expect(() => readImageIndexAnnotations({ annotations: [] }, d)).toThrow(/malformed "annotations"/);
  });

  it("throws naming the digest and key when a specific annotation value is present but not a string", () => {
    expect(() =>
      readImageIndexAnnotations({ annotations: { "org.opencontainers.image.licenses": 123 } }, d),
    ).toThrow(/is present but not a string/);
  });
});

describe("C-503 byte stability", () => {
  it("annotation fields never reach catalogIndex/serializeCatalog output", () => {
    const d = digest("m");
    const root = emptyRoot({
      tags: { "1.0.0": { content: d, observed: "2026-01-01T00:00:00Z", yanked: null } },
    });
    const source = sourceOf(root, {
      [`${d}.json`]: indexWithAnnotations({
        "org.opencontainers.image.licenses": "MIT",
        "org.opencontainers.image.source": "https://github.com/acme/widget",
        "org.opencontainers.image.revision": "abc123",
      }),
    });

    // catalogEntry/catalogIndex/serializeCatalog — the ONLY path that produces
    // `/data/catalog/catalog.json` — never read an image index's annotations,
    // so none of these fields leak into the serialized bytes.
    expect(Object.keys(catalogEntry(source))).not.toEqual(
      expect.arrayContaining(["license", "sourceRepository", "revision"]),
    );
    const json = serializeCatalog(catalogIndex([source]));
    expect(json).not.toContain("license");
    expect(json).not.toContain("MIT");
    expect(json).not.toContain("sourceRepository");
    expect(json).not.toContain("revision");
  });
});
