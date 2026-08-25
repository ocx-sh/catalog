// @vitest-environment happy-dom
//
// Reachability pin for the index-scope control. `.vue` internals are excluded
// from coverage by design, so a green coverage run says nothing about whether
// a SHIPPED entrypoint renders these tabs, scopes the grid by them, or links
// a non-default index's package to its own page. This asserts the real
// rendered DOM of the real CatalogPage, which is the only honest gate here
// (see subsystem-tests.md's "coverage cannot detect unreachable production
// code").
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts's cache/in-flight state is module-level — re-import fresh
  // per test (same pattern catalog_a11y_wiring.test.ts uses).
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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

const OCX_TOOL = pkg("ocx.sh/widgets/tool");
const ACME_TOOL = pkg("acme/widgets/tool");
const ACME_KIT = pkg("acme/platform/deploy-kit");

/** A catalog whose `indexes` envelope says two sources were merged — the
 * shape `sources_pipeline.ts` emits only for a genuinely multi-source
 * render. */
const MULTI = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: true, default: true, count: 1 },
    { name: "acme", root: false, default: false, count: 2 },
  ],
  packages: [OCX_TOOL, ACME_KIT, ACME_TOOL],
};

/** One ROOT source. The envelope ships for every catalog the pipeline
 * resolves — one entry, and it is the default — so the routes are bare and
 * there is no scope to pick. */
const SINGLE = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [{ name: "ocx.sh", root: true, default: true, count: 1 }],
  packages: [OCX_TOOL],
};

/** One NON-ROOT source — the config `scripts/dev-indexes.mjs` ships as
 * `single-noroot`, and the one that used to 404 on every link. Its pages are
 * written at `/<label>/<ns>/<pkg>` because qualification is decided per
 * source, so the envelope has to say so even though there is only one entry.
 * A one-entry envelope with no `root` is not the same thing as no envelope. */
const SINGLE_NONROOT = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [{ name: "acme", root: false, default: false, count: 2 }],
  packages: [ACME_KIT, ACME_TOOL],
};

/** Two NON-ROOT sources, one of them marked `default: true` in config. No
 * source is mirrored at the site root, so every route stays qualified — and
 * the catalog still opens on a named index rather than on "all". This is the
 * case the `root` flag alone could not express: `root` decides placement,
 * `default` decides where an arriving visitor lands. */
const MULTI_NOROOT_DEFAULT = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: false, default: false, count: 1 },
    { name: "acme", root: false, default: true, count: 2 },
  ],
  packages: [OCX_TOOL, ACME_KIT, ACME_TOOL],
};

/** What a catalog.json written by something OTHER than this renderer looks
 * like — the Python bot emits no `indexes` key. Bare routes, no scope. */
const NO_ENVELOPE = { generated: "2026-01-01T00:00:00Z", packages: [OCX_TOOL] };

async function mountCatalog(payload: unknown) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage);
  await vi.waitFor(() => expect(wrapper.find(".package-card").exists()).toBe(true));
  return wrapper;
}

const cardNames = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll(".package-card").map(card => card.attributes("href"));

describe("index scope — the tab row only exists for an aggregating catalog", () => {
  test("a single-source catalog renders no scope control at all", async () => {
    const wrapper = await mountCatalog(SINGLE);

    expect(wrapper.find('[data-slot="index-tabs"]').exists()).toBe(false);
  });

  // Presence of the envelope is NOT the question the tab row asks — it ships
  // for every catalog now. A one-entry envelope means one place to be.
  test("a lone non-root index renders no scope control either, envelope or not", async () => {
    const wrapper = await mountCatalog(SINGLE_NONROOT);

    expect(wrapper.find('[data-slot="index-tabs"]').exists()).toBe(false);
    // …and does not put a scope in the address bar for a scope you cannot pick.
    expect(window.location.search).not.toContain("index=");
  });

  // The whole point of B1: a lone non-root source's pages are written at
  // /<label>/<ns>/<pkg>, so every link has to be qualified. It used to fall
  // back to the bare path — a 404 on every card, table row and ⌘K result.
  test("a lone non-root index links its packages at their qualified route", async () => {
    const wrapper = await mountCatalog(SINGLE_NONROOT);

    expect(cardNames(wrapper)).toEqual([
      "/acme/platform/deploy-kit",
      "/acme/widgets/tool",
    ]);
  });

  test("a catalog.json with no envelope at all keeps bare routes", async () => {
    const wrapper = await mountCatalog(NO_ENVELOPE);

    expect(cardNames(wrapper)).toEqual(["/widgets/tool"]);
    expect(wrapper.find('[data-slot="index-tabs"]').exists()).toBe(false);
  });

  test("a multi-source catalog renders one tab per index plus all, with counts", async () => {
    const wrapper = await mountCatalog(MULTI);

    const tabs = wrapper.find('[data-slot="index-tabs"]').findAll(".index-tab");
    expect(tabs.map(tab => tab.find(".index-name").text())).toEqual(["all", "ocx.sh", "acme"]);
    // Counts are the post-merge totals, so they add up to the "all" tab's.
    expect(tabs.map(tab => tab.find(".index-count").text())).toEqual(["3", "1", "2"]);
    // Only the default index is marked, and only because it explains why it
    // is the one already selected.
    expect(tabs.map(tab => tab.find(".index-default").exists())).toEqual([false, true, false]);
  });
});

