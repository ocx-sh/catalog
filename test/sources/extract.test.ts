/**
 * Spec tests for `extractPackages` (`src/sources/types.ts`, C-003) — the
 * wire-JSON -> `CatalogSourcePackage` parser. Field mapping per
 * `schema/root.schema.json` (`/home/mherwig/dev/index/schema/root.schema.json`)
 * and `extractPackages`'s own doc comment (snake_case -> camelCase,
 * `superseded_by` presence, `desc.readme`/`desc.logo` absence, `tags[*].yanked`
 * absence). MUST fail against the `throw new Error("not implemented")` stub.
 */
import { describe, expect, it } from "vitest";
import { extractPackages } from "../../src/sources/types.js";
import { rootJsonBytes, utf8 } from "./helpers.js";

describe("extractPackages — field mapping", () => {
  it("maps every governance + desc + tags field snake_case -> camelCase", () => {
    const files = new Map([
      [
        "p/kitware/cmake.json",
        rootJsonBytes({
          name: "ocx.sh/kitware/cmake",
          status: "active",
          created: "2026-01-01",
          desc: {
            title: "CMake",
            description: "Build system generator",
            keywords: ["build", "cross-platform"],
            readme: `sha256:${"b".repeat(64)}`,
            logo: `sha256:${"c".repeat(64)}`,
          },
          tags: {
            "3.28.1": { content: `sha256:${"d".repeat(64)}`, observed: "2026-01-01T00:00:00Z" },
          },
        }),
      ],
    ]);

    const packages = extractPackages(files);

    expect(packages).toHaveLength(1);
    const pkg = packages[0]!;
    expect(pkg.packageId).toEqual({ namespace: "kitware", package: "cmake" });
    expect(pkg.root.name).toBe("ocx.sh/kitware/cmake");
    expect(pkg.root.status).toBe("active");
    expect(pkg.root.deprecatedMessage).toBeNull();
    expect(pkg.root.supersededBy).toBeNull();
    expect(pkg.root.created).toBe("2026-01-01");
    expect(pkg.root.desc).toEqual({
      title: "CMake",
      description: "Build system generator",
      keywords: ["build", "cross-platform"],
      readme: `sha256:${"b".repeat(64)}`,
      logo: `sha256:${"c".repeat(64)}`,
    });
    expect(pkg.root.tags["3.28.1"]).toEqual({
      content: `sha256:${"d".repeat(64)}`,
      observed: "2026-01-01T00:00:00Z",
      yanked: null,
    });
  });

  it("drops desc.digest — the catalog-scoped CatalogDesc never carries it", () => {
    const files = new Map([
      [
        "p/ns/pkg.json",
        rootJsonBytes({
          name: "ocx.sh/ns/pkg",
          desc: { title: "T", description: "D", keywords: [] },
        }),
      ],
    ]);

    const packages = extractPackages(files);

    expect(Object.keys(packages[0]!.root.desc!)).not.toContain("digest");
  });

  it("desc: null (never published __ocx.desc) passes through as desc: null", () => {
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "ocx.sh/ns/pkg", desc: null })]]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.desc).toBeNull();
  });

  it("desc.readme/desc.logo absent within a present desc -> null", () => {
    const files = new Map([
      [
        "p/ns/pkg.json",
        rootJsonBytes({
          name: "ocx.sh/ns/pkg",
          desc: { title: "T", description: "D", keywords: [] },
        }),
      ],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.desc).toEqual({
      title: "T",
      description: "D",
      keywords: [],
      readme: null,
      logo: null,
    });
  });

  it("superseded_by present -> supersededBy verbatim", () => {
    const files = new Map([
      ["p/ns/old.json", rootJsonBytes({ name: "ocx.sh/ns/old", supersededBy: "ns/new" })],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.supersededBy).toBe("ns/new");
  });

  it("superseded_by absent -> supersededBy: null", () => {
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "ocx.sh/ns/pkg" })]]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.supersededBy).toBeNull();
  });

  it("a tag with yanked present -> Yank object verbatim", () => {
    const files = new Map([
      [
        "p/ns/pkg.json",
        rootJsonBytes({
          name: "ocx.sh/ns/pkg",
          tags: {
            "1.0.0": {
              content: `sha256:${"e".repeat(64)}`,
              observed: "2026-01-01T00:00:00Z",
              yanked: { reason: "broken build", at: "2026-01-02T00:00:00Z" },
            },
          },
        }),
      ],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.root.tags["1.0.0"]!.yanked).toEqual({
      reason: "broken build",
      at: "2026-01-02T00:00:00Z",
    });
  });
});

