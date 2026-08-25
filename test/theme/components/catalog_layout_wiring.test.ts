// @vitest-environment happy-dom
//
// Issue #5's four layout/interaction defects in the catalog grid, table and
// toolbar. `.vue` internals are excluded from coverage by design, so a green
// coverage run says nothing about any of them: what follows asserts the real
// rendered DOM of the real components, plus — for the two fixes that are
// purely CSS — the declarations the browser actually needs, read out of the
// component source the same way `layer_contract.test.ts` reads it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";
import FilterChips from "../../../src/theme/components/catalog/FilterChips.vue";

/** Source of a component, comments blanked out so a rule merely DISCUSSED in
 * prose can never satisfy an assertion about a rule that must be declared.
 * `process.cwd()` rather than `css_contract_helpers`' `import.meta.url` —
 * this file runs under happy-dom, where that resolves to a Vite `/@fs/` URL.
 * (Same reason `toolbar_keyboard_operable_wiring.test.ts` reads this way.) */
function componentSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts caches at module level — re-import fresh per test (same
  // pattern index_scope_wiring.test.ts uses).
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function pkg(name: string, platforms: string[], keywords: string[] = ["cli"]) {
  const [, namespace, ...rest] = name.split("/");
  return {
    namespace: namespace!,
    package: rest.join("/"),
    name,
    status: "active" as const,
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title: rest.join("/"),
    description: "A package",
    keywords,
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms,
    logoUrl: null,
    readmeUrl: null,
  };
}

/** linux-only, darwin-only, and one shipping both — so a packed row and a
 * fixed-slot row are visibly different shapes. No package ships windows, so
 * the catalog's OS set is exactly {linux, darwin}. */
const CATALOG = {
  generated: "2026-01-01T00:00:00Z",
  packages: [
    pkg("ocx.sh/tools/penguin", ["linux/amd64", "linux/arm64"]),
    pkg("ocx.sh/tools/apple", ["darwin/arm64"]),
    pkg("ocx.sh/tools/both", ["linux/amd64", "darwin/arm64"]),
  ],
};

async function mountCatalog(payload: unknown = CATALOG) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  // Attached: the Tab handler and every focus assertion below read
  // `document.activeElement`, which only means anything for a mounted tree.
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.find(".package-card, .table-row").exists()).toBe(true));
  return wrapper;
}

/** The declarations of one rule block, by exact selector, out of a `.vue`
 * file's `<style>` source. Comments are stripped first so a rule discussed
 * in prose never matches.
 *
 * ponytail: `[^}]*` stops at the FIRST `}`, so a rule containing a nested
 * block (`@media`, CSS nesting) yields a truncated body and a `toContain`
 * below could pass or fail for the wrong reason. Value matches are literal
 * too — `flex: 1 1 auto` reds on the equivalent `flex: 1 1 0%`. Both are
 * acceptable while every selector asserted here is a flat rule with
 * hand-written values; the upgrade is a balanced-brace scan, and the signal
 * to make it is the first nested block landing in one of these selectors.
 *
 * Not a substitute for the layout assertions above it either — these pin
 * that a DECLARATION was written, never that the browser lays out the way it
 * implies. `task quality:web` is where a real engine gets a say. */
function declarationsOf(relPath: string, selector: string): string {
  const source = componentSource(relPath);
  const match = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(
    source,
  );
  if (match === null) throw new Error(`no rule for selector ${selector} in ${relPath}`);
  return match[2]!;
}

