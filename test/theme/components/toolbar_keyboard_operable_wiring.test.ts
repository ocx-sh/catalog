// @vitest-environment happy-dom
//
// C-330 (owner-override, ADR Decision 3 — supersedes owner spec #44 for
// interactive toolbar controls): restores keyboard operability of the
// catalog toolbar. Spec #44's blanket `tabindex="-1"` made platform/keyword
// filtering, sort, view switching, and both clear buttons mouse-only — a
// WCAG 2.1.1 (A) failure. This pins BOTH that the literal `tabindex="-1"`
// never comes back in any of the five files it used to live in, AND that
// the real rendered controls carry no such override (a lexical pin alone
// can't tell "removed the attribute" from "removed the whole button").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import FilterChips from "../../../src/theme/components/catalog/FilterChips.vue";
import SearchInput from "../../../src/theme/components/catalog/SearchInput.vue";
import ResultMeta from "../../../src/theme/components/catalog/ResultMeta.vue";
import InstallRow from "../../../src/theme/components/catalog/InstallRow.vue";

/** Comments may still name the old attribute (see CatalogPage.vue's own
 * C-330 docblock) — only executable template/script text is checked. */
function sourceWithoutComments(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TOOLBAR_FILES = [
  "src/theme/components/catalog/FilterChips.vue",
  "src/theme/components/catalog/CatalogPage.vue",
  "src/theme/components/catalog/SearchInput.vue",
  "src/theme/components/catalog/ResultMeta.vue",
  "src/theme/components/catalog/InstallRow.vue",
];

describe("C-330 no tabindex=-1 anywhere in the toolbar's source", () => {
  test.each(TOOLBAR_FILES)("%s carries no blanket tabindex=-1", (relPath) => {
    expect(sourceWithoutComments(relPath)).not.toContain('tabindex="-1"');
  });
});

describe("C-330 FilterChips — every chip is a real Tab stop", () => {
  test("platform and keyword chip buttons carry no tabindex override", () => {
    const wrapper = mount(FilterChips, {
      props: {
        activePlatforms: [],
        visibleKeywords: [{ keyword: "cli", count: 3 }],
        allKeywords: [{ keyword: "cli", count: 3 }],
        activeKeywords: [],
        hiddenKeywordCount: 0,
        deprecatedActive: false,
        yankedActive: false,
      },
    });
    for (const btn of wrapper.findAll("button.chip")) {
      expect(btn.attributes("tabindex")).toBeUndefined();
    }
  });
});

describe("C-330 SearchInput — clear button is a real Tab stop", () => {
  test("the clear-search button carries no tabindex override", () => {
    const wrapper = mount(SearchInput, { props: { modelValue: "cmake" } });
    expect(wrapper.find(".search-clear").attributes("tabindex")).toBeUndefined();
  });
});

describe("C-330 ResultMeta — clear-filters button is a real Tab stop", () => {
  test("the clear-filters button carries no tabindex override", () => {
    const wrapper = mount(ResultMeta, {
      props: { total: 5, filtered: 2, activeFilterLabels: ["linux"], hasQuery: false },
    });
    expect(wrapper.find(".clear-btn").attributes("tabindex")).toBeUndefined();
  });
});

describe("C-330 InstallRow — the copy box is a real Tab stop", () => {
  test("the install-row button carries no tabindex override", () => {
    const wrapper = mount(InstallRow, { props: { qualifiedName: "ocx.sh/kitware/cmake" } });
    expect(wrapper.find(".install-row").attributes("tabindex")).toBeUndefined();
  });
});
