/**
 * Contract tests for `reservedNames` (C-027): the names a build owns at the
 * output root, which a non-root label or a root-source namespace may not take.
 * The assertions are the plan's contract, not the stub's behaviour.
 */
import { describe, expect, it } from "vitest";
import type { CatalogConfig } from "../../src/config/types.js";
import { checkReservedIndexLabels, checkReservedRootNamespaces, reservedNames } from "../../src/sources/labels.js";
import { SourceError } from "../../src/sources/types.js";

function config(logo?: string): CatalogConfig {
  return {
    sources: [{ path: "packages" }],
    base: "/",
    brand: logo === undefined ? { title: "Catalog" } : { title: "Catalog", logo },
  };
}

describe("reservedNames (C-027)", () => {
  it.each([
    "p",
    "index",
    "data",
    "docs",
    "assets",
    "404",
    "public",
    "_astro",
    "robots.txt",
    "_headers",
    "config.json",
    "c",
    "pagefind",
  ])("reserves the static name %s", (name) => {
    expect(reservedNames(config(), [])(name)).toBe(true);
  });

  it.each(["sitemap-index.xml", "sitemap-0.xml", "favicon.svg", "favicon.ico", "favicon"])(
    "reserves the wildcard family member %s",
    (name) => {
      expect(reservedNames(config(), [])(name)).toBe(true);
    },
  );

  it.each(["acme", "brand", "sitemap", "pkg", "ocx.sh"])("does not reserve the ordinary name %s", (name) => {
    expect(reservedNames(config(), [])(name)).toBe(false);
  });

  it("is case-insensitive", () => {
    const isReserved = reservedNames(config(), []);
    expect(isReserved("Docs")).toBe(true);
    expect(isReserved("ROBOTS.TXT")).toBe(true);
    expect(isReserved("Sitemap-0.xml")).toBe(true);
  });

  it("reserves every top-level name the build writes (publicDir entries)", () => {
    const isReserved = reservedNames(config(), ["humans.txt", "Fonts"]);
    expect(isReserved("humans.txt")).toBe(true);
    expect(isReserved("fonts")).toBe(true);
    expect(isReserved("acme")).toBe(false);
  });

  it("reserves the brand.logo file name, not its directory", () => {
    const isReserved = reservedNames(config("assets-src/Mark.svg"), []);
    expect(isReserved("mark.svg")).toBe(true);
    expect(isReserved("assets-src")).toBe(false);
  });

  it("reserves the css file name, not its directory", () => {
    const isReserved = reservedNames({ ...config(), css: "styles/Custom.css" }, []);
    expect(isReserved("custom.css")).toBe(true);
    expect(isReserved("styles")).toBe(false);
  });

  it("does not reserve `brand` — the build writes no brand/ directory", () => {
    expect(reservedNames(config("brand/logo.svg"), [])("brand")).toBe(false);
  });
});

describe("reserved names applied to labels and root namespaces (C-027, S-003)", () => {
  const isReserved = reservedNames(config("assets-src/Mark.svg"), ["humans.txt"]);

  it("rejects a non-root label that is a written name, in any case", () => {
    for (const label of ["humans.txt", "MARK.SVG", "_astro", "Sitemap-0.xml"]) {
      expect(() => checkReservedIndexLabels([{ label, root: false }], isReserved), label).toThrow(SourceError);
    }
  });

  it("accepts the same name as a root source's label", () => {
    expect(() => checkReservedIndexLabels([{ label: "humans.txt", root: true }], isReserved)).not.toThrow();
  });

  it("rejects a root-source namespace that is reserved or written, naming it", () => {
    for (const namespace of ["docs", "Favicon.ico", "humans.txt", "mark.svg"]) {
      const error = (() => {
        try {
          checkReservedRootNamespaces(["acme", namespace], isReserved);
        } catch (err) {
          return err as SourceError;
        }
        return undefined;
      })();
      expect(error, namespace).toBeInstanceOf(SourceError);
      expect(error?.code).toBe("INDEX_LABEL_RESERVED");
      expect(error?.message).toContain(JSON.stringify(namespace));
    }
  });

  it("accepts ordinary root namespaces", () => {
    expect(() => checkReservedRootNamespaces(["acme", "ocx.sh", "brand"], isReserved)).not.toThrow();
  });
});