describe("extractPackages — package path depth (no two-segment split, #716)", () => {
  it("parses a root at depth 1 (p/<ns>/<pkg>.json)", () => {
    const files = new Map([["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })]]);

    const packages = extractPackages(files);

    expect(packages[0]!.packageId).toEqual({ namespace: "kitware", package: "cmake" });
  });

  it("parses a root at depth 3, keeping the package segment verbatim with its own slashes", () => {
    const files = new Map([
      ["p/kitware/toolchains/gcc.json", rootJsonBytes({ name: "ocx.sh/kitware/toolchains/gcc" })],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.packageId).toEqual({ namespace: "kitware", package: "toolchains/gcc" });
  });

  // Depth semantics settled 2026-08-22 (WP-07 panel, plan C-003): a wire
  // path with only ONE segment before `.json` has no remainder to be a
  // `packageId.package` — the catalog view model's `{namespace, package}`
  // split cannot represent it, and previously an unchecked `slice(0, -1)`
  // silently garbled the namespace by one character instead of erroring.
  it("rejects a depth-1 wire path (p/name.json — no namespace/package split possible)", () => {
    const files = new Map([["p/name.json", rootJsonBytes({ name: "ocx.sh/name/x" })]]);

    let error: unknown;
    try {
      extractPackages(files);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("p/name.json");
  });
});

describe("extractPackages — S-008 name-vs-path validation", () => {
  it("throws naming BOTH the root name and its wire path when they disagree", () => {
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "ocx.sh/other/mismatch" })]]);

    let error: unknown;
    try {
      extractPackages(files);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ocx.sh/other/mismatch");
    expect((error as Error).message).toContain("p/ns/pkg.json");
  });

  it("accepts a name whose brand token differs from ocx.sh, as long as namespace/package agree with the path (forked schema)", () => {
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "acme.example/ns/pkg" })]]);

    const packages = extractPackages(files);

    expect(packages[0]!.packageId).toEqual({ namespace: "ns", package: "pkg" });
  });

  it("throws when a depth-3 root's name package segment disagrees with its path", () => {
    const files = new Map([
      ["p/kitware/toolchains/gcc.json", rootJsonBytes({ name: "ocx.sh/kitware/toolchains/clang" })],
    ]);

    expect(() => extractPackages(files)).toThrow();
  });

  it("throws when name has no `/` at all (no brand token, nothing to compare against the path)", () => {
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "justastring" })]]);

    let error: unknown;
    try {
      extractPackages(files);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("justastring");
    expect((error as Error).message).toContain("p/ns/pkg.json");
  });
});

describe("extractPackages — CAS content association", () => {
  it("builds contentByDigest keyed `${digest}.${ext}` from a root's OWN o/sha256/ subtree only", () => {
    const casBytes = utf8('{"schemaVersion":2}');
    const files = new Map([
      ["p/ns/pkg.json", rootJsonBytes({ name: "ocx.sh/ns/pkg" })],
      [`p/ns/pkg/o/sha256/${"f".repeat(64)}.json`, casBytes],
    ]);

    const packages = extractPackages(files);

    expect(packages[0]!.contentByDigest[`sha256:${"f".repeat(64)}.json`]).toBe(casBytes);
  });

  it("never leaks one package's CAS blob into a same-named key under a different package", () => {
    const casA = utf8("A");
    const casB = utf8("B");
    const files = new Map([
      ["p/ns/a.json", rootJsonBytes({ name: "ocx.sh/ns/a" })],
      ["p/ns/b.json", rootJsonBytes({ name: "ocx.sh/ns/b" })],
      [`p/ns/a/o/sha256/${"1".repeat(64)}.json`, casA],
      [`p/ns/b/o/sha256/${"1".repeat(64)}.json`, casB],
    ]);

    const packages = extractPackages(files);
    const byId = new Map(packages.map((p) => [p.packageId.package, p]));

    expect(byId.get("a")!.contentByDigest[`sha256:${"1".repeat(64)}.json`]).toBe(casA);
    expect(byId.get("b")!.contentByDigest[`sha256:${"1".repeat(64)}.json`]).toBe(casB);
  });
});

