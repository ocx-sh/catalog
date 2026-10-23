import { createHash } from "node:crypto";
import { VIEW_SCRIPT } from "../../src/site/lib/viewScript.js";
import { describe, expect, it } from "vitest";
import { INLINE_SCRIPT_HASHES } from "@ocx-sh/theme/csp";
import { cspHashes } from "../../src/site/csp_hashes.js";

describe("cspHashes", () => {
  it("is the theme's own list of Shell inline-script hashes plus the catalog's view script, unquoted sha256 sources", () => {
    expect(cspHashes().slice(0, INLINE_SCRIPT_HASHES.length)).toEqual([...INLINE_SCRIPT_HASHES]);
    expect(cspHashes()).toHaveLength(INLINE_SCRIPT_HASHES.length + 1);
    expect(cspHashes().at(-1)).toBe(`sha256-${createHash("sha256").update(VIEW_SCRIPT).digest("base64")}`);
    for (const hash of cspHashes()) expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});
