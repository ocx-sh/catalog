import { describe, expect, it } from "vitest";
import { INLINE_SCRIPT_HASHES } from "@ocx-sh/theme/csp";
import { cspHashes } from "../../src/site/csp_hashes.js";

describe("cspHashes", () => {
  it("is the theme's own list of Shell inline-script hashes, unquoted sha256 sources", () => {
    expect(cspHashes()).toEqual([...INLINE_SCRIPT_HASHES]);
    expect(cspHashes()).toHaveLength(2);
    for (const hash of cspHashes()) expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});
