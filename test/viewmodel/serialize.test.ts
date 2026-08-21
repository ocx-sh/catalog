/**
 * Unit spec for `catalog.ts`'s `serializeCatalog` — the byte-exact write
 * half of Python's `_catalog_index` (`core/render.py:320`:
 * `json.dumps(catalog, indent=2) + "\n"`). Exercises what
 * `JSON.stringify(catalog, null, 2) + "\n"` gets right for free (indent,
 * separators, insertion order) and what it gets WRONG on its own
 * (`ensure_ascii` escaping), per `serializeCatalog`'s own doc comment.
 * Golden byte-comparison against the Python bot's reference output lives in
 * `test/golden/golden.test.ts`; this file is the focused unit spec.
 */
import { describe, expect, it } from "vitest";
import { serializeCatalog } from "../../src/viewmodel/catalog.js";
import type { Catalog, CatalogEntry } from "../../src/viewmodel/types.js";

function baseEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    namespace: "ns",
    package: "pkg",
    name: "ocx.sh/ns/pkg",
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01",
    updated: "2026-01-01T00:00:00Z",
    title: "Title",
    description: "desc",
    keywords: [],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
    ...overrides,
  };
}

function catalogOf(entry: CatalogEntry): Catalog {
  return { generated: "2026-01-01T00:00:00Z", packages: [entry] };
}

describe("serializeCatalog format (2-space indent, insertion order, trailing newline)", () => {
  const catalog = catalogOf(baseEntry());

  it("matches JSON.stringify(catalog, null, 2) plus a trailing newline for pure-ASCII content", () => {
    // For content with no non-ASCII code units, ensure_ascii escaping is a
    // no-op — this pins indent, separators, AND field order all at once, by
    // using JSON.stringify itself as the oracle (its indent=2 output is
    // exactly Python's json.dumps(..., indent=2) shape).
    expect(serializeCatalog(catalog)).toBe(`${JSON.stringify(catalog, null, 2)}\n`);
  });

  it("uses a 2-space indent and a \": \" key/value separator", () => {
    const out = serializeCatalog(catalog);
    expect(out.startsWith('{\n  "generated": ')).toBe(true);
    // Nested one level deeper inside packages[0]'s object: 6 spaces.
    expect(out).toContain('\n      "namespace": "ns",\n');
  });

  it("ends with exactly one trailing newline", () => {
    const out = serializeCatalog(catalog);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("preserves CatalogEntry's declared field order, never alphabetizing", () => {
    const out = serializeCatalog(catalog);
    const namespaceIdx = out.indexOf('"namespace"');
    const packageIdx = out.indexOf('"package"');
    const readmeUrlIdx = out.indexOf('"readmeUrl"');
    // Alphabetical order would put "package" before "namespace" and
    // "readmeUrl" nowhere near last — this is CatalogEntry's own field
    // order (sort_keys=False parity), not an accident of hash-map iteration.
    expect(namespaceIdx).toBeGreaterThan(-1);
    expect(packageIdx).toBeGreaterThan(namespaceIdx);
    expect(readmeUrlIdx).toBeGreaterThan(packageIdx);
  });
});

describe("serializeCatalog ensure_ascii escaping (json.dumps(..., ensure_ascii=True) parity)", () => {
  it("escapes BMP non-ASCII code units as lowercase \\uXXXX sequences", () => {
    const out = serializeCatalog(catalogOf(baseEntry({ description: "café ☕" })));
    // é == U+00E9, ☕ == U+2615 — both single UTF-16 code units.
    expect(out).toContain("caf\\u00e9 \\u2615");
    expect(out).not.toContain("é");
    expect(out).not.toContain("☕");
  });

  it("escapes an astral character as its two UTF-16 surrogate units, each independently escaped", () => {
    const out = serializeCatalog(catalogOf(baseEntry({ description: "😀" })));
    // U+1F600 GRINNING FACE has no BMP representation — Python's json.dumps
    // walks the string as UTF-16 code units (surrogate pair D83D DE00) and
    // escapes each one independently, lowercase hex. A naive implementation
    // that escapes by codepoint (one \u escape per emoji) or that passes
    // astral characters through as raw UTF-8 bytes both diverge here.
    expect(out).toContain("\\ud83d\\ude00");
    expect(out).not.toContain("😀");
  });

  it("passes pure-ASCII text through unchanged, with no escaping", () => {
    const out = serializeCatalog(
      catalogOf(baseEntry({ description: "Cross-platform build system generator." })),
    );
    expect(out).toContain("Cross-platform build system generator.");
    expect(out).not.toMatch(/\\u[0-9a-f]{4}/);
  });

  it("escapes non-ASCII text inside a nested array element (keywords), not just top-level object fields", () => {
    const out = serializeCatalog(catalogOf(baseEntry({ keywords: ["café"] })));
    expect(out).toContain('"caf\\u00e9"');
    expect(out).not.toContain("café");
  });
});
