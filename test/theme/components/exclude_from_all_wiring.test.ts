// @vitest-environment happy-dom
//
// Reachability pin for `sources[].excludeFromAll` -> `indexes[].excludeFromAll`
// -> the catalog page's "all" tab. `.vue` internals are coverage-excluded, so
// only the real rendered DOM of the real CatalogPage proves the flag reaches
// the grid, the "all" tab's count, the keyword rail/vocabulary and the table's
// platform columns — and that an excluded index stays fully reachable through
// its own tab. The unit half (the `excludeIndexes` predicate) lives in
// `test/site/lib/filterPackages.test.ts`.
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function pkg(name: string, keywords: string[], platforms: string[]) {
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

const PROD_A = pkg("ocx.sh/tools/alpha", ["prod"], ["linux/amd64"]);
const PROD_B = pkg("ocx.sh/tools/beta", ["prod"], ["linux/amd64"]);
// Carries the ONLY windows platform and the ONLY `devonly` keyword in the
// catalog, so the vocabulary and the table columns each have something to leak.
const DEV_A = pkg("dev.example/tools/gamma", ["devonly"], ["windows/amd64"]);
const DEV_B = pkg("dev.example/tools/delta", ["devonly"], ["windows/amd64"]);

const PACKAGES = [DEV_B, DEV_A, PROD_A, PROD_B];

function catalogWith(devExcluded: boolean | undefined) {
  return {
    generated: "2026-01-01T00:00:00Z",
    indexes: [
      { name: "ocx.sh", root: true, default: false, count: 2 },
      {
        name: "dev.example",
        root: false,
        default: false,
        count: 2,
        ...(devExcluded === undefined ? {} : { excludeFromAll: devExcluded }),
      },
    ],
    packages: PACKAGES,
  };
}

async function mountCatalog(payload: unknown) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage);
  await vi.waitFor(() => expect(wrapper.find('[data-slot="index-tabs"], .empty-title, .package-card').exists()).toBe(true));
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountCatalog>>;

const cardNames = (wrapper: Wrapper) => wrapper.findAll(".package-card").map(card => card.attributes("href"));
const tab = (wrapper: Wrapper, name: string) =>
  wrapper.findAll('[data-slot="index-tabs"] .index-tab').find(t => t.find(".index-name").text() === name)!;
const tabCounts = (wrapper: Wrapper) =>
  wrapper.findAll('[data-slot="index-tabs"] .index-tab').map(t => t.find(".index-count").text());
const railLabels = (wrapper: Wrapper) => wrapper.findAll(".chip-keywords .chip").map(c => c.text().trim());

describe("excludeFromAll — the all tab omits the excluded index", () => {
  test("grid lists only the included index's packages, and the count agrees", async () => {
    const wrapper = await mountCatalog(catalogWith(true));

    expect(cardNames(wrapper)).toEqual(["/tools/alpha", "/tools/beta"]);
    expect(wrapper.find(".result-meta .count").text()).toBe("2 packages");
    // "all" is 2, not 4; the excluded index still advertises its OWN two.
    expect(tabCounts(wrapper)).toEqual(["2", "2", "2"]);
  });

  test("the keyword rail and the +N more vocabulary never mention the excluded index's keywords", async () => {
    const wrapper = await mountCatalog(catalogWith(true));

    expect(railLabels(wrapper)).toEqual(["prod"]);
    // `hiddenKeywordCount` is the vocabulary minus the rail: a leaked
    // `devonly` would surface here as a "+1 more" chip.
    expect(wrapper.find(".chip-more").exists()).toBe(false);
  });

  test("the table draws no platform column only the excluded index ships", async () => {
    window.localStorage.setItem("ocx-catalog-view", "table");
    const wrapper = await mountCatalog(catalogWith(true));
    await vi.waitFor(() => expect(wrapper.find(".table-row").exists()).toBe(true));

    expect(wrapper.find(".t-platforms").attributes("style")).toContain("--os-cols: 1");
  });

  test("the empty-state total is the all view's, not the whole catalog's", async () => {
    const wrapper = await mountCatalog(catalogWith(true));

    await wrapper.find("input").setValue("zzzznomatch");
    await vi.waitFor(() => expect(wrapper.find(".empty-copy").exists()).toBe(true));

    expect(wrapper.find(".empty-copy").text()).toContain("2 packages total");
  });
});

