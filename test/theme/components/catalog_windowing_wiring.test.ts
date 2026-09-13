// @vitest-environment happy-dom
//
// The catalog at corporate size. Two bounds keep it from building and
// painting every package it shows, and each fails silently in its own way:
// a missing paint bound only shows up as seconds on a slow machine, and a
// window that is not actually wired into the page leaves `useWindowedList`
// fully unit-tested and reaching nothing (the exact "fully covered, fully
// orphaned" trap subsystem-tests.md records).
//
// So the window is asserted through the REAL rendered page, and the paint
// bound is read out of the component source the way `layer_contract.test.ts`
// reads it — happy-dom lays nothing out, so no assertion here can prove the
// browser honours either. `task quality:web`'s view-switch probe is where a
// real engine gets a say.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

import { WINDOW_SIZE } from "../../../src/theme/composables/useWindowedList";

/** Source of a component, comments blanked out so a rule merely DISCUSSED in
 * prose can never satisfy an assertion about a rule that must be declared. */
function componentSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The declarations of one flat rule block, by exact selector. */
function declarationsOf(relPath: string, selector: string): string {
  const source = componentSource(relPath);
  const match = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(
    source,
  );
  if (match === null) throw new Error(`no rule for selector ${selector} in ${relPath}`);
  return match[2]!;
}

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;
/** Every page mounted by a test, unmounted after it. Clearing the body is
 * not enough: `useLocalStorage` refs in a detached-but-alive page still hear
 * a later test's storage write (vueuse mirrors writes across instances), and
 * a view switch patched into detached DOM throws from inside the click. */
const mounted: VueWrapper[] = [];

