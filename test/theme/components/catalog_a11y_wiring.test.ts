// @vitest-environment happy-dom
//
// C-607 a11y wiring pin: the landing page's <h1>, the card grid's <ul>/<li>
// list semantics, the filter-count status region, the skeleton's
// aria-hidden, and the sort control's no-nested-interactive restructure —
// each asserted against the REAL rendered DOM (mount + real markup), not a
// lexical grep alone, per this subsystem's own "coverage cannot detect
// unreachable production code" bar.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts's cache/in-flight state is module-level — re-import fresh
  // per test (same pattern catalog_fetch_error_wiring.test.ts uses).
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CATALOG_PACKAGE = {
  namespace: "widgets",
  package: "tool",
  name: "ocx.sh/widgets/tool",
  status: "active" as const,
  deprecatedMessage: null,
  supersededBy: null,
  created: "2026-01-01T00:00:00Z",
  updated: null,
  title: "Tool",
  description: "A tool",
  keywords: [],
  latestVersion: "1.0.0",
  tagCount: 1,
  platforms: [],
  logoUrl: null,
  readmeUrl: null,
};

async function freshCatalogPage() {
  const mod = await import("../../../src/theme/components/catalog/CatalogPage.vue");
  return mod.default;
}

async function mountLoadedCatalogPage() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ generated: "2026-01-01T00:00:00Z", packages: [CATALOG_PACKAGE] }),
    }),
  ) as unknown as typeof fetch;

  const CatalogPage = await freshCatalogPage();
  const wrapper = mount(CatalogPage);
  await vi.waitFor(() => expect(wrapper.find(".package-card").exists()).toBe(true));
  return wrapper;
}

describe("C-607 landing page <h1> + #main-content", () => {
  test("carries exactly one visually-hidden <h1> with the configured brand title, before the catalog even loads", async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch; // never resolves — stays in loading state
    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);

    const headings = wrapper.findAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.classes()).toContain("visually-hidden");
    expect(headings[0]!.text()).toBe("Acme Packages");
    expect(wrapper.find("#main-content").exists()).toBe(true);
    expect(wrapper.find("main").attributes("id")).toBe("main-content");
  });

  test("brand.title is schema-required (minLength 1), so the landing h1 is never empty — it renders the configured title verbatim", async () => {
    // C-607 empty-heading guard: `brand.title` is required by
    // src/config/schema/catalog.config.schema.json (`brand` at the root
    // `required` list, `title` at `$defs.brand.required`, pinned
    // `minLength: 1`) and typed as a non-optional `string` in
    // src/config/types.ts. A missing/empty title cannot pass config
    // validation, so `<h1>{{ brandTitle }}</h1>` is never `<h1></h1>` (the
    // axe/Lighthouse empty-heading violation an unbranded corporate mirror
    // would otherwise trip). The invariant is the schema's, not a hardcoded
    // fallback string — so the assertion pins a non-empty, data-driven
    // heading rather than locking in an (unreachable) empty one.
    themeState.value = { brand: { title: "Corporate Mirror" } };
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    const headings = wrapper.findAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.text()).toBe("Corporate Mirror");
    expect(headings[0]!.text().length).toBeGreaterThan(0);
  });
});

describe("C-607 CatalogGrid list semantics", () => {
  test("a loaded catalog renders the grid as a real <ul> with each card in its own <li>", async () => {
    const wrapper = await mountLoadedCatalogPage();
    const grid = wrapper.find("ul.catalog-grid");
    expect(grid.exists()).toBe(true);
    const items = grid.findAll("li.catalog-grid-item");
    expect(items).toHaveLength(1);
    expect(items[0]!.find(".package-card").exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("C-607 SkeletonGrid aria-hidden", () => {
  test("the loading skeleton grid is aria-hidden (nothing for a screen reader to announce)", async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    const grid = wrapper.find("ul.catalog-grid");
    expect(grid.exists()).toBe(true);
    expect(grid.attributes("aria-hidden")).toBe("true");
  });
});

describe("C-607 ResultMeta status region", () => {
  test("role=status/aria-atomic sits on the count span only, never the wrapper or the grid", async () => {
    const wrapper = await mountLoadedCatalogPage();
    const count = wrapper.find(".count");
    expect(count.attributes("role")).toBe("status");
    expect(count.attributes("aria-atomic")).toBe("true");
    expect(wrapper.find(".result-meta").attributes("role")).toBeUndefined();
    expect(wrapper.find("ul.catalog-grid").attributes("role")).toBeUndefined();
    wrapper.unmount();
  });
});

describe("C-607 sort direction control — no nested interactive", () => {
  test("the direction button is a real <button>, a sibling of the select trigger, never nested inside it", async () => {
    const wrapper = await mountLoadedCatalogPage();
    const sortControl = wrapper.find(".sort-control");
    expect(sortControl.exists()).toBe(true);

    const dirBtn = sortControl.find(".sort-dir-btn");
    expect(dirBtn.exists()).toBe(true);
    expect(dirBtn.element.tagName).toBe("BUTTON");

    const trigger = sortControl.find(".sort-trigger");
    expect(trigger.exists()).toBe(true);
    // Never nested — the old bug was a role="button" span INSIDE the trigger.
    expect(trigger.element.contains(dirBtn.element)).toBe(false);
    expect(trigger.find('[role="button"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test("clicking the direction button toggles aria-pressed without opening the select", async () => {
    const wrapper = await mountLoadedCatalogPage();
    const dirBtn = wrapper.find(".sort-dir-btn");
    const trigger = wrapper.find(".sort-trigger");
    expect(dirBtn.attributes("aria-pressed")).toBe("false");
    expect(trigger.attributes("aria-expanded")).toBe("false");

    await dirBtn.trigger("click");

    expect(dirBtn.attributes("aria-pressed")).toBe("true");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });
});

describe("C-607 color-scheme", () => {
  test("base.css declares color-scheme: light dark", () => {
    const css = readFileSync(resolve(process.cwd(), "src/theme/styles/base.css"), "utf8");
    expect(css).toMatch(/color-scheme:\s*light dark;/);
  });
});
