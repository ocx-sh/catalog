// @vitest-environment happy-dom
//
// Reachability pin for `elideMiddle`. `.vue` internals are excluded from
// coverage by design, and every fixture in the rest of this suite uses
// package names shorter than PackageCard's and PackageTable's own elision
// budgets (38 and 34 characters) — so a green coverage run has never once
// proven either component's `elideMiddle(...)` call actually runs. Deleting
// the call from either component (falling back to the bare `pkg.name`)
// leaves the whole suite green today; this file is what turns that red.
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts's cache/in-flight state is module-level — re-import fresh
  // per test (same pattern index_scope_wiring.test.ts uses).
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

// Three "/"-segments (so there IS a middle to drop) and 66 characters — well
// over both PackageCard's NAME_BUDGET (38) and PackageTable's IDENT_BUDGET
// (34). No other fixture in this suite reaches either budget.
const LONG_NAME = "ocx.sh/tools/a-really-long-nested-package-path-for-elision-testing";

const LONG_PKG = {
  namespace: "tools",
  package: "a-really-long-nested-package-path-for-elision-testing",
  name: LONG_NAME,
  status: "active" as const,
  deprecatedMessage: null,
  supersededBy: null,
  created: "2026-01-01T00:00:00Z",
  updated: null,
  title: "elision-testing",
  description: "A package with a long qualified name",
  keywords: [],
  latestVersion: "1.0.0",
  tagCount: 1,
  platforms: [],
  logoUrl: null,
  readmeUrl: null,
};

const CATALOG = { generated: "2026-01-01T00:00:00Z", packages: [LONG_PKG] };

async function mountCatalog() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.find(".package-card, .table-row").exists()).toBe(true));
  return wrapper;
}

describe("package identifier — middle elision reaches the card", () => {
  test("a long qualified name is elided in the middle, not by CSS truncation alone", async () => {
    const wrapper = await mountCatalog();

    const text = wrapper.find(".card-name").text();
    expect(text).not.toBe(LONG_NAME);
    expect(text).toContain("…");
    // Both ends survive: the first segment names the index the package came
    // from, the last is the package's own leaf name — the whole reason
    // `elideMiddle` exists instead of plain `text-overflow: ellipsis`.
    expect(text.startsWith("ocx.sh/")).toBe(true);
    expect(text.endsWith("a-really-long-nested-package-path-for-elision-testing")).toBe(true);
  });
});

describe("package identifier — middle elision reaches the table row", () => {
  test("a long qualified name is elided in the middle, not by CSS truncation alone", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();

    const text = wrapper.find(".t-ident").text();
    expect(text).not.toBe(LONG_NAME);
    expect(text).toContain("…");
    expect(text.startsWith("ocx.sh/")).toBe(true);
    expect(text.endsWith("a-really-long-nested-package-path-for-elision-testing")).toBe(true);
  });
});
