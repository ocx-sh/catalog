// @vitest-environment happy-dom
//
// C-603: whole-package `status: 'yanked'` (distinct from a PER-TAG yank,
// already surfaced by TagBadge/VersionTree) used to be invisible everywhere
// — no badge, no banner, no filter. This pins the RENDERED result on every
// surface the contract names: grid card, table row, detail identity block,
// a detail-page banner, and the filter chip.
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const relativePath = ref("widgets/tool.md");
vi.mock("vitepress", () => ({
  useData: () => ({ page: ref({ relativePath: relativePath.value }), isDark: ref(false) }),
}));

const PackageCard = (await import("../../../src/theme/components/catalog/PackageCard.vue")).default;
const PackageTable = (await import("../../../src/theme/components/catalog/PackageTable.vue")).default;
const IdentityBlock = (await import("../../../src/theme/components/detail/IdentityBlock.vue")).default;
const FilterChips = (await import("../../../src/theme/components/catalog/FilterChips.vue")).default;
const DetailPage = (await import("../../../src/theme/components/detail/DetailPage.vue")).default;

function catalogPkg(status: "active" | "deprecated" | "yanked") {
  return {
    namespace: "widgets",
    package: "tool",
    name: "ocx.sh/widgets/tool",
    status,
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
}

describe("C-603 PackageCard yanked badge", () => {
  test("status yanked renders a YANKED badge, not DEPRECATED", () => {
    const html = mount(PackageCard, { props: { pkg: catalogPkg("yanked") } }).html();
    expect(html).toContain("YANKED");
    expect(html).not.toContain("DEPRECATED");
  });

  test("status deprecated still renders DEPRECATED, not YANKED", () => {
    const html = mount(PackageCard, { props: { pkg: catalogPkg("deprecated") } }).html();
    expect(html).toContain("DEPRECATED");
    expect(html).not.toContain("YANKED");
  });

  test("status active renders neither badge", () => {
    const html = mount(PackageCard, { props: { pkg: catalogPkg("active") } }).html();
    expect(html).not.toContain("DEPRECATED");
    expect(html).not.toContain("YANKED");
  });
});

describe("C-603 PackageTable yanked badge", () => {
  test("status yanked renders a YANKED badge in the row", () => {
    const html = mount(PackageTable, { props: { packages: [catalogPkg("yanked")] } }).html();
    expect(html).toContain("YANKED");
    expect(html).not.toContain("DEPRECATED");
  });
});

describe("C-603 IdentityBlock yanked badge", () => {
  const ROOT = {
    name: "ocx.sh/widgets/tool",
    repository: "oci://ghcr.io/acme/tool",
    owners: [{ github: "acme" }],
    deprecated_message: null,
    created: "2026-01-01T00:00:00Z",
    desc: null,
    tags: {},
  };

  test("status yanked renders a YANKED badge, not DEPRECATED", () => {
    const html = mount(IdentityBlock, {
      props: { root: { ...ROOT, status: "yanked" as const }, bareName: "widgets/tool", latestVersionLabel: null },
    }).html();
    expect(html).toContain("YANKED");
    expect(html).not.toContain("DEPRECATED");
  });
});

describe("C-603 FilterChips yanked chip", () => {
  const BASE_PROPS = {
    activePlatforms: [],
    visibleKeywords: [],
    allKeywords: [],
    activeKeywords: [],
    hiddenKeywordCount: 0,
    deprecatedActive: false,
    yankedActive: false,
  };

  test("renders a yanked chip alongside deprecated, inactive by default", () => {
    const html = mount(FilterChips, { props: BASE_PROPS }).html();
    expect(html).toContain("yanked");
    expect(html).toContain("deprecated");
  });

  test("yankedActive marks the chip active and shows the clear glyph", () => {
    const html = mount(FilterChips, { props: { ...BASE_PROPS, yankedActive: true } }).html();
    expect(html).toMatch(/chip-yanked[^>]*active/);
  });

  test("clicking the yanked chip emits toggle-yanked", async () => {
    const wrapper = mount(FilterChips, { props: BASE_PROPS });
    await wrapper.find(".chip-yanked").trigger("click");
    expect(wrapper.emitted("toggle-yanked")).toHaveLength(1);
  });
});

describe("C-603 DetailPage yanked banner (shipped-entrypoint reachability)", () => {
  const originalFetch = globalThis.fetch;

  function mockFetchRouter(routes: Record<string, unknown>) {
    return vi.fn((url: string) => {
      const body = routes[url];
      if (body === undefined) return Promise.resolve({ ok: false, status: 404 });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
  }

  test("a whole-package yanked root renders the yanked banner, not the deprecation banner", async () => {
    relativePath.value = "widgets/yanked.md";
    globalThis.fetch = mockFetchRouter({
      "/p/widgets/yanked.json": {
        name: "ocx.sh/widgets/yanked",
        repository: "oci://ghcr.io/acme/tool",
        owners: [{ github: "acme" }],
        status: "yanked",
        deprecated_message: null,
        created: "2026-01-01T00:00:00Z",
        desc: null,
        tags: {},
      },
    });

    const wrapper = mount(DetailPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Yanked"));

    expect(wrapper.find(".yanked-banner").exists()).toBe(true);
    expect(wrapper.find(".deprecation-banner").exists()).toBe(false);

    globalThis.fetch = originalFetch;
    wrapper.unmount();
  });
});
