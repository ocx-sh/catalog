/** D-130 — the package a static 404 URL names, for the 404 page's message. */
import { describe, expect, it } from "vitest";
import { staticReservedNames } from "../../../src/sources/labels.js";
import { packageNameFromPath } from "../../../src/site/lib/notFound.js";

describe("packageNameFromPath (D-130)", () => {
  it("D-130 names the <ns>/<pkg> route under base", () => {
    expect(packageNameFromPath("/catalog/acme/tool/", "/catalog/")).toBe("acme/tool");
    expect(packageNameFromPath("/acme/tool", "/")).toBe("acme/tool");
  });

  it("D-130 names nothing for the catalog root, a one-segment or three-segment path", () => {
    expect(packageNameFromPath("/catalog/", "/catalog/")).toBeNull();
    expect(packageNameFromPath("/catalog/acme/", "/catalog/")).toBeNull();
    expect(packageNameFromPath("/catalog/acme/tool/extra/", "/catalog/")).toBeNull();
  });

  it("D-130 names nothing under the docs or index mounts", () => {
    expect(packageNameFromPath("/catalog/docs/intro/", "/catalog/")).toBeNull();
    expect(packageNameFromPath("/index/label/", "/")).toBeNull();
  });

  it.each(["data", "p", "_astro", "assets", "Docs", "sitemap-0.xml", "favicon.svg"])(
    "D-130 names nothing under the reserved top-level segment %s",
    (segment) => {
      expect(packageNameFromPath(`/${segment}/x`, "/")).toBeNull();
      expect(packageNameFromPath(`/catalog/${segment}/x/`, "/catalog/")).toBeNull();
    },
  );

  it("D-130 excludes every name the build reserves (drift guard against sources/labels.ts)", () => {
    const candidates = ["p", "index", "data", "docs", "assets", "404", "public", "_astro", "robots.txt", "_headers", "config.json", "c", "pagefind", "sitemap-index.xml", "favicon.ico", "acme", "tools"];
    for (const name of candidates) {
      expect(packageNameFromPath(`/${name}/x`, "/") === null, name).toBe(staticReservedNames(name));
    }
  });

  it("D-130 names nothing for a path outside base", () => {
    expect(packageNameFromPath("/elsewhere/acme/tool/", "/catalog/")).toBeNull();
  });
});