beforeEach(() => {
  // useCatalog.ts caches at module level — re-import fresh per test.
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function pkg(index: number) {
  const leaf = `tool-${String(index).padStart(3, "0")}`;
  return {
    namespace: "tools",
    package: leaf,
    name: `ocx.sh/tools/${leaf}`,
    status: "active" as const,
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title: leaf,
    description: "A package",
    keywords: ["cli"],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}

/** Comfortably more than one window, so a slice and the whole list can never
 * be the same number by accident. */
const BIG = WINDOW_SIZE * 3 + 7;

function catalogOf(count: number) {
  return { generated: "2026-01-01T00:00:00Z", packages: Array.from({ length: count }, (_, i) => pkg(i)) };
}

async function mountCatalog(payload: unknown) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  mounted.push(wrapper);
  await vi.waitFor(() => expect(wrapper.find(".package-card, .table-row").exists()).toBe(true));
  return wrapper;
}

describe("the catalog builds a window, not the whole list", () => {
  test("the card grid renders one window of a long catalog", async () => {
    const wrapper = await mountCatalog(catalogOf(BIG));

    expect(wrapper.findAll(".package-card")).toHaveLength(WINDOW_SIZE);
  });

  test("the table renders one window too — it is where the cost was worst", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    const wrapper = await mountCatalog(catalogOf(BIG));

    expect(wrapper.findAll(".table-row")).toHaveLength(WINDOW_SIZE);
  });

  // The window is a RENDER slice. A reader told "48 of 48 packages" while the
  // catalog holds 151 has been lied to by an optimisation, which is worse
  // than the slow page it replaced.
  test("the result count reports the whole catalog, not the window", async () => {
    const wrapper = await mountCatalog(catalogOf(BIG));

    expect(wrapper.find(".result-meta").text()).toContain(String(BIG));
    expect(wrapper.find(".result-meta").text()).not.toContain(`${WINDOW_SIZE} packages`);
  });

  test("a catalog inside one window renders whole, with no sentinel", async () => {
    const wrapper = await mountCatalog(catalogOf(6));

    expect(wrapper.findAll(".package-card")).toHaveLength(6);
    expect(wrapper.find(".catalog-sentinel").exists()).toBe(false);
  });

  // Without an element to observe the window can never grow, and the rest of
  // the catalog becomes unreachable by scrolling.
  test("a windowed catalog renders the sentinel that grows it", async () => {
    const wrapper = await mountCatalog(catalogOf(BIG));

    const sentinel = wrapper.find(".catalog-sentinel");
    expect(sentinel.exists()).toBe(true);
    // A scroll position, not content: the count above the list is what tells
    // a screen reader how many packages there are.
    expect(sentinel.attributes("aria-hidden")).toBe("true");
    // Outside the list, so it is not a stray non-`<li>` child of the `<ul>`.
    expect(wrapper.find(".catalog-grid .catalog-sentinel").exists()).toBe(false);
  });

  // The two views share no element types, so a switch rebuilds every item
  // the window holds. A reader who scrolled through 500 cards and then
  // toggled the table was paying for 500 rows — the switch reads as lag at a
  // couple of thousand packages. The window goes back to one slice instead.
  test("switching view rebuilds one slice, not everything the reader had scrolled through", async () => {
    // The browser's observer, reduced to the one call the composable makes
    // back into it: a stand-in that lets the test fire an intersection.
    const native = globalThis.IntersectionObserver;
    let fire: (() => void) | undefined;
    // @ts-expect-error — only the surface `useIntersectionObserver` calls.
    globalThis.IntersectionObserver = class {
      constructor(callback: (entries: { isIntersecting: boolean }[], observer: unknown) => void) {
        fire = () => callback([{ isIntersecting: true }], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      const wrapper = await mountCatalog(catalogOf(BIG));
      fire?.();
      await vi.waitFor(() => expect(wrapper.findAll(".package-card")).toHaveLength(WINDOW_SIZE * 2));

      await wrapper.find('.view-toggle button[title="Table view"]').trigger("click");

      await vi.waitFor(() => expect(wrapper.findAll(".table-row")).toHaveLength(WINDOW_SIZE));
      expect(wrapper.find(".result-meta").text()).toContain(String(BIG));
    } finally {
      globalThis.IntersectionObserver = native;
    }
  });

  // Arrow-key movement walks the rendered cards, so it clamps at the end of
  // what is built. That must be a stop, not a crash or a lost focus.
  test("arrow movement clamps at the last built card without losing focus", async () => {
    const wrapper = await mountCatalog(catalogOf(BIG));
    const cards = wrapper.findAll(".package-card");
    const last = cards[cards.length - 1]!;
    (last.element as HTMLElement).focus();

    await last.trigger("keydown", { key: "ArrowDown" });

    expect(document.activeElement).toBe(last.element);
  });
});

describe("off-screen cards and rows stay out of layout and paint", () => {
  test("the card carries the paint bound and an intrinsic size to hold its place", () => {
    const card = declarationsOf("src/theme/components/catalog/PackageCard.vue", ".package-card");

    expect(card).toContain("content-visibility: auto");
    // Without `auto` the browser never learns the real height and the
    // scrollbar keeps jumping as you scroll.
    expect(card).toMatch(/contain-intrinsic-size:\s*auto\s+\d/);
  });

  // The row must NOT carry it. `content-visibility` implies layout
  // containment at all times, and a subgrid under layout containment is not
  // a subgrid: Chromium 152 resolves the row's `grid-template-columns` to
  // `none` and every cell stacks on its own line — the whole table reads as
  // a list of seven-line entries. Shipped once, on the strength of a claim
  // copied from another repo rather than reproduced here.
  test("the subgrid table row does not carry it", () => {
    const row = declarationsOf("src/theme/components/catalog/PackageTable.vue", ".table-row");

    expect(row).toContain("grid-template-columns: subgrid");
    expect(row).not.toContain("content-visibility");
  });

  // The bound belongs on the card, which IS the grid item. The `<li>` around
  // it is `display: contents` and generates no box, so a bound written there
  // would apply to nothing at all while looking entirely correct.
  test("the bound is not written on the display:contents list item", () => {
    const item = declarationsOf("src/theme/components/catalog/CatalogPage.vue", ".catalog-grid-item");

    expect(item).toContain("display: contents");
    expect(item).not.toContain("content-visibility");
  });
});
