/**
 * C-032: `Page.astro`'s props and slots are the only seam between pages and the
 * theme's `Shell`. Runnable without a build: the shape is read from source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SITE_DIR = fileURLToPath(new URL("../../../src/site", import.meta.url));
const read = (path: string): string => readFileSync(join(SITE_DIR, path), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("C-032 the layout seam", () => {
  it("no page imports anything from @ocx-sh/theme/layouts; Page.astro is the only file under src/site that does", () => {
    const importers = filesUnder(SITE_DIR)
      .filter((file) => /from\s+["']@ocx-sh\/theme\/layouts/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SITE_DIR, file).split("\\").join("/"));

    expect(importers).toEqual(["layouts/Page.astro"]);
    expect(filesUnder(join(SITE_DIR, "pages")).length).toBeGreaterThan(0);
  });

  it("PageProps carries title, description?, canonical? and activeSection?, and nothing else", () => {
    const file = join(SITE_DIR, "layouts/page_props.ts");
    const program = ts.createProgram([file], { noEmit: true, strict: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file)!;
    const symbol = checker.getSymbolAtLocation(source)!;
    const pageProps = checker.getExportsOfModule(symbol).find((exported) => exported.name === "PageProps")!;
    const members = checker
      .getDeclaredTypeOfSymbol(pageProps)
      .getProperties()
      .map((property) => [property.name, (property.flags & ts.SymbolFlags.Optional) !== 0]);

    expect(Object.fromEntries(members)).toEqual({
      title: false,
      description: true,
      canonical: true,
      activeSection: true,
    });
    // ts.createProgram loads lib.d.ts; under a loaded full run it outlasts the 5 s default.
  }, 30_000);

  it("Page.astro exposes the head, default and header-search slots", () => {
    const page = read("layouts/Page.astro");

    expect(page).toContain('<slot name="head"');
    expect(page).toContain('<slot name="header-search"');
    expect(page).toMatch(/<slot\s*\/>/);
  });

  it("every page goes through Page.astro", () => {
    for (const file of filesUnder(join(SITE_DIR, "pages")).filter((path) => path.endsWith(".astro"))) {
      expect(readFileSync(file, "utf8"), relative(dirname(SITE_DIR), file)).toMatch(/from\s+["']\.\.\/layouts\/Page\.astro["']/);
    }
  });
});