describe("index scope — what is selected, and what the grid shows", () => {
  // Arriving at an aggregating catalog puts you IN its default index rather
  // than in an undifferentiated merge of everything.
  test("the default index is preselected and the grid is scoped to it", async () => {
    const wrapper = await mountCatalog(MULTI);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("ocx.sh");
    expect(cardNames(wrapper)).toEqual(["/widgets/tool"]);
  });

  test("selecting an index scopes the grid to that index's packages", async () => {
    const wrapper = await mountCatalog(MULTI);

    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[2]!.trigger("click");

    expect(cardNames(wrapper)).toEqual(["/acme/platform/deploy-kit", "/acme/widgets/tool"]);
  });

  test("selecting all widens the grid back to every index", async () => {
    const wrapper = await mountCatalog(MULTI);

    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[0]!.trigger("click");

    expect(cardNames(wrapper)).toHaveLength(3);
  });

  // Neither a root NOR a default source anywhere: nothing is more default
  // than anything else, so the catalog opens on the widest scope instead of
  // picking one.
  test("with no default index configured, all is what is selected", async () => {
    const wrapper = await mountCatalog({
      ...MULTI,
      indexes: [
        { name: "ocx.sh", root: false, default: false, count: 1 },
        { name: "acme", root: false, default: false, count: 2 },
      ],
    });

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("all");
    expect(cardNames(wrapper)).toHaveLength(3);
  });

  // The case the `root` flag alone could not express, and the reason
  // `default` exists: no source is mirrored at the site root — so every route
  // stays qualified, `ocx.sh` included — and the catalog still opens on the
  // index config named. Preselection and placement are answered separately.
  test("a catalog with no root index still opens on the one marked default", async () => {
    const wrapper = await mountCatalog(MULTI_NOROOT_DEFAULT);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("acme");
    expect(cardNames(wrapper)).toEqual(["/acme/platform/deploy-kit", "/acme/widgets/tool"]);

    // The badge marks the same entry the preselection did — one field, read
    // twice, never two rules that can drift apart.
    const tabs = wrapper.find('[data-slot="index-tabs"]').findAll(".index-tab");
    expect(tabs.map(tab => tab.find(".index-default").exists())).toEqual([false, false, true]);

    // …and nothing about the default moved a URL: `ocx.sh` is not root, so
    // its own package is still linked at its qualified route.
    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[0]!.trigger("click");
    expect(cardNames(wrapper)).toContain("/ocx.sh/widgets/tool");
  });
});

