/**
 * Contract tests for `src/viewmodel/url.ts` — C-009 (`packageHref` is the only
 * producer of a detail link), C-039 (`joinBase` refuses anything that could
 * leave the site), C-042 (`wireHref` is the single wire-URL sink). The
 * assertions are the plan's contract, not the stub's behaviour.
 */
import { describe, expect, it } from "vitest";
import { casUrl } from "../../src/viewmodel/catalog.js";
import { joinBase, packageHref, wireHref } from "../../src/viewmodel/url.js";
import type { CatalogIndexInfo } from "../../src/viewmodel/types.js";

const ROOT_AND_CORP: CatalogIndexInfo[] = [
  { name: "ocx.sh", root: true, default: true, excludeFromAll: false, count: 2 },
  { name: "corp.example", root: false, default: false, excludeFromAll: false, count: 1 },
];
const ALL_QUALIFIED: CatalogIndexInfo[] = [
  { name: "corp.example", root: false, default: true, excludeFromAll: false, count: 1 },
];

describe("joinBase (C-039)", () => {
  it.each([
    ["/", "/", "/"],
    ["/", "/p/acme/tool.json", "/p/acme/tool.json"],
    ["/catalog/", "/", "/catalog/"],
    ["/catalog/", "/data/catalog/catalog.json", "/catalog/data/catalog/catalog.json"],
    ["/a/b/", "/p/acme/tool.json", "/a/b/p/acme/tool.json"],
    // a base that looks like a mirror prefix still joins by plain concatenation
    ["/index/", "/index/corp.example/p/acme/tool.json", "/index/index/corp.example/p/acme/tool.json"],
    ["/index/", "/p/acme/tool.json", "/index/p/acme/tool.json"],
    // a percent-encoded dot inside a longer segment is not a dot segment
    ["/", "/p/a%2eb/tool.json", "/p/a%2eb/tool.json"],
    ["/", "/p/...", "/p/..."],
  ])("joinBase(%j, %j) === %j", (base, path, expected) => {
    expect(joinBase(base, path)).toBe(expected);
  });

  it.each([
    ["a protocol-relative path", "/", "//evil.example"],
    ["a protocol-relative path under a base", "/catalog/", "//evil.example/x"],
    ["a path without a leading slash", "/", "p/acme/tool.json"],
    ["an empty path", "/", ""],
    ["a backslash", "/", "/p\\acme"],
    ["a newline", "/", "/p/a\nb"],
    ["a NUL", "/", "/p/a\u0000b"],
    ["a DEL", "/", "/p/a\u007fb"],
    ["a dot segment", "/", "/p/./acme"],
    ["a dot-dot segment", "/", "/p/../acme"],
    ["a trailing dot-dot segment", "/catalog/", "/p/.."],
    ["a lone dot segment", "/", "/."],
    ["a percent-encoded dot-dot segment", "/catalog/", "/%2e%2e/admin"],
    ["an upper-case percent-encoded dot-dot segment", "/catalog/", "/%2E%2E/admin"],
    ["a mixed dot / percent-encoded dot segment", "/catalog/", "/p/.%2e/admin"],
    ["a mixed percent-encoded / dot segment", "/catalog/", "/p/%2e./admin"],
    ["a lone percent-encoded dot segment", "/", "/p/%2E/acme"],
    ["a dot-dot segment before a fragment", "/catalog/", "/..#x"],
    ["a dot-dot segment before a query", "/catalog/", "/..?q"],
    ["a trailing dot-dot segment before a query", "/catalog/", "/a/..?q"],
    ["a percent-encoded dot-dot segment before a fragment", "/catalog/", "/a/%2e%2e#x"],
  ])("throws for %s", (_label, base, path) => {
    expect(() => joinBase(base, path)).toThrow();
  });
});

