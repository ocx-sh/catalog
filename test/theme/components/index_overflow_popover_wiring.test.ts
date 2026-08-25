// @vitest-environment happy-dom
//
// Reachability pin for IndexTabs.vue's overflow popover. No fixture anywhere
// in this suite configures more than MAX_INLINE (6) indexes, so
// `.index-more`, `.index-popover` and `.index-popover-item` have never been
// mounted by a test — the branch is exercised only by the manual
// `task dev:catalog CASE=many` harness. This mounts the real CatalogPage
// with 8 indexes, opens the real popover, and clicks a real entry.
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
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function pkg(name: string) {
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
    keywords: [],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: [],
    logoUrl: null,
    readmeUrl: null,
  };
}

// 8 indexes: MAX_INLINE (6) inline slots plus 2 that only the popover can
// reach. "idx-h" (the 8th, last-added) is the one the popover click tests
// pick — a fixture that only ever exercised the FIRST overflow entry would
// leave an off-by-one in the slice unnoticed.
const INDEX_NAMES = ["ocx.sh", "idx-b", "idx-c", "idx-d", "idx-e", "idx-f", "idx-g", "idx-h"];
const MANY = {
  generated: "2026-01-01T00:00:00Z",
  indexes: INDEX_NAMES.map((name, i) => ({ name, root: i === 0, count: 1 })),
  packages: INDEX_NAMES.map(name => pkg(`${name}/tools/widget`)),
};

async function mountCatalog() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANY) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.find(".package-card").exists()).toBe(true));
  return wrapper;
}

const cardNames = (wrapper: Awaited<ReturnType<typeof mountCatalog>>) =>
  wrapper.findAll(".package-card").map(card => card.attributes("href"));

describe("index tabs overflow — inline row caps at MAX_INLINE", () => {
  test("only the first 6 indexes render as inline tabs, the rest are the +N trigger", async () => {
    const wrapper = await mountCatalog();

    // "all" plus 6 inline indexes.
    expect(wrapper.find('[data-slot="index-tabs"]').findAll(".index-tab")).toHaveLength(7);
    const more = wrapper.find(".index-more");
    expect(more.exists()).toBe(true);
    expect(more.text()).toBe("+2");
  });
});

describe("index tabs overflow — the popover holds the rest and actually scopes the grid", () => {
  test("opening it lists exactly the overflowing indexes", async () => {
    const wrapper = await mountCatalog();

    await wrapper.find(".index-more").trigger("click");
    await vi.waitFor(() => expect(document.querySelectorAll(".index-popover-item").length).toBeGreaterThan(0));

    const items = [...document.querySelectorAll<HTMLElement>(".index-popover-item")];
    expect(items.map(el => el.querySelector(".index-name")!.textContent)).toEqual(["idx-g", "idx-h"]);
  });

  test("clicking a popover entry scopes the grid to that index, same as an inline tab", async () => {
    const wrapper = await mountCatalog();

    await wrapper.find(".index-more").trigger("click");
    await vi.waitFor(() => expect(document.querySelectorAll(".index-popover-item").length).toBeGreaterThan(0));
    const items = [...document.querySelectorAll<HTMLElement>(".index-popover-item")];
    const idxH = items.find(el => el.querySelector(".index-name")?.textContent === "idx-h")!;

    idxH.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await wrapper.vm.$nextTick();

    expect(cardNames(wrapper)).toEqual(["/idx-h/tools/widget"]);
    expect(window.location.search).toBe("?index=idx-h");
  });
});
