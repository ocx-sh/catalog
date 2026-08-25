// @vitest-environment happy-dom
//
// C-606 shipped-entrypoint reachability pin (mirrors `brand_install_wiring
// .test.ts`'s own reasoning): `.vue` SFCs carry no branch-coverage gate
// (vitest.config.ts excludes `**/*.vue`), so a `defineAsyncComponent` split
// that silently pointed at the wrong module, or never resolved at all,
// would be invisible to the coverage percentage. This proves the REAL
// `Layout.vue`, mounted, both (a) keeps the catalog grid — the entry route
// every visitor hits first — eager/synchronous, and (b) actually resolves
// the async-loaded DetailPage branch to real rendered content, not a
// permanently-blank placeholder.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ref } from "vue";

const pageState = ref<Record<string, unknown>>({ isNotFound: false, relativePath: "widgets/tool.md" });
const frontmatterState = ref<Record<string, unknown>>({});

vi.mock("vitepress", () => ({
  useData: () => ({
    page: pageState,
    frontmatter: frontmatterState,
    theme: ref({}),
    isDark: ref(false),
    localeIndex: ref("root"),
  }),
  useRoute: () => ({ path: "/" }),
  useRouter: () => ({ go: vi.fn() }),
}));

// SearchModal.vue imports `@localSearchIndex`, a VitePress
// local-search-Vite-plugin-only virtual module (see its own docblock) that
// has no meaning outside a real `vitepress build`/`dev` run.
// `vitest.config.ts` now aliases it to a stub so the palette can be mounted
// at all (`palette_route_wiring.test.ts` does exactly that), but this test
// is about Layout's async-component split, not about the palette: the
// module-level mock keeps Vue's async-
// component resolution for it never touches the real file at all. The
// `__esModule`/`__isTeleport`/`__isKeepAlive`/`__isSuspense` markers mirror
// what a real ES module namespace object carries — `@vue/test-utils`'
// default child-component introspection (Transition/Teleport/KeepAlive
// detection) reads them on every rendered vnode, and vitest's mock-module
// proxy throws on any accessed property the factory didn't explicitly
// return.
vi.mock("../../../src/theme/components/search/SearchModal.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  __isKeepAlive: false,
  __isSuspense: false,
  default: { name: "SearchModal", template: '<div class="search-modal-stub" />' },
}));

const Layout = (await import("../../../src/theme/Layout.vue")).default;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  pageState.value = { isNotFound: false, relativePath: "widgets/tool.md" };
  frontmatterState.value = {};
});

describe("C-606 Layout.vue source — the split itself", () => {
  const SOURCE = readFileSync(resolve(process.cwd(), "src/theme/Layout.vue"), "utf8");

  test("DetailPage, DocLayout, and SearchModal are loaded via defineAsyncComponent", () => {
    for (const name of ["DetailPage", "DocLayout", "SearchModal"]) {
      expect(SOURCE).toMatch(new RegExp(`const ${name} = defineAsyncComponent\\(\\(\\) => import\\(`));
    }
  });

  test("CatalogPage stays a static import — the grid's own entry chunk ships eagerly", () => {
    expect(SOURCE).toMatch(/^import CatalogPage from '\.\/components\/catalog\/CatalogPage\.vue'$/m);
    expect(SOURCE).not.toMatch(/const CatalogPage = defineAsyncComponent/);
  });

  test("carries a skip link targeting #main-content", () => {
    expect(SOURCE).toContain('href="#main-content"');
  });
});

describe("C-606 Layout.vue mounted", () => {
  test("the catalog route renders CatalogPage synchronously, no async wait needed", async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    frontmatterState.value = { layout: "catalog" };

    const wrapper = mount(Layout);
    // No `await` before THIS assertion, on purpose — CatalogPage is a plain
    // static import, so it must already be in the DOM the instant mount()
    // returns, unlike DetailPage/DocLayout below.
    expect(wrapper.find(".catalog-page").exists()).toBe(true);
    expect(wrapper.find("#main-content").exists()).toBe(true);
    // SearchModal (always mounted, regardless of route) is ALSO async —
    // let its loader settle before tearing the tree down.
    await flushPromises();
    wrapper.unmount();
  });

  test("the detail route resolves through defineAsyncComponent and renders DetailPage's real DOM", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 })) as unknown as typeof fetch;
    frontmatterState.value = { layout: "detail" };
    pageState.value = { isNotFound: false, relativePath: "widgets/tool.md" };

    const wrapper = mount(Layout);
    await vi.waitFor(() => expect(wrapper.find(".detail-page").exists()).toBe(true));
    // Real content, not a dead/blank async boundary: usePackageRoot's own
    // 404 handling renders the not-found state.
    await vi.waitFor(() => expect(wrapper.text()).toContain("Package not found"));
    expect(wrapper.find("#main-content").exists()).toBe(true);
    await flushPromises();
    wrapper.unmount();
  });
});