describe("index scope — the address bar is the link", () => {
  test("a scoped view is restored from ?index= before the first paint", async () => {
    window.history.replaceState({}, "", "/?index=acme");

    const wrapper = await mountCatalog(MULTI);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("acme");
    expect(cardNames(wrapper)).toHaveLength(2);
  });

  // An index this deployment does not have must not strand a visitor on an
  // empty grid with a tab row that shows no selection.
  test("an unknown ?index= falls back to the default index", async () => {
    window.history.replaceState({}, "", "/?index=does-not-exist");

    const wrapper = await mountCatalog(MULTI);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("ocx.sh");
  });

  // The bug this pins: "all" used to be written as the ABSENCE of `?index=`,
  // which is also what a first visit looks like — so sharing the all view
  // handed the recipient a link that silently reopened on the default index.
  test("all is shareable: it is written explicitly, not as an absent param", async () => {
    const wrapper = await mountCatalog(MULTI);

    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[0]!.trigger("click");

    expect(window.location.search).toBe("?index=");
  });

  test("a shared all link reopens on all, not on the default index", async () => {
    window.history.replaceState({}, "", "/?index=");

    const wrapper = await mountCatalog(MULTI);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("all");
    expect(cardNames(wrapper)).toHaveLength(3);
  });

  // Landing with no param at all is a genuinely different state from picking
  // "all", and still resolves to the default index.
  test("no param at all still resolves to the default index", async () => {
    const wrapper = await mountCatalog(MULTI);

    expect(wrapper.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("ocx.sh");
  });

  // A catalog with nothing to scope has no scope to state.
  test("a single-source catalog never writes an index param", async () => {
    const wrapper = await mountCatalog(SINGLE);
    await wrapper.find(".search-field").setValue("tool");

    expect(window.location.search).toBe("?q=tool");
  });

  // The bug this pins: `useCatalog` caches the catalog at module level, so on
  // ANY return visit — Back from a package page, or any client-side nav to
  // the catalog — `indexes` is already populated when the page sets up and
  // never changes. Scope resolution hung off a watch alone, so the URL was
  // read and then ignored: the address bar said one index, the grid showed
  // all of them. Every other test here resets modules first, which is
  // exactly why none of them could see it.
  test("returning with a warm catalog cache still restores the scope from the URL", async () => {
    const first = await mountCatalog(MULTI);
    first.unmount();

    window.history.replaceState({}, "", "/?index=acme");
    const second = await mountCatalog(MULTI);

    expect(second.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("acme");
    expect(cardNames(second)).toHaveLength(2);
  });

  // Weaker than its neighbour on purpose, and worth saying so: `activeIndex`
  // starts null on every mount, so this one cannot redden if scope
  // resolution stops running altogether. What it does guard is that an
  // explicit "all" on the warm path is not mistaken for "unrecognised" and
  // quietly upgraded to the default index.
  test("a warm cache restores an explicitly shared all view too", async () => {
    const first = await mountCatalog(MULTI);
    first.unmount();

    window.history.replaceState({}, "", "/?index=");
    const second = await mountCatalog(MULTI);

    expect(second.find('[data-slot="index-tabs"] .index-tab.active').text()).toContain("all");
    expect(cardNames(second)).toHaveLength(3);
  });

  test("picking an index writes it into the URL without adding a history entry", async () => {
    const wrapper = await mountCatalog(MULTI);
    const before = window.history.length;

    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[2]!.trigger("click");

    expect(window.location.search).toBe("?index=acme");
    // replaceState, not pushState: Back from a package page must land on the
    // catalog as you left it, not walk back through every tab you clicked.
    expect(window.history.length).toBe(before);
  });

  // The bug this pins: the URL mirror rebuilt the whole query string from `q`
  // alone while `q` was the only mirrored state. Left that way, the next
  // keystroke would silently drop the scope out of the address bar.
  test("typing a query keeps the index in the URL", async () => {
    const wrapper = await mountCatalog(MULTI);

    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[2]!.trigger("click");
    await wrapper.find(".search-field").setValue("deploy");

    expect(window.location.search).toBe("?index=acme&q=deploy");
  });

  // The bug this pins: on a COLD load, `onMounted` sets `query.value` from
  // `?q=` before the catalog fetch has resolved, so the URL-mirroring watch
  // fires once while `indexes` is still undefined — `hasScope` is false at
  // that moment — and rewrites the address bar to just `?q=…`, dropping the
  // `index=` already there (including the explicit empty value meaning
  // "all"). `resolveScope` then settles `activeIndex` at its own initial
  // value (`null` for "all"), so that settle produces no reactive CHANGE and
  // the watch never fires again: the grid ends up correctly scoped but the
  // address bar silently reopens on "all" for anyone who re-shares it.
  // Mutation guard: dropping `indexes` from the watch's source array reds
  // this (verified — see the worker's report).
  test("a cold load with ?index=&q=… restores BOTH once the scope settles", async () => {
    window.history.replaceState({}, "", "/?index=&q=tool");

    const wrapper = await mountCatalog(MULTI);

    expect(window.location.search).toBe("?index=&q=tool");
    expect(cardNames(wrapper)).toHaveLength(2);
  });
});

describe("index scope — a package link names the index it came from", () => {
  test("the root index keeps bare routes, every other index qualifies", async () => {
    const wrapper = await mountCatalog(MULTI);
    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[0]!.trigger("click");

    // `widgets/tool` exists in BOTH indexes. Without the qualified route the
    // two cards would link to one page and one of them would be wrong.
    // Catalog order, untouched by the scope: the sort default keeps the
    // catalog's own package order.
    expect(cardNames(wrapper)).toEqual([
      "/widgets/tool",
      "/acme/platform/deploy-kit",
      "/acme/widgets/tool",
    ]);
  });

  test("a single-source catalog's routes stay bare", async () => {
    const wrapper = await mountCatalog(SINGLE);

    expect(cardNames(wrapper)).toEqual(["/widgets/tool"]);
  });
});

describe("index scope — the card prints the whole qualified name", () => {
  // No badge, no dot, no coloured edge: the identity line already carries the
  // index as its first segment, and a second marker for the same fact is
  // decoration.
  test("the identity line shows the index prefix, not the bare name", async () => {
    const wrapper = await mountCatalog(MULTI);
    await wrapper.findAll('[data-slot="index-tabs"] .index-tab')[2]!.trigger("click");

    expect(wrapper.findAll(".card-name").map(el => el.text())).toEqual([
      "acme/platform/deploy-kit",
      "acme/widgets/tool",
    ]);
  });
});

describe("index scope — the result count is relative to the PLACE, not the whole catalog", () => {
  // Before the fix, ResultMeta's `total` was the whole aggregated catalog (3
  // packages) while `filtered` was already scope-filtered (1, the default
  // "ocx.sh" scope) — the meta line read "1 of 3 packages" with no filters
  // line and no clear button (the scope is deliberately excluded from
  // `activeFilterLabels`, since it's a place you're in, not a filter chip),
  // which reads as an unexplained narrowing on an aggregating catalog's very
  // first paint.
  test("with no filters applied, the default scope reads 'N packages', not 'N of M'", async () => {
    const wrapper = await mountCatalog(MULTI);

    const count = wrapper.find(".count").text();
    expect(count).not.toContain(" of ");
    expect(count).toBe("1 packages");
  });
});
