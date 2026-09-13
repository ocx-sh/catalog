// @vitest-environment happy-dom
//
// The catalog at corporate size: the paint bound that keeps off-screen cards
// out of layout and paint. It fails silently — a missing declaration only
// shows up as seconds on a slow machine — so it is read out of the component
// source the way `layer_contract.test.ts` reads it. happy-dom lays nothing
// out, so no assertion here can prove the browser honours it; `task
// quality:web` is where a real engine gets a say.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/** Source of a component, comments blanked out so a rule merely DISCUSSED in
 * prose can never satisfy an assertion about a rule that must be declared. */
function componentSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The declarations of one flat rule block, by exact selector. */
function declarationsOf(relPath: string, selector: string): string {
  const source = componentSource(relPath);
  const match = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(
    source,
  );
  if (match === null) throw new Error(`no rule for selector ${selector} in ${relPath}`);
  return match[2]!;
}

describe("off-screen cards and rows stay out of layout and paint", () => {
  test("the card carries the paint bound and an intrinsic size to hold its place", () => {
    const card = declarationsOf("src/theme/components/catalog/PackageCard.vue", ".package-card");

    expect(card).toContain("content-visibility: auto");
    // Without `auto` the browser never learns the real height and the
    // scrollbar keeps jumping as you scroll.
    expect(card).toMatch(/contain-intrinsic-size:\s*auto\s+\d/);
  });

  // The row must NOT carry it. `content-visibility` implies layout
  // containment at all times, and a subgrid under layout containment is not
  // a subgrid: Chromium 152 resolves the row's `grid-template-columns` to
  // `none` and every cell stacks on its own line — the whole table reads as
  // a list of seven-line entries. Shipped once, on the strength of a claim
  // copied from another repo rather than reproduced here.
  test("the subgrid table row does not carry it", () => {
    const row = declarationsOf("src/theme/components/catalog/PackageTable.vue", ".table-row");

    expect(row).toContain("grid-template-columns: subgrid");
    expect(row).not.toContain("content-visibility");
  });

  // The bound belongs on the card, which IS the grid item. The `<li>` around
  // it is `display: contents` and generates no box, so a bound written there
  // would apply to nothing at all while looking entirely correct.
  test("the bound is not written on the display:contents list item", () => {
    const item = declarationsOf("src/theme/components/catalog/CatalogPage.vue", ".catalog-grid-item");

    expect(item).toContain("display: contents");
    expect(item).not.toContain("content-visibility");
  });
});
