// @vitest-environment happy-dom
//
// C-604 shipped-entrypoint reachability: `useCatalog.ts`'s `error` state
// (previous edit in this change) is only real if the REAL `CatalogPage.vue`
// actually renders a distinct state for it — this proves a 5xx/malformed
// `catalog.json` never reads as "no packages published yet" (S-02), and
// that a genuine 404 still does.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // `useCatalog.ts`'s cache/in-flight state is module-level — re-import
  // fresh per test so one test's fetch result never leaks into the next
  // (same pattern `useCatalog.test.ts` itself uses).
  vi.resetModules();
  themeState.value = {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function freshCatalogPage() {
  const mod = await import("../../../src/theme/components/catalog/CatalogPage.vue");
  return mod.default;
}

describe("C-604 CatalogPage — fetch error state distinct from empty", () => {
  test("a 500 catalog.json response renders a distinct error state, not the empty-index message", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 }),
    ) as unknown as typeof fetch;

    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Failed to load"));

    expect(wrapper.text()).not.toContain("No packages published yet");
    wrapper.unmount();
  });

  test("a genuine 404 still renders the real empty-index message, no error state", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 }),
    ) as unknown as typeof fetch;

    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain("No packages published yet"));

    expect(wrapper.text()).not.toContain("Failed to load");
    wrapper.unmount();
  });

  test("a network-error fetch also renders the error state, carrying the real error message", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;

    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Failed to load"));

    expect(wrapper.text()).toContain("network down");
    wrapper.unmount();
  });

  test("the error state's retry button re-triggers the fetch and can recover", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(() => {
      call++;
      return call === 1
        ? Promise.resolve({ ok: false, status: 500 })
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ generated: null, packages: [] }),
          });
    }) as unknown as typeof fetch;

    const CatalogPage = await freshCatalogPage();
    const wrapper = mount(CatalogPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Failed to load"));

    await wrapper.find(".cta-outline").trigger("click");
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.text()).toContain("No packages published yet"));

    expect(call).toBe(2);
    wrapper.unmount();
  });
});
