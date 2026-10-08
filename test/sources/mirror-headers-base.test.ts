/**
 * Contract tests for `renderHeaders(sources, base)` (C-006): every `_headers`
 * pattern is prefixed by `base`, so the sandbox rules cover exactly the paths
 * the site serves. Assertions compare normalised REQUEST paths against the
 * emitted patterns the way Cloudflare Pages/Netlify match a trailing `/*`,
 * rather than pinning pattern text alone. The assertions are the plan's
 * contract, not the stub's behaviour.
 */
import { describe, expect, it } from "vitest";
import { renderHeaders } from "../../src/sources/mirror.js";
import type { ResolvedSourceFiles } from "../../src/sources/types.js";

function source(label: string, root: boolean): ResolvedSourceFiles {
  return { label, root, files: new Map() };
}

/** The `_headers` path patterns: the unindented lines of each block. */
function patterns(headers: string): string[] {
  return headers.split("\n").filter((line) => line !== "" && !line.startsWith(" "));
}

/** True iff a `/prefix/*` pattern matches `requestPath` (a trailing `*` spans any suffix). */
function matches(pattern: string, requestPath: string): boolean {
  return requestPath.startsWith(pattern.slice(0, -1));
}

function covered(headers: string, requestPath: string): boolean {
  return patterns(headers).some((pattern) => matches(pattern, requestPath));
}

describe("renderHeaders prefixes every pattern by base (C-006)", () => {
  const sources = [source("ocx.sh", true), source("corp.example", false)];

  it("base / emits the unprefixed patterns", () => {
    expect(patterns(renderHeaders(sources, "/"))).toEqual(["/p/*", "/index/ocx.sh/p/*", "/index/corp.example/p/*"]);
  });

  it("base /catalog/ emits only /catalog/-prefixed patterns", () => {
    expect(patterns(renderHeaders(sources, "/catalog/"))).toEqual([
      "/catalog/p/*",
      "/catalog/index/ocx.sh/p/*",
      "/catalog/index/corp.example/p/*",
    ]);
  });

  it("base /catalog/ sandboxes the served wire paths and nothing is left bare", () => {
    const headers = renderHeaders(sources, "/catalog/");
    expect(covered(headers, "/catalog/p/acme/tool.json")).toBe(true);
    expect(covered(headers, "/catalog/p/acme/tool/o/sha256/abc.md")).toBe(true);
    expect(covered(headers, "/catalog/index/corp.example/p/acme/tool/o/sha256/abc.svg")).toBe(true);
    expect(covered(headers, "/p/acme/tool.json")).toBe(false);
    expect(covered(headers, "/index/corp.example/p/acme/tool.json")).toBe(false);
  });

  it("a base that looks like the mirror prefix does not confuse the two", () => {
    const headers = renderHeaders(sources, "/index/");
    expect(patterns(headers)).toEqual(["/index/p/*", "/index/index/ocx.sh/p/*", "/index/index/corp.example/p/*"]);
    expect(covered(headers, "/index/p/acme/tool.json")).toBe(true);
    expect(covered(headers, "/index/index/corp.example/p/acme/tool.json")).toBe(true);
    expect(covered(headers, "/p/acme/tool.json")).toBe(false);
  });

  it("still omits the root block when no source is root, under any base", () => {
    const headers = renderHeaders([source("corp.example", false)], "/catalog/");
    expect(patterns(headers)).toEqual(["/catalog/index/corp.example/p/*"]);
  });

  it("carries the same sandbox directives under every pattern", () => {
    const headers = renderHeaders(sources, "/catalog/");
    expect(headers.match(/Content-Security-Policy: sandbox/g)).toHaveLength(3);
    expect(headers.match(/X-Content-Type-Options: nosniff/g)).toHaveLength(3);
  });
});