describe("joinBase: a query or fragment tail is data, not path", () => {
  it.each([
    ["a dot-dot inside the query", "/docs/?next=/../x", "/catalog/docs/?next=/../x"],
    ["a dot-dot inside the fragment", "/docs/#/../x", "/catalog/docs/#/../x"],
    ["a dotted segment name", "/docs/a..b?v=2", "/catalog/docs/a..b?v=2"],
  ])("joins %s", (_label, path, expected) => {
    expect(joinBase("/catalog/", path)).toBe(expected);
  });
});

describe("packageHref (C-009)", () => {
  it.each([
    ["root index, depth 2, base /", "ocx.sh/acme/tool", ROOT_AND_CORP, "/", "/acme/tool/"],
    ["root index, depth 3, base /", "ocx.sh/acme/tools/gadget", ROOT_AND_CORP, "/", "/acme/tools/gadget/"],
    ["root index, base /catalog/", "ocx.sh/acme/tool", ROOT_AND_CORP, "/catalog/", "/catalog/acme/tool/"],
    ["non-root index, base /", "corp.example/acme/tool", ROOT_AND_CORP, "/", "/corp.example/acme/tool/"],
    ["non-root index, base /catalog/", "corp.example/acme/tool", ROOT_AND_CORP, "/catalog/", "/catalog/corp.example/acme/tool/"],
    ["all indexes qualified, base /", "corp.example/acme/tool", ALL_QUALIFIED, "/", "/corp.example/acme/tool/"],
    ["all indexes qualified, base /catalog/", "corp.example/acme/tool", ALL_QUALIFIED, "/catalog/", "/catalog/corp.example/acme/tool/"],
    ["no envelope (undefined indexes), base /", "ocx.sh/acme/tool", undefined, "/", "/acme/tool/"],
    ["a label named like the mirror prefix, base /index/", "corp.example/acme/tool", ROOT_AND_CORP, "/index/", "/index/corp.example/acme/tool/"],
  ])("%s", (_label, name, indexes, base, expected) => {
    expect(packageHref(name, indexes, base)).toBe(expected);
  });

  it("ends every link with a slash, for every base", () => {
    for (const base of ["/", "/catalog/", "/a/b/"]) {
      expect(packageHref("ocx.sh/acme/tool", ROOT_AND_CORP, base).endsWith("/")).toBe(true);
    }
  });
});

describe("root source wire URLs never go protocol-relative (C-039)", () => {
  const extLookup = new Map([["sha256:" + "a".repeat(64), "md"]]);
  const digest = "sha256:" + "a".repeat(64);

  it("a root source (wireBase \"\") yields a /p/ URL, never //p/", () => {
    const url = casUrl("acme", "tool", digest, extLookup, "");
    expect(url).toBe(`/p/acme/tool/o/sha256/${"a".repeat(64)}.md`);
    expect(url?.startsWith("//")).toBe(false);
  });

  it("a non-root source (wireBase index/<label>) yields /index/<label>/p/…", () => {
    expect(casUrl("acme", "tool", digest, extLookup, "index/corp.example")).toBe(
      `/index/corp.example/p/acme/tool/o/sha256/${"a".repeat(64)}.md`,
    );
  });

  it("joins onto a base through joinBase", () => {
    const url = casUrl("acme", "tool", digest, extLookup, "");
    expect(joinBase("/catalog/", url ?? "")).toBe(`/catalog/p/acme/tool/o/sha256/${"a".repeat(64)}.md`);
  });
});

describe("wireHref (C-042)", () => {
  it.each([
    ["an https URL", "https://example.com/x", "https://example.com/x"],
    ["an http URL", "http://example.com/x", "http://example.com/x"],
    ["canonicalises the host case", "https://EXAMPLE.com/x", "https://example.com/x"],
    ["canonicalises a bare origin", "https://example.com", "https://example.com/"],
  ])("returns the canonical href for %s", (_label, value, expected) => {
    expect(wireHref(value)).toBe(expected);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: with an embedded tab", "java\tscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["a root-relative path", "/x"],
    ["a relative path", "./x"],
    ["an empty string", ""],
    ["unparseable text", "not a url"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { href: "https://example.com" }],
  ])("returns null for %s", (_label, value) => {
    expect(wireHref(value)).toBeNull();
  });
});