// Design gap (flagged, not invented): `extractPackages`'s own doc comment
// says a malformed root "propagates as a parse/property-access failure —
// this function does not itself validate root shape", which does not by
// itself promise the thrown error names the offending file. The C-003/S-001
// contract ("malformed root JSON => build fails naming file") is stated at
// the CLI/build-engine level. These two tests assert the level the doc DOES
// support (a thrown error, not silent corrupt data); the stricter
// file-naming assertion is written too, per the assignment's explicit
// instruction, but should be read as probing where that context is added
// (this function, vs. its caller) rather than a settled contract.
describe("extractPackages — malformed root (S-001, gap noted above)", () => {
  it("throws rather than returning corrupt data for unparseable JSON", () => {
    const files = new Map([["p/ns/pkg.json", utf8("{not valid json")]]);

    expect(() => extractPackages(files)).toThrow();
  });

  it("throws rather than returning corrupt data for a root missing a field this function reads", () => {
    const files = new Map([["p/ns/pkg.json", utf8('{"name":"ocx.sh/ns/pkg"}')]]);

    expect(() => extractPackages(files)).toThrow();
  });

  it("the thrown error names the offending file path", () => {
    const files = new Map([["p/ns/broken.json", utf8("{not valid json")]]);

    let error: unknown;
    try {
      extractPackages(files);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("p/ns/broken.json");
  });
});

/**
 * Coverage for `validateRootShape` (`src/sources/types.ts`) — a root that is
 * valid JSON but schema-invalid (a field `mapRoot` dereferences is missing
 * or the wrong type) previously crashed with a raw
 * "Cannot read properties of undefined" a few frames inside `mapRoot`. Each
 * case below drives one specific branch of `validateRootShape` and asserts
 * the message names both the file and the offending field.
 */
describe("extractPackages — malformed root shape (schema-invalid, not just unparseable)", () => {
  function throwsWith(bytes: Uint8Array): string {
    const files = new Map([["p/acme/hello.json", bytes]]);
    let error: unknown;
    try {
      extractPackages(files);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }

  it("a top-level JSON value that isn't an object (string)", () => {
    const message = throwsWith(utf8('"just a string"'));
    expect(message).toContain("p/acme/hello.json");
    expect(message).toContain("expected a JSON object");
  });

  it("a top-level JSON value that is null", () => {
    const message = throwsWith(utf8("null"));
    expect(message).toContain("expected a JSON object");
  });

  it("a top-level JSON value that is an array", () => {
    const message = throwsWith(utf8("[]"));
    expect(message).toContain("expected a JSON object");
  });

  it("name missing entirely", () => {
    const message = throwsWith(utf8('{"desc":null,"tags":{}}'));
    expect(message).toContain("p/acme/hello.json");
    expect(message).toContain('"name"');
  });

  it("name present but the wrong type", () => {
    const message = throwsWith(utf8('{"name":123,"desc":null,"tags":{}}'));
    expect(message).toContain('"name"');
  });

  it("desc missing entirely (the original bug report: undefined, not null)", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello"}'));
    expect(message).toContain("p/acme/hello.json");
    expect(message).toContain('"desc"');
    expect(message).not.toContain("Cannot read properties");
  });

  it("desc present but an array, not an object", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":[],"tags":{}}'));
    expect(message).toContain('"desc"');
  });

  it("desc.title missing", () => {
    const message = throwsWith(
      utf8('{"name":"ocx.sh/acme/hello","desc":{"description":"d","keywords":[]},"tags":{}}'),
    );
    expect(message).toContain('"desc.title"');
  });

  it("desc.description missing", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":{"title":"T"},"tags":{}}'));
    expect(message).toContain('"desc.description"');
  });

  it("desc.keywords missing", () => {
    const message = throwsWith(
      utf8('{"name":"ocx.sh/acme/hello","desc":{"title":"T","description":"D"},"tags":{}}'),
    );
    expect(message).toContain('"desc.keywords"');
  });

  it("tags missing entirely", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null}'));
    expect(message).toContain('"tags"');
  });

  it("tags present but null", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null,"tags":null}'));
    expect(message).toContain('"tags"');
  });

  it("tags present but an array", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null,"tags":[]}'));
    expect(message).toContain('"tags"');
  });

  it("a tag entry that is a string, not an object", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null,"tags":{"1.0.0":"oops"}}'));
    expect(message).toContain('tags["1.0.0"]');
  });

  it("a tag entry that is null", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null,"tags":{"1.0.0":null}}'));
    expect(message).toContain('tags["1.0.0"]');
  });

  it("a tag entry that is an array", () => {
    const message = throwsWith(utf8('{"name":"ocx.sh/acme/hello","desc":null,"tags":{"1.0.0":[]}}'));
    expect(message).toContain('tags["1.0.0"]');
  });
});

/** Security panel (2026-08-22, S2): tag names are remote data, and
 * `JSON.parse` makes `__proto__` a genuine own property — so writing them
 * into a plain `{}` routed the `__proto__` key through `Object.prototype`'s
 * setter, which swaps the prototype instead of storing the entry. The tag
 * silently vanished from the catalog; a YANKED tag disappearing is the case
 * that matters. */
describe("extractPackages — hostile tag names never hit Object.prototype", () => {
  it("keeps a tag literally named __proto__, yanked state and all", () => {
    const files = new Map([
      [
        "p/ns/pkg.json",
        rootJsonBytes({
          name: "ocx.sh/ns/pkg",
          tags: {
            // Computed key: a bare `__proto__:` in an object literal would
            // set this fixture's OWN prototype instead of adding the key.
            ["__proto__"]: {
              content: `sha256:${"d".repeat(64)}`,
              observed: "2026-01-01T00:00:00Z",
              yanked: { reason: "compromised", at: "2026-02-01T00:00:00Z" },
            },
            "1.0.0": { content: `sha256:${"e".repeat(64)}`, observed: "2026-01-02T00:00:00Z" },
          },
        }),
      ],
    ]);

    const packages = extractPackages(files);
    const { tags } = packages[0]!.root;

    expect(Object.keys(tags).sort()).toEqual(["1.0.0", "__proto__"]);
    expect(tags["__proto__"]).toEqual({
      content: `sha256:${"d".repeat(64)}`,
      observed: "2026-01-01T00:00:00Z",
      yanked: { reason: "compromised", at: "2026-02-01T00:00:00Z" },
    });
    // The map itself is prototype-less, so no remote tag name can ever reach
    // an inherited setter/getter in the first place.
    expect(Object.getPrototypeOf(tags)).toBeNull();
  });
});
