/**
 * Spec tests for C-501: `extractPackages` (`src/sources/types.ts`) carries a
 * package root's `repository` field through to `CatalogPackageRoot`,
 * faithfully — present on the wire -> copied verbatim; absent -> `null`,
 * never fabricated. Detail-page data only: `catalogEntry` (`catalog.ts`)
 * never reads `root.repository`, so it never reaches
 * `/data/catalog/catalog.json` (C-503) — asserted directly here rather than
 * only trusted from the golden byte gate, since that gate is WP3-owned and
 * this file's job is to pin the C-501/C-503 boundary itself.
 *
 * A local, minimal root-JSON builder is used here (not
 * `test/sources/helpers.ts`'s `rootJsonBytes`, which already bakes a fixed
 * placeholder `repository` into every fixture it builds) — this file's own
 * job is specifically to vary that one field, present and absent.
 */
import { describe, expect, it } from "vitest";
import { catalogEntry } from "../../src/viewmodel/catalog.js";
import { extractPackages } from "../../src/sources/types.js";

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Minimal valid `p/<ns>/<pkg>.json` root text — `repository` included only
 * when `repository` is passed, so the "absent on the wire" case is a real
 * absent key, not an empty string. */
function rootBytes(name: string, repository?: string): Uint8Array {
  const obj: Record<string, unknown> = {
    name,
    ...(repository !== undefined ? { repository } : {}),
    owners: [{ github: "octocat", github_id: 1 }],
    status: "active",
    deprecated_message: null,
    created: "2026-01-01",
    desc: null,
    tags: {},
  };
  return utf8(JSON.stringify(obj));
}

describe("C-501: repository field mapping (extractPackages)", () => {
  it("copies a present repository field through verbatim", () => {
    const files = new Map([
      ["p/ns/pkg.json", rootBytes("ocx.sh/ns/pkg", "oci://ghcr.io/ns/pkg")],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.repository).toBe("oci://ghcr.io/ns/pkg");
  });

  it("reports an absent repository field as null, never fabricated", () => {
    const files = new Map([["p/ns/pkg.json", rootBytes("ocx.sh/ns/pkg")]]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.repository).toBeNull();
  });

  it("C-503: catalogEntry never surfaces repository onto CatalogEntry (catalog.json byte-stability boundary)", () => {
    const files = new Map([
      ["p/ns/pkg.json", rootBytes("ocx.sh/ns/pkg", "oci://ghcr.io/ns/pkg")],
    ]);
    const [pkg] = extractPackages(files);

    const entry = catalogEntry(pkg!);

    expect(Object.keys(entry)).not.toContain("repository");
  });
});
