import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// `.astro` templates are outside coverage and `tsc`; the grid's layout rows are pinned here
// against the templates' own `<style>` blocks. Each check runs against a mutated source first.
const component = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/site/components/${name}.astro`, import.meta.url)), "utf8");

interface Rule {
  /** The at-rule preludes around the rule, outermost first, without `@layer`. */
  readonly at: string[];
  readonly selector: string;
  readonly body: string;
}

/** Every rule of the template's `<style>` block, comments stripped, nesting flattened to `at`. */
function rulesOf(source: string): Rule[] {
  const css = (/<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const open: { prelude: string; start: number }[] = [];
  let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      open.push({ prelude: css.slice(preludeStart, i).trim(), start: i + 1 });
      preludeStart = i + 1;
    } else if (css[i] === "}") {
      const frame = open.pop()!;
      const body = css.slice(frame.start, i);
      if (!body.includes("{")) {
        rules.push({
          at: open.map((o) => o.prelude).filter((p) => p.startsWith("@") && !p.startsWith("@layer")),
          selector: frame.prelude.replace(/\s+/g, " "),
          body,
        });
      }
      preludeStart = i + 1;
    }
  }
  return rules;
}

/** The declarations of every rule whose selector list contains exactly `selector` under the at-rule `at`. */
function declarations(source: string, selector: string, at = ""): string {
  return rulesOf(source)
    .filter((rule) => rule.at.join(" ") === at && rule.selector.split(",").map((part) => part.trim()).includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

const TOOLBAR = component("Toolbar");
const GRID = component("CatalogGrid");
const ROW = component("PackageRow");
const CARD = component("PackageCard");

describe("the extractor", () => {
  test("it flattens at-rules and finds a rule by selector, and finds nothing for a missing one", () => {
    const src = "<style>@layer ocx { .a, .b { color: red; } @media (max-width: 1px) { .a { color: blue; } } }</style>";
    expect(declarations(src, ".b")).toMatch(/red/);
    expect(declarations(src, ".a", "@media (max-width: 1px)")).toMatch(/blue/);
    expect(declarations(src, ".a", "@media (max-width: 2px)")).toBe("");
    expect(declarations(src, ".c")).toBe("");
  });
});

describe("C11 toolbar layout", () => {
  test("D-003 the chip row scrolls sideways instead of overflowing, and the meta row wraps", () => {
    expect(declarations(TOOLBAR, ".chips")).toMatch(/overflow-x:\s*auto/);
    expect(declarations(TOOLBAR, ".meta")).toMatch(/flex-wrap:\s*wrap/);
  });

  test("D-006 many indexes scroll inside the scope bar", () => {
    const scope = declarations(TOOLBAR, ".scope");
    expect(scope).toMatch(/overflow-x:\s*auto/);
    expect(scope).toMatch(/max-inline-size:\s*100%/);
    expect(declarations(TOOLBAR, ".scope :global(.ocx-toggle-group)")).toMatch(/flex-shrink:\s*0/);
  });

  test("D-008 the chip row pads for its focus rings and gives the room back with a negative margin", () => {
    for (const selector of [".chips", ".chip-group.chip-rail"]) {
      const body = declarations(TOOLBAR, selector);
      expect(body, selector).toMatch(/padding:\s*var\(--ocx-space-2\)/);
      expect(body, selector).toMatch(/margin:\s*calc\(-1 \* var\(--ocx-space-2\)\)/);
    }
  });

  test("D-015 an active filter chip shows a close glyph and hides the theme's check", () => {
    expect(declarations(TOOLBAR, '.toolbar :global(.ocx-ui-tag[data-variant="filter"] > .ocx-ui-tag__check)')).toMatch(/display:\s*none/);
    const glyph = declarations(TOOLBAR, '.toolbar :global(.ocx-ui-tag[data-variant="filter"][aria-pressed="true"])::after');
    expect(glyph).toMatch(/content:\s*"\\00d7"/);
  });

  test("D-014 a popover chip's count is its data-count drawn after the name, ahead of the close glyph: no element per count", () => {
    const count = declarations(TOOLBAR, ".more-list :global([data-grid-chip])::before");
    expect(count).toMatch(/content:\s*attr\(data-count\)/);
    expect(count).toMatch(/margin-inline-start:\s*auto/);
    expect(declarations(TOOLBAR, '.more-list :global([data-grid-chip][aria-pressed="true"])::after')).toMatch(/order:\s*2/);
    expect(component("KeywordChip")).not.toMatch(/data-field="count"/);
  });

  test("D-016 a divider rule of the border colour separates the platform and keyword groups", () => {
    expect(TOOLBAR).toMatch(/<span class="chip-divider" aria-hidden="true">/);
    expect(declarations(TOOLBAR, ".chip-divider")).toMatch(/background:\s*var\(--ocx-color-border\)/);
  });

  test("D-018 the scrolling rows hide their scrollbar in every engine", () => {
    for (const selector of [".chips", ".chip-group.chip-rail", ".scope"]) {
      expect(declarations(TOOLBAR, selector), selector).toMatch(/scrollbar-width:\s*none/);
    }
    expect(declarations(TOOLBAR, ".chips::-webkit-scrollbar")).toMatch(/display:\s*none/);
    expect(declarations(TOOLBAR, ".scope::-webkit-scrollbar")).toMatch(/display:\s*none/);
  });

  test("D-018 the check can fail: a template without the webkit rule reports none", () => {
    expect(declarations(TOOLBAR.replaceAll("::-webkit-scrollbar", "::-x"), ".chips::-webkit-scrollbar")).toBe("");
  });
});

describe("C13 card and table layout", () => {
  test("D-023 the card grid is auto-fill at 300px, two columns from 640px, one below, and the skeleton shares every rule", () => {
    for (const selector of [".cards", ".skeleton"]) {
      const base = declarations(GRID, selector);
      expect(base, selector).toMatch(/repeat\(auto-fill, minmax\(300px, 1fr\)\)/);
      expect(base, selector).toMatch(/gap:\s*var\(--ocx-space-3\)/);
      expect(declarations(GRID, selector, "@media (min-width: 640px) and (max-width: 1199px)"), selector).toMatch(/repeat\(2, 1fr\)/);
      expect(declarations(GRID, selector, "@media (max-width: 639px)"), selector).toMatch(/grid-template-columns:\s*1fr/);
    }
  });

  test("D-004 the table folds its columns at 899px and 639px, and the row hides the same cells at the same widths", () => {
    expect(declarations(GRID, ".table", "@media (max-width: 899px)")).toMatch(/grid-template-columns:/);
    expect(declarations(GRID, ".table", "@media (max-width: 639px)")).toMatch(/grid-template-columns:/);
    expect(declarations(ROW, ".row-desc", "@media (max-width: 899px)")).toMatch(/display:\s*none/);
    expect(declarations(ROW, ".row-platforms", "@media (max-width: 639px)")).toMatch(/display:\s*none/);
    expect(declarations(ROW, ".row-tags", "@media (max-width: 639px)")).toMatch(/display:\s*none/);
    // Seven tracks whole, six at 899px, four at 639px: the tracks follow the cells that remain.
    const tracks = (at: string) => declarations(GRID, ".table", at).match(/grid-template-columns:\s*([^;]+);/)![1]!.match(/minmax\([^)]*\)|auto/g)!.length;
    expect([tracks(""), tracks("@media (max-width: 899px)"), tracks("@media (max-width: 639px)")]).toEqual([7, 6, 4]);
  });

  test("D-041 the platform cell never collapses to zero columns and keeps room for the 'any platform' label", () => {
    const body = declarations(ROW, ".row-platforms");
    expect(body).toMatch(/repeat\(max\(1, var\(--os-cols, 0\)\), var\(--ocx-icon-md\)\)/);
    expect(body).toMatch(/min-inline-size:\s*4\.5rem/);
    expect(body).toMatch(/justify-items:\s*center/);
  });

  test("D-042 rows have a hover and focus fill, and a separator only between rows", () => {
    expect(declarations(ROW, ".pkg-row:hover")).toMatch(/background:\s*var\(--ocx-color-hover\)/);
    expect(declarations(ROW, ".pkg-row:focus-visible")).toMatch(/background:\s*var\(--ocx-color-hover\)/);
    expect(declarations(GRID, ".table .item + .item :global(.pkg-row)")).toMatch(/border-block-start:/);
    expect(declarations(ROW, ".pkg-row")).not.toMatch(/border/);
  });

  test("D-043 a card's name truncates with an ellipsis rather than overflowing", () => {
    expect(declarations(CARD, ".pkg-name")).toMatch(/text-overflow:\s*ellipsis/);
  });

  test("D-046 content-visibility is on the card alone: never on a table row (a subgrid item) nor on the list item", () => {
    expect(declarations(CARD, ".pkg-card")).toMatch(/content-visibility:\s*auto/);
    for (const [name, source] of [["PackageRow", ROW], ["CatalogGrid", GRID]] as const) {
      expect(rulesOf(source).filter((rule) => /content-visibility/.test(rule.body)), name).toEqual([]);
    }
  });

  test("D-046 the check can fail: a row source carrying the property is caught", () => {
    const planted = ROW.replace(".pkg-row {", ".pkg-row {\n      content-visibility: auto;");
    expect(rulesOf(planted).filter((rule) => /content-visibility/.test(rule.body))).toHaveLength(1);
  });
});

describe("Lighthouse accessibility: target size and contrast (CI web-quality)", () => {
  const NOT_FOUND = readFileSync(fileURLToPath(new URL("../../src/site/pages/404.astro", import.meta.url)), "utf8");

  test("a card's keyword chip is a 24px target and its strip is exactly that tall", () => {
    expect(declarations(CARD, '.pkg-keywords :global([data-slot="keyword"])')).toMatch(/min-block-size:\s*var\(--ocx-space-6\)/);
    expect(declarations(CARD, ".pkg-keywords")).toMatch(/max-block-size:\s*var\(--ocx-space-6\)/);
  });

  test("the keyword rail is hidden, not squeezed to a sliver, once the chip row has no room for a whole chip", () => {
    expect(declarations(TOOLBAR, ".chips")).toMatch(/container-type:\s*inline-size/);
    expect(declarations(TOOLBAR, ".chip-rail", "@container (inline-size < 40rem)")).toMatch(/visibility:\s*hidden/);
  });

  test("the 404 link uses the accent's small-text colour, never the 2.8:1 coral, hovered or not", () => {
    expect(declarations(NOT_FOUND, ".not-found-link")).toMatch(/color:\s*var\(--ocx-color-accent-fg\)/);
    expect(declarations(NOT_FOUND, ".not-found-link:hover")).toMatch(/color:\s*var\(--ocx-color-accent-fg\)/);
  });

  test("the checks can fail: the old coral rule is caught", () => {
    expect(declarations(NOT_FOUND.replace("accent-fg)", "accent)"), ".not-found-link")).not.toMatch(/accent-fg/);
    expect(declarations(CARD.replace("--ocx-space-6", "--ocx-space-5"), ".pkg-keywords")).not.toMatch(/space-6/);
  });
});

describe("C13 card chrome is drawn, not built", () => {
  test("D-001 the install button's $ prompt and copied tick are pseudo-elements, so a card carries no node for either", () => {
    expect(declarations(CARD, ".pkg-install::before")).toMatch(/content:\s*"\$"/);
    expect(declarations(CARD, ".pkg-install[data-copied]::after")).toMatch(/content:\s*"\\2713"/);
    expect(CARD).not.toMatch(/install-prefix/);
  });

  test("C-017 the card is its own grid: tile beside the identity, no head, title-row or platforms wrapper", () => {
    expect(declarations(CARD, ".pkg-card")).toMatch(/display:\s*grid/);
    expect(declarations(CARD, ".pkg-desc")).toMatch(/grid-column:\s*1 \/ -1/);
    for (const wrapper of ["pkg-head", "pkg-title-row", "pkg-platforms"]) expect(CARD, wrapper).not.toContain(wrapper);
  });

  test("C-017 the name takes its own row without sizing the columns above it: no width of its own, the row's as a minimum", () => {
    const name = declarations(CARD, ".pkg-name");
    expect(name).toMatch(/inline-size:\s*0/);
    expect(name).toMatch(/min-inline-size:\s*100%/);
  });
});

describe("C16 logo tile styles", () => {
  const dir = fileURLToPath(new URL("../../src/site", import.meta.url));
  const astroFiles = (path: string): string[] =>
    readdirSync(path).flatMap((entry) => {
      const full = join(path, entry);
      return statSync(full).isDirectory() ? astroFiles(full) : full.endsWith(".astro") ? [full] : [];
    });
  const styleOf = (file: string) => [...readFileSync(file, "utf8").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const withoutFallbackRule = (css: string) => css.replace(/\[data-(?:grid|identity)\] \.ocx-logo-tile\[data-state="fallback"\] \.ocx-logo-tile__image\[hidden\]\s*\{[^}]*\}/g, "");
  const BOXING = /ocx-logo-tile__image|logo-img|logo-box|--ocx-color-monogram/;

  test("D-037 D-011 no catalog style boxes the logo or mints a monogram colour: the tile's look is the theme's", () => {
    const offenders = astroFiles(dir).filter((file) => BOXING.test(withoutFallbackRule(styleOf(file))));
    expect(offenders).toEqual([]);
  });

  test("D-037 D-009 a logo that failed keeps its box, hidden over the monogram, so nothing after it moves", () => {
    const style = styleOf(join(dir, "components", "CatalogGrid.astro"));
    const rule = /\[data-grid\] \.ocx-logo-tile\[data-state="fallback"\] \.ocx-logo-tile__image\[hidden\]\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/visibility:\s*hidden/);
  });

  test("D-037 the exemption is only the fallback rule: any other rule naming the image is still caught", () => {
    expect(BOXING.test(withoutFallbackRule('[data-grid] .ocx-logo-tile[data-state="fallback"] .ocx-logo-tile__image[hidden] { display: block; }'))).toBe(false);
    expect(BOXING.test(withoutFallbackRule('[data-grid] .ocx-logo-tile[data-state="fallback"] .ocx-logo-tile__image[hidden] { display: block; } .ocx-logo-tile__image { opacity: 0; }'))).toBe(true);
  });

  test("D-037 the check can fail: a style naming the image is caught", () => {
    expect(BOXING.test(".ocx-logo-tile__image { border-radius: 4px; }")).toBe(true);
    expect(BOXING.test(".pkg-card { gap: 1px; }")).toBe(false);
  });
});
