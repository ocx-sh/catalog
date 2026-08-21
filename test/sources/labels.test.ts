/**
 * Spec tests for `src/sources/labels.ts` (C-003 "Label resolution seam").
 * MUST fail against the `throw new Error("not implemented")` stubs.
 */
import { describe, expect, it } from "vitest";
import { checkLabelConflicts, resolveLabel } from "../../src/sources/labels.js";
import { SourceError } from "../../src/sources/types.js";
import type { ResolvedSource } from "../../src/config/types.js";
import { rootJsonBytes } from "./helpers.js";

function pathSource(label: string | null): ResolvedSource {
  return { entry: { path: "." }, label };
}

describe("resolveLabel — explicit label", () => {
  it("uses an explicit label verbatim, without touching files", () => {
    const label = resolveLabel(pathSource("mirror-a"), new Map());
    expect(label).toBe("mirror-a");
  });

  it.each([
    ["contains a slash", "a/b"],
    ["contains a backslash", "a\\b"],
    ["is exactly .", "."],
    ["is exactly ..", ".."],
    ["is empty", ""],
  ])("rejects an explicit label that %s (LABEL_PATH_UNSAFE)", (_desc, unsafeLabel) => {
    expect(() => resolveLabel(pathSource(unsafeLabel), new Map())).toThrow(
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
    expect(() => resolveLabel(pathSource(unsafeLabel), new Map())).toThrow(
      expect.objectContaining({ name: "SourceError", code: "LABEL_PATH_UNSAFE" }),
    );
  });
});

describe("resolveLabel — derivation from source data", () => {
  it("derives the label from the first /-segment of a single root's name", () => {
    const files = new Map([["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })]]);

    const label = resolveLabel(pathSource(null), files);

    expect(label).toBe("ocx.sh");
  });

  it("multiple roots sharing the same first-segment prefix derive one label without conflict", () => {
    const files = new Map([
      ["p/kitware/cmake.json", rootJsonBytes({ name: "ocx.sh/kitware/cmake" })],
      ["p/kitware/ninja.json", rootJsonBytes({ name: "ocx.sh/kitware/ninja" })],
    ]);

    const label = resolveLabel(pathSource(null), files);

    expect(label).toBe("ocx.sh");
  });

  it("throws LABEL_DERIVATION_EMPTY when the source has zero package roots", () => {
    const files = new Map([["config.json", new TextEncoder().encode('{"format_version":1}')]]);

    expect(() => resolveLabel(pathSource(null), files)).toThrow(
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
      resolveLabel(pathSource(null), files);
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

    expect(() => resolveLabel(pathSource(null), files)).toThrow(
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

    expect(() => resolveLabel(pathSource(null), files)).toThrow(
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