describe("excludeFromAll — the excluded index stays reachable", () => {
  test("its own tab lists its packages at their qualified routes, and counts them", async () => {
    const wrapper = await mountCatalog(catalogWith(true));

    await tab(wrapper, "dev.example").trigger("click");

    expect(cardNames(wrapper)).toEqual(["/dev.example/tools/delta", "/dev.example/tools/gamma"]);
    expect(wrapper.find(".result-meta .count").text()).toBe("2 packages");
    // The "all" tab keeps its own count while another tab is active.
    expect(tabCounts(wrapper)[0]).toBe("2");
  });

  test("the excluded index's keyword vocabulary is available on its own tab", async () => {
    const wrapper = await mountCatalog(catalogWith(true));

    await tab(wrapper, "dev.example").trigger("click");

    expect(railLabels(wrapper)).toContain("devonly");
  });

  test("?index=<excluded> restores that tab on a cold load", async () => {
    window.history.replaceState({}, "", "/?index=dev.example");

    const wrapper = await mountCatalog(catalogWith(true));

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active .index-name').text()).toBe("dev.example");
    expect(cardNames(wrapper)).toEqual(["/dev.example/tools/delta", "/dev.example/tools/gamma"]);
  });

  test("going back to all hides it again", async () => {
    window.history.replaceState({}, "", "/?index=dev.example");
    const wrapper = await mountCatalog(catalogWith(true));

    await tab(wrapper, "all").trigger("click");

    expect(cardNames(wrapper)).toEqual(["/tools/alpha", "/tools/beta"]);
  });
});

describe("excludeFromAll — absent, false, and degenerate cases", () => {
  test.each([
    ["absent (a catalog.json this renderer did not write)", undefined],
    ["false", false],
  ])("%s -> all lists every index", async (_label, flag) => {
    const wrapper = await mountCatalog(catalogWith(flag));

    expect(cardNames(wrapper)).toHaveLength(4);
    expect(tabCounts(wrapper)[0]).toBe("4");
  });

  // Documented behaviour: exclusion applies regardless. Every index of an
  // aggregating catalog excluded leaves "all" empty rather than second-guessing
  // the config; each index tab still works.
  test("every index excluded -> all is empty, each index tab still lists its own", async () => {
    const payload = catalogWith(true);
    payload.indexes[0] = { ...payload.indexes[0]!, excludeFromAll: true } as (typeof payload.indexes)[number];
    const wrapper = await mountCatalog(payload);

    expect(cardNames(wrapper)).toEqual([]);
    expect(wrapper.find(".empty-title").text()).toContain("No packages in this view");
    expect(tabCounts(wrapper)).toEqual(["0", "2", "2"]);

    await tab(wrapper, "ocx.sh").trigger("click");
    expect(cardNames(wrapper)).toEqual(["/tools/alpha", "/tools/beta"]);
  });

  // A one-index catalog has no "all" tab to exclude from (`hasScope`), so the
  // flag cannot strand its only index behind an empty, unlabelled grid. Both
  // shapes: a root/default lone index opens scoped to itself, a lone non-root
  // one opens on "all" (`activeIndex === null`) — the case the guard is for.
  test.each([
    ["root and default", { root: true, default: true }, ["/tools/alpha", "/tools/beta"]],
    ["non-root, non-default", { root: false, default: false }, ["/ocx.sh/tools/alpha", "/ocx.sh/tools/beta"]],
  ])("a lone %s index with the flag set still shows its packages", async (_label, placement, links) => {
    const wrapper = await mountCatalog({
      generated: "2026-01-01T00:00:00Z",
      indexes: [{ name: "ocx.sh", ...placement, count: 2, excludeFromAll: true }],
      packages: [PROD_A, PROD_B],
    });

    expect(wrapper.find('[data-slot="index-tabs"]').exists()).toBe(false);
    expect(cardNames(wrapper)).toEqual(links);
  });
});
