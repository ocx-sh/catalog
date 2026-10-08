/**
 * C-040: the site emits no inline JSON. Wire data reaches the browser through
 * `/data/catalog/catalog.json` (fetched on first interaction) or the DOM
 * (`textContent`/`setAttribute`), never through a `<script type="application/json">`
 * island or `define:vars`, so there is no `</script>` escaping to get wrong.
 * Adding one means adding an escaping helper and its tests first.
 *
 * The detector runs against planted violations first, which must come out red,
 * then against the real tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SITE = join(ROOT, "src/site");

const INLINE_JSON = /\bdefine:vars\b|type\s*=\s*["']?application\/(?:ld\+)?json\b/;

function siteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? siteFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("planted violations are caught (red)", () => {
  it.each([
    "<script define:vars={{ packages }}>",
    '<script type="application/json" set:html={JSON.stringify(x)} />',
    "<script type=application/ld+json>",
    "<script type='application/json'>",
  ])("inline JSON: %s", (line) => {
    expect(INLINE_JSON.test(line)).toBe(true);
  });

  it("an ordinary module script is not a violation", () => {
    expect(INLINE_JSON.test('<script>import { mount } from "../client/grid.js";</script>')).toBe(false);
  });
});

describe("src/site", () => {
  const files = siteFiles(SITE);

  it("covers pages, components and client modules (the scan is not vacuous)", () => {
    const rel = files.map((file) => relative(ROOT, file));
    expect(rel).toEqual(expect.arrayContaining(["src/site/components/CatalogGrid.astro", "src/site/client/grid.ts"]));
  });

  it("emits no inline JSON and uses no define:vars", () => {
    expect(
      files.filter((file) => INLINE_JSON.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file)),
    ).toEqual([]);
  });
});
