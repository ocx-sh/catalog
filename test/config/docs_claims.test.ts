/**
 * D-159: the published config documentation (the JSON Schema editor tooling
 * shows, the `Brand`/`CatalogConfig` doc comments, the docs site) matches what
 * the renderer does: an absent `brand.logo` keeps the built-in OCX mark, the
 * footer always carries the `catalog json` link, and `css` is bundled.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string): Promise<string> => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const SCHEMA = "../../src/config/schema/catalog.config.schema.json";
const TYPES = "../../src/config/types.ts";
const REFERENCE = "../../docs/src/content/docs/reference/config-schema.mdx";
const GUIDE = "../../docs/src/content/docs/how-to/customize-branding-and-docs.md";

/** Promises the renderer does not keep: a logo-less header with only the title, a footer with no `catalog json` link, a raw-data link. */
const STALE_CLAIM = /beside the title|title as text|omit for no footer links|\(no footer links\)|absent -> no footer links|raw[- ]data link|copied to the site root under its file name/i;

describe("published config documentation", () => {
  it.each([SCHEMA, TYPES, REFERENCE, GUIDE])("D-159 %s makes none of the stale claims", async (path) => {
    expect(await read(path)).not.toMatch(STALE_CLAIM);
  });

  it("D-159 the stale-claim detector is able to fail", () => {
    for (const stale of ["shows the title as text", "Omit for no footer links.", "a footer with only the raw-data link", "rendered beside the title"]) {
      expect(stale).toMatch(STALE_CLAIM);
    }
    expect("Omit to keep the built-in OCX mark.").not.toMatch(STALE_CLAIM);
  });

  it("D-159 brand.logo is documented as replacing the built-in OCX mark, on every surface", async () => {
    for (const path of [SCHEMA, TYPES, REFERENCE, GUIDE]) {
      expect(await read(path), path).toMatch(/built-in OCX mark/);
    }
  });

  it("D-159 the footer is documented as always carrying the catalog json link, on every surface", async () => {
    for (const path of [SCHEMA, TYPES, REFERENCE, GUIDE]) {
      expect(await read(path), path).toMatch(/catalog json/);
    }
  });

  it("D-159 the css documentation describes the bundle", async () => {
    expect(await read(REFERENCE)).toContain("bundles it with the theme's styles");
    expect(await read(SCHEMA)).toContain("Bundled with the theme's styles");
  });
});
