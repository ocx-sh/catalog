/**
 * Spec tests for `src/sources/labels.ts` (C-003 "Label resolution seam").
 * MUST fail against the `throw new Error("not implemented")` stubs.
 */
import { describe, expect, it } from "vitest";
import { checkIndexNamespaceCollisions,
  checkReservedIndexLabels, checkLabelConflicts, resolveLabel } from "../../src/sources/labels.js";
import { extractPackages, SourceError } from "../../src/sources/types.js";
import type { ResolvedSource } from "../../src/config/types.js";
import { rootJsonBytes } from "./helpers.js";

function pathSource(label: string | null): ResolvedSource {
  return { entry: { path: "." }, label };
}

describe("resolveLabel — explicit label", () => {
  it("uses an explicit label verbatim, without touching files", () => {
    const label = resolveLabel(pathSource("mirror-a"), extractPackages(new Map()));
    expect(label).toBe("mirror-a");
  });

  it.each([
    ["contains a slash", "a/b"],
    ["contains a backslash", "a\\b"],
    ["is exactly .", "."],
    ["is exactly ..", ".."],
    ["is empty", ""],
  ])("rejects an explicit label that %s (LABEL_PATH_UNSAFE)", (_desc, unsafeLabel) => {
    expect(() => resolveLabel(pathSource(unsafeLabel), extractPackages(new Map()))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });

  // Security panel BLOCK B (2026-08-22): the pre-panel check only blocklisted
  // "/", "\\", ".", ".." — every control character passed straight through.
  // An explicit label carrying "\n\n" would inject a whole new BLOCK into
  // the shared _headers file (mirror.ts writes one file for every source).
  it.each([
    ["a newline (single-line header injection)", "abc\n  Access-Control-Allow-Origin: *"],
    ["a blank-line-separated block injection", "abc\n\n/evil/*\n  X-Injected: yes"],
    ["a carriage return", "abc\rEvil-Header: 1"],
    ["a raw control character (bell)", "abc\x07def"],
  ])("rejects an explicit label containing %s (LABEL_PATH_UNSAFE)", (_desc, unsafeLabel) => {
    expect(() => resolveLabel(pathSource(unsafeLabel), extractPackages(new Map()))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });
});

describe("resolveLabel — derivation from source data", () => {
  it("derives the label from the first /-segment of a single root's name", () => {
    const files = new Map([["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })]]);

    const label = resolveLabel(pathSource(null), extractPackages(files));

    expect(label).toBe("ocx.sh");
  });

  it("multiple roots sharing the same first-segment prefix derive one label without conflict", () => {
    const files = new Map([
      ["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })],
      ["p/kitware/ninja.json", rootJsonBytes({ name: "ocx.sh/kitware/ninja" })],
    ]);

    const label = resolveLabel(pathSource(null), extractPackages(files));

    expect(label).toBe("ocx.sh");
  });

  it("throws LABEL_DERIVATION_EMPTY when the source has zero package roots", () => {
    const files = new Map([["config.json", new TextEncoder().encode('{"format_version":1}')]]);

    expect(() => resolveLabel(pathSource(null), extractPackages(files))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_DERIVATION_EMPTY" }),
    );
  });

  it("throws LABEL_DERIVATION_CONFLICT when roots disagree on their first name segment", () => {
    // A forked/corporate schema whose `name` values don't share a common
    // top-level (brand) segment — the case labels.ts's own doc comment
    // carves out ("a forked schema ... is not this module's to trust").
    // Everything AFTER that first segment still agrees with each root's own
    // wire path (S-008, `extractPackages`'s own name-vs-path check) — only
    // the brand token itself is what disagrees here, which IS the scenario
    // this test means to exercise.
    const files = new Map([
      ["p/acme/widget.json", rootJsonBytes({ name: "acme.example/acme/widget" })],
      ["p/globex/gizmo.json", rootJsonBytes({ name: "globex.example/globex/gizmo" })],
    ]);

    let error: SourceError | undefined;
    try {
      resolveLabel(pathSource(null), extractPackages(files));
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("LABEL_DERIVATION_CONFLICT");
    expect(error?.message).toContain("acme.example");
    expect(error?.message).toContain("globex.example");
  });

  it("throws LABEL_PATH_UNSAFE for a derived label unsafe as a path segment", () => {
    // A forked schema whose first name segment (the label candidate) is
    // itself unsafe — everything after it still agrees with the wire path
    // (S-008), so this actually reaches the label-safety check, not an
    // earlier name-vs-path rejection.
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: "../ns/pkg" })]]);

    expect(() => resolveLabel(pathSource(null), extractPackages(files))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });

  // Security panel BLOCK B (2026-08-22): a DERIVED label comes straight from
  // a hostile source's own `root.name` — everything after `name`'s first
  // "/" still has to agree with the wire path (S-008), but the brand token
  // itself (the label candidate) is otherwise free-form, so a malicious
  // source can put a header-injection payload there directly.
  it("throws LABEL_PATH_UNSAFE for a derived label carrying a header-injection newline", () => {
    const maliciousBrand = "abc\n  Access-Control-Allow-Origin: *";
    const files = new Map([["p/ns/pkg.json", rootJsonBytes({ name: `${maliciousBrand}/ns/pkg` })]]);

    expect(() => resolveLabel(pathSource(null), extractPackages(files))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });
});

describe("checkLabelConflicts", () => {
  it("does not throw when every label is unique", () => {
    expect(() => checkLabelConflicts(["a", "b", "c"])).not.toThrow();
  });

  it("throws LABEL_CONFLICT naming both conflicting sources when two labels collide", () => {
    let error: SourceError | undefined;
    try {
      checkLabelConflicts(["a", "b", "a"]);
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("LABEL_CONFLICT");
  });

  it("catches a collision between an explicit-origin and a derived-origin label the same way", () => {
    // checkLabelConflicts only ever sees the resolved strings — it can't
    // and shouldn't distinguish explicit from derived origin.
    expect(() => checkLabelConflicts(["ocx.sh", "ocx.sh"])).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_CONFLICT" }),
    );
  });
});

describe("resolveLabel — an explicit label must restate the index's own name", () => {
  // The label names the index in the scope tab row; the first `/`-segment of
  // every package name names it on every card. Two names for one index is a
  // page that contradicts itself, so the config is rejected outright.
  it("accepts an explicit label that equals the roots' own prefix", () => {
    const files = new Map([["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })]]);

    expect(resolveLabel(pathSource("ocx.sh"), extractPackages(files))).toBe("ocx.sh");
  });

  it("rejects an explicit label that renames the index (LABEL_PREFIX_MISMATCH)", () => {
    const files = new Map([["p/platform/deploy-kit.json", rootJsonBytes({ name: "acme/platform/deploy-kit" })]]);

    let error: SourceError | undefined;
    try {
      resolveLabel(pathSource("acme-internal"), extractPackages(files));
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("LABEL_PREFIX_MISMATCH");
    // Names both halves of the disagreement, so the fix is obvious from the
    // message alone without opening the index.
    expect(error?.message).toContain("acme-internal");
    expect(error?.message).toContain("acme");
  });

  it("rejects an explicit label when the source's own roots disagree with each other", () => {
    const files = new Map([
      ["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })],
      ["p/platform/deploy-kit.json", rootJsonBytes({ name: "acme/platform/deploy-kit" })],
    ]);

    expect(() => resolveLabel(pathSource("ocx.sh"), extractPackages(files))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PREFIX_MISMATCH" }),
    );
  });

  // An empty source has no name to contradict its label with — and an empty
  // index is a legitimate configuration (its scope tab simply reads 0).
  it("accepts an explicit label on a source with zero package roots", () => {
    expect(resolveLabel(pathSource("acme"), extractPackages(new Map()))).toBe("acme");
  });
});

describe("resolveLabel — fallbackLabel (the `dev --source` sugar path)", () => {
  it("uses the fallback when there is nothing to derive from", () => {
    expect(resolveLabel(pathSource(null), extractPackages(new Map()), "local")).toBe("local");
  });

  // The fallback is a default, not a rename: `dev --source` against a real
  // index must show that index's own name, which is the bug that made this
  // parameter exist (it used to be passed as an explicit label instead).
  it("never overrides a name the source's own roots do carry", () => {
    const files = new Map([["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })]]);

    expect(resolveLabel(pathSource(null), extractPackages(files), "local")).toBe("ocx.sh");
  });

  it("still rejects an unsafe fallback as one path segment", () => {
    expect(() => resolveLabel(pathSource(null), extractPackages(new Map()), "../escape")).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });

  it("without a fallback an empty source is still LABEL_DERIVATION_EMPTY", () => {
    expect(() => resolveLabel(pathSource(null), extractPackages(new Map()))).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_DERIVATION_EMPTY" }),
    );
  });
});

describe("checkIndexNamespaceCollisions", () => {
  const labels = (...entries: [string, boolean][]) => entries.map(([label, root]) => ({ label, root }));

  it("does not throw when no non-root label is a root-source namespace", () => {
    expect(() =>
      checkIndexNamespaceCollisions(labels(["ocx.sh", true], ["acme", false]), new Set(["hashicorp", "kitware"])),
    ).not.toThrow();
  });

  // `/acme/…` would be claimed by both the root source's `acme` namespace and
  // the whole `acme` index — whichever page synthesis wrote last would win,
  // silently, with the loser's packages 404ing and nothing said at build time.
  it("throws INDEX_NAMESPACE_COLLISION when a non-root label is a root namespace", () => {
    let error: SourceError | undefined;
    try {
      checkIndexNamespaceCollisions(labels(["ocx.sh", true], ["acme", false]), new Set(["acme"]));
    } catch (err) {
      error = err as SourceError;
    }
    expect(error).toBeInstanceOf(SourceError);
    expect(error?.code).toBe("INDEX_NAMESPACE_COLLISION");
    expect(error?.message).toContain("sources[1]");
  });

  // The ROOT source's own label is not a route prefix at all — its packages
  // keep bare paths — so it can share a name with one of its own namespaces.
  it("ignores the root source's own label", () => {
    expect(() => checkIndexNamespaceCollisions(labels(["acme", true]), new Set(["acme"]))).not.toThrow();
  });
});

// The other claimant on `/<label>/`: a path this build writes itself. Same
// collision as above, no hostile source required — an index whose roots are
// named `docs/…` derives the label `docs`, and `pages.ts` mounts the docs
// tree at exactly that prefix.
describe("checkReservedIndexLabels", () => {
  const labels = (...entries: [string, boolean][]) => entries.map(([label, root]) => ({ label, root }));

  it("passes an ordinary non-root label", () => {
    expect(() => checkReservedIndexLabels(labels(["ocx.sh", true], ["acme", false]))).not.toThrow();
  });

  it.each(["p", "index", "data", "docs", "assets", "404", "public"])(
    "throws INDEX_LABEL_RESERVED for a non-root label of %s",
    (reserved) => {
      let error: SourceError | undefined;
      try {
        checkReservedIndexLabels(labels(["ocx.sh", true], [reserved, false]));
      } catch (err) {
        error = err as SourceError;
      }
      expect(error).toBeInstanceOf(SourceError);
      expect(error?.code).toBe("INDEX_LABEL_RESERVED");
      expect(error?.message).toContain("sources[1]");
    },
  );

  // macOS and Windows resolve `Docs` and `docs` to one directory, so a
  // case-sensitive check would pass CI and collide on a contributor's laptop.
  it("compares case-insensitively", () => {
    expect(() => checkReservedIndexLabels(labels(["Docs", false]))).toThrow(SourceError);
    expect(() => checkReservedIndexLabels(labels(["DATA", false]))).toThrow(SourceError);
  });

  // A root source's packages keep bare routes, so its label never becomes a
  // top-level segment — it only ever mirrors to the nested `index/<label>/`.
  it("ignores a root source, whose label is not a route prefix", () => {
    expect(() => checkReservedIndexLabels(labels(["docs", true]))).not.toThrow();
  });

  // No root source means no bare routes exist, so nothing can be shadowed.
  it("does not throw when no source is root", () => {
    expect(() => checkIndexNamespaceCollisions(labels(["acme", false]), new Set())).not.toThrow();
  });
});