describe("issue #5 item 5 — Tab out of the search field reaches the results", () => {
  test("plain Tab from the search field focuses the first package card", async () => {
    const wrapper = await mountCatalog();
    const input = wrapper.find(".search-field");
    (input.element as HTMLInputElement).focus();

    await input.trigger("keydown", { key: "Tab" });

    expect(document.activeElement).toBe(wrapper.findAll(".package-card")[0]!.element);
  });

  test("in table view it focuses the first row instead", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();
    const input = wrapper.find(".search-field");
    (input.element as HTMLInputElement).focus();

    await input.trigger("keydown", { key: "Tab" });

    expect(document.activeElement).toBe(wrapper.findAll(".table-row")[0]!.element);
  });

  // Shift+Tab is how the toolbar stays reachable now that forward Tab skips
  // it, so the handler must not swallow it.
  test("Shift+Tab is left entirely alone", async () => {
    const wrapper = await mountCatalog();
    const input = wrapper.find(".search-field");
    (input.element as HTMLInputElement).focus();

    await input.trigger("keydown", { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(input.element);
  });

  // Trapping focus in a field with nowhere to send it would be worse than
  // the defect: with no results, Tab must behave exactly as it always did.
  test("with no results the event is not prevented", async () => {
    const wrapper = await mountCatalog();
    await wrapper.find(".search-field").setValue("nothing-matches-this-at-all");
    await vi.waitFor(() => expect(wrapper.find(".package-card").exists()).toBe(false));

    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
    wrapper.find(".search-field").element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("issue #5 item 7 — table platform icons sit in fixed, aligned slots", () => {
  test("every row draws one cell per OS the catalog publishes, supported or not", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();

    const cells = wrapper.findAll(".t-platforms").map(el => el.element.children.length);
    // {linux, darwin} — two slots on every row, including the darwin-only
    // package that used to render a single left-packed icon.
    expect(cells).toEqual([2, 2, 2]);
  });

  test("an unsupported OS renders an empty slot, not a missing one", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();

    const rows = wrapper.findAll(".t-platforms");
    // linux-only: the linux glyph, then an empty darwin slot.
    expect(rows[0]!.findAll("svg")).toHaveLength(1);
    expect(rows[0]!.findAll(".t-os-empty")).toHaveLength(1);
    // Ships both: two glyphs, no empty slot.
    expect(rows[2]!.findAll("svg")).toHaveLength(2);
    expect(rows[2]!.findAll(".t-os-empty")).toHaveLength(0);
  });

  // The whole point of a fixed slot is that it does not move. Columns
  // derived from the FILTERED rows would collapse to one the moment you
  // clicked a platform chip, which is the defect wearing a different hat.
  test("the columns come from the whole catalog, not the filtered rows", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();
    await wrapper.find(".search-field").setValue("penguin");
    await vi.waitFor(() => expect(wrapper.findAll(".t-platforms")).toHaveLength(1));

    expect(wrapper.find(".t-platforms").element.children.length).toBe(2);
  });
});

describe("issue #5 item 3 — the chip rail shrinks instead of wrapping", () => {
  const chipProps = {
    activePlatforms: [],
    visibleKeywords: [{ keyword: "cli", count: 3 }],
    allKeywords: [{ keyword: "cli", count: 3 }],
    activeKeywords: [],
    hiddenKeywordCount: 2,
    deprecatedActive: false,
    yankedActive: false,
  };

  // The CSS below only works on this grouping: flatten the rail back into
  // one row of siblings and nothing has a shrinkable middle any more.
  test("keywords and status chips live in their own groups", () => {
    const wrapper = mount(FilterChips, { props: chipProps });

    expect(wrapper.findAll(".chip-platforms button.chip")).toHaveLength(3);
    expect(wrapper.findAll(".chip-keywords button.chip")).toHaveLength(1);
    expect(wrapper.findAll(".chip-status button.chip").map(b => b.text())).toEqual([
      "deprecated",
      "yanked",
    ]);
  });

  test("the rail never wraps, and only the keyword group absorbs the shrink", () => {
    const rail = declarationsOf("src/theme/components/catalog/FilterChips.vue", ".filter-chips");
    expect(rail).toContain("flex-wrap: nowrap");

    const keywords = declarationsOf("src/theme/components/catalog/FilterChips.vue", ".chip-keywords");
    expect(keywords).toContain("flex: 1 1 auto");
    expect(keywords).toContain("min-width: 0");
    expect(keywords).toContain("overflow-x: auto");
  });

  // The status chips were pushed to the right by an auto margin, which on an
  // overflowing flex line can put them out of scroll reach. The growing
  // keyword group does that job now.
  test("no auto margin survives on the status chips", () => {
    const source = componentSource("src/theme/components/catalog/FilterChips.vue");
    expect(source).not.toMatch(/margin-left:\s*auto/);
  });

  // The overflowing groups scroll; a visible scrollbar under the chips would
  // change the rail's height as the window narrows, which is the same layout
  // jump the whole change removes.
  test("neither scroller shows a scrollbar", () => {
    const source = componentSource("src/theme/components/catalog/FilterChips.vue");
    expect(source).toContain("scrollbar-width: none");
    expect(source).toMatch(/::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
});

describe("issue #5 item 8 — card keywords never wrap, so cards match in height", () => {
  test("the keyword strip is a single clipped line", () => {
    const keywords = declarationsOf("src/theme/components/catalog/PackageCard.vue", ".card-keywords");
    expect(keywords).toContain("flex-wrap: nowrap");
    expect(keywords).toContain("overflow: hidden");
    // Without this the strip refuses to shrink below its content and the
    // clip never engages — `overflow: hidden` alone would be inert.
    expect(keywords).toContain("min-width: 0");
  });

  test("individual chips are clipped whole, not squeezed", () => {
    expect(declarationsOf("src/theme/components/catalog/PackageCard.vue", ".card-keyword")).toContain(
      "flex-shrink: 0",
    );
  });
});

describe("review — filter-only emptying gets its own copy and a working clear button", () => {
  // Under AND-within-facet semantics (issue #5 item 6) filter-only emptying
  // is the common path, not a query typo — the old copy always headlined
  // `No matches for ""` on an empty query string, with a `clear search`
  // button that emitted a no-op (`query = ''` when `query` was already '').
  // Nothing on the panel named the filter that actually emptied the grid.
  test("selecting a platform no package ships empties the grid without touching the query", async () => {
    const wrapper = await mountCatalog();
    const windowsChip = wrapper.findAll(".chip-platforms .chip").find(c => c.text().includes("windows"));
    if (!windowsChip) throw new Error("no windows platform chip rendered");

    await windowsChip.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".package-card").exists()).toBe(false);
    expect(wrapper.find(".empty-title").text()).toBe("No packages match windows");

    const clearBtn = wrapper.find(".cta-outline");
    expect(clearBtn.text()).toBe("clear filters");

    await clearBtn.trigger("click");

    await vi.waitFor(() => expect(wrapper.findAll(".package-card")).toHaveLength(3));
  });
});

describe("review — the '+N more' popover's counts are scored against the filtered set", () => {
  function kwPkg(leaf: string, keywords: string[]) {
    return {
      namespace: "tools",
      package: leaf,
      name: `ocx.sh/tools/${leaf}`,
      status: "active" as const,
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-01-01T00:00:00Z",
      updated: null,
      title: leaf,
      description: "A package",
      keywords,
      latestVersion: "1.0.0",
      tagCount: 1,
      platforms: ["linux/amd64"],
      logoUrl: null,
      readmeUrl: null,
    };
  }

  // Two disjoint keyword families — filtering by "alpha" leaves every "beta"
  // package, and both its own-only keywords, with zero survivors. The
  // popover's LIST stays the whole-catalog vocabulary (it is the one way
  // back to a keyword the rescored rail dropped — issue #5 item 6), but a
  // whole-catalog COUNT on a keyword no survivor carries reads e.g. "2
  // packages" and lands on a guaranteed empty grid.
  const CATALOG_KW = {
    generated: "2026-01-01T00:00:00Z",
    packages: [
      kwPkg("a-one", ["alpha", "a-one-only"]),
      kwPkg("a-two", ["alpha", "a-two-only"]),
      kwPkg("b-one", ["beta", "b-one-only"]),
      kwPkg("b-two", ["beta", "b-two-only"]),
    ],
  };

  test("a keyword no surviving package carries reads 0, not its whole-catalog count", async () => {
    const wrapper = await mountCatalog(CATALOG_KW);
    // Re-imported AFTER `mountCatalog`'s own dynamic `import()` of CatalogPage
    // (itself post the per-test `vi.resetModules()`), so this resolves to the
    // SAME module instance CatalogPage's internal import already cached —
    // the module-level `import FilterChips from …` at the top of this file
    // was evaluated once at file-collection time and is stale by now, which
    // is why `findComponent` against it would silently match nothing.
    const FilterChipsLive = (await import("../../../src/theme/components/catalog/FilterChips.vue")).default;
    const alphaChip = wrapper.findAll(".chip-keywords .chip").find(c => c.text().replace("✕", "").trim() === "alpha");
    if (!alphaChip) throw new Error("no rail chip labelled alpha");

    await alphaChip.trigger("click");
    await wrapper.vm.$nextTick();

    const allKeywords = wrapper.findComponent(FilterChipsLive).props("allKeywords") as { keyword: string, count: number }[];
    const byKeyword = new Map(allKeywords.map(k => [k.keyword, k.count]));

    // The LIST is still the complete vocabulary — nothing dropped.
    expect([...byKeyword.keys()].sort()).toEqual(
      ["a-one-only", "a-two-only", "alpha", "b-one-only", "b-two-only", "beta"].sort(),
    );
    // Survivors score their real count against the filtered set…
    expect(byKeyword.get("alpha")).toBe(2);
    expect(byKeyword.get("a-one-only")).toBe(1);
    // …and a keyword no surviving package carries reads 0, not the
    // whole-catalog count it used to advertise.
    expect(byKeyword.get("beta")).toBe(0);
    expect(byKeyword.get("b-one-only")).toBe(0);
    expect(byKeyword.get("b-two-only")).toBe(0);
  });
});
