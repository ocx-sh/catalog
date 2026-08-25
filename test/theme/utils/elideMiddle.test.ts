/**
 * Spec tests for `src/theme/utils/elideMiddle.ts` — the middle-elision the
 * card and table identity lines use on a qualified package name.
 */
import { describe, expect, it } from "vitest";
import { elideMiddle } from "../../../src/theme/utils/elideMiddle.js";

describe("elideMiddle", () => {
  it("leaves a name that already fits completely alone", () => {
    expect(elideMiddle("ocx.sh/kitware/cmake", 40)).toBe("ocx.sh/kitware/cmake");
  });

  it("keeps the index prefix and the package leaf, dropping only the middle", () => {
    const elided = elideMiddle("ocx.sh/hashicorp/terraform-provider-aws", 30);

    expect(elided).toBe("ocx.sh/…/terraform-provider-aws");
    // The two halves that identify the package survive; a plain CSS ellipsis
    // would have eaten the second one.
    expect(elided.startsWith("ocx.sh/")).toBe(true);
    expect(elided.endsWith("terraform-provider-aws")).toBe(true);
  });

  it("collapses every middle segment of a depth-N package path, not just one", () => {
    expect(elideMiddle("acme/platform/tools/internal/deploy-kit", 20)).toBe("acme/…/deploy-kit");
  });

  // Nothing to drop: eliding here could only shorten the name by lying about
  // one end or the other, so it is left for the caller's `text-overflow`.
  it("returns a too-long two-segment name unchanged", () => {
    expect(elideMiddle("acme/an-extremely-long-package-name", 10)).toBe("acme/an-extremely-long-package-name");
  });

  it("treats a name exactly at the budget as fitting", () => {
    expect(elideMiddle("a/b/c", 5)).toBe("a/b/c");
  });
});
