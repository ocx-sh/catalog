/**
 * `extractPackages` (`src/sources/types.ts`) carries a package root's
 * `owners` and `source` through to `CatalogPackageRoot` for the detail page
 * (P-detail T.3): owners as logins (`login`, else the pre-0.5.0 `github`),
 * `source` verbatim or `null`. Detail-page data only — `catalogEntry` never
 * reads either, so neither reaches `/data/catalog/catalog.json` (C-503).
 */
import { describe, expect, it } from "vitest";
import { extractPackages } from "../../src/sources/types.js";
import { catalogEntry } from "../../src/viewmodel/catalog.js";

function rootBytes(fields: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      name: "ocx.sh/ns/pkg",
      repository: "oci://ghcr.io/ns/pkg",
      status: "active",
      deprecated_message: null,
      created: "2026-01-01",
      desc: null,
      tags: {},
      ...fields,
    }),
  );
}

function rootOf(fields: Record<string, unknown>) {
  return extractPackages(new Map([["p/ns/pkg.json", rootBytes(fields)]]))[0]!.root;
}

describe("owners and source field mapping (extractPackages)", () => {
  it("maps owners to logins in wire order, preferring `login` over the legacy `github`", () => {
    const root = rootOf({
      owners: [
        { login: "alice", github: "alice", id: 1, github_id: 1 },
        { github: "legacy", github_id: 2 },
      ],
    });

    expect(root.owners).toEqual(["alice", "legacy"]);
  });

  it("drops an owner carrying neither spelling, and reports a missing owners list as empty", () => {
    expect(rootOf({ owners: [{ id: 3 }, { login: "bob" }] }).owners).toEqual(["bob"]);
    expect(rootOf({}).owners).toEqual([]);
  });

  it("copies `source` verbatim and reports an absent one as null", () => {
    expect(rootOf({ source: "https://github.com/ns/pkg" }).source).toBe("https://github.com/ns/pkg");
    expect(rootOf({}).source).toBeNull();
  });

  it("catalogEntry never surfaces either onto CatalogEntry (catalog.json byte-stability)", () => {
    const [pkg] = extractPackages(
      new Map([["p/ns/pkg.json", rootBytes({ owners: [{ login: "alice" }], source: "https://github.com/ns/pkg" })]]),
    );

    const entry = catalogEntry(pkg!) as unknown as Record<string, unknown>;

    expect(entry).not.toHaveProperty("owners");
    expect(entry).not.toHaveProperty("source");
  });
});
