// @vitest-environment happy-dom
//
// Reachability pin for the `routePath` argument PackageCard and PackageTable
// pass as `buildTagCopyActions`'s 4th parameter. `brand_install_wiring.test.ts`
// calls `buildTagCopyActions` DIRECTLY, so it proves the function's own
// behaviour but nothing about whether either component actually threads its
// own qualified route through — dropping the argument at both call sites
// (falling back to `buildTagCopyActions(name, tag, flavors)`, which then
// falls back to `window.location.pathname`) stays green there. This opens
// the real right-click menu on the real rendered component and asserts what
// actually gets copied.
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

// PackageCard/PackageTable each call `useClipboard()` for their own
// right-click menu's `copy-text` prop. happy-dom has no Clipboard API, so a
// real `useClipboard` would silently no-op (or throw) rather than prove
// anything — this replaces just `copy`, keeping every other `@vueuse/core`
// export (CatalogPage's own `useLocalStorage` view-toggle among them) real.
const copied: string[] = [];
vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vueuse/core")>();
  return {
    ...actual,
    useClipboard: () => ({ copy: (text: string) => { copied.push(text); }, copied: ref(false), isSupported: ref(true) }),
  };
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts's cache/in-flight state is module-level — re-import fresh
  // per test (same pattern index_scope_wiring.test.ts uses).
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  copied.length = 0;
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

/** Same shape as index_scope_wiring.test.ts's MULTI — a non-root index whose
 * pages are qualified (`/acme/platform/deploy-kit`), so the copied link is
 * wrong in a way a bare-route fixture could never catch. */
const MULTI = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: true, count: 1 },
    { name: "acme", root: false, count: 1 },
  ],
  packages: [pkg("ocx.sh/widgets/tool"), pkg("acme/platform/deploy-kit")],
};

async function mountCatalog() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MULTI) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.find(".package-card, .table-row").exists()).toBe(true));
  // Scope to the non-root index — its route is the qualified one.
  await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[2]!.trigger("click");
  return wrapper;
}

/** Opens the real reka-ui context menu on `trigger` (a `.package-card` or
 * `.table-row` anchor) and clicks the item labelled "Copy link". Portals to
 * `<body>`, same reasoning as `palette_route_wiring.test.ts`'s modal. */
async function copyLinkFrom(trigger: ReturnType<typeof mount>["element"] | Element) {
  trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
  await vi.waitFor(() => expect(document.querySelectorAll(".copy-ctx-item").length).toBeGreaterThan(0));
  const items = [...document.querySelectorAll<HTMLElement>(".copy-ctx-item")];
  const copyLink = items.find(el => el.textContent?.trim() === "Copy link");
  if (!copyLink) throw new Error(`no "Copy link" item — menu had ${items.map(el => el.textContent).join(", ")}`);
  copyLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("copy-link route wiring — the card's context menu", () => {
  test("copies the qualified route of a non-root index's package, not a bare path", async () => {
    const wrapper = await mountCatalog();
    const card = wrapper.find(".package-card").element;

    await copyLinkFrom(card);

    expect(copied).toEqual([`${window.location.origin}/acme/platform/deploy-kit`]);
  });
});

describe("copy-link route wiring — the table row's context menu", () => {
  test("copies the qualified route of a non-root index's package, not a bare path", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog();
    const row = wrapper.find(".table-row").element;

    await copyLinkFrom(row);

    expect(copied).toEqual([`${window.location.origin}/acme/platform/deploy-kit`]);
  });
});
