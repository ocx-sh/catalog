// @vitest-environment happy-dom
//
// Owner finding: the keyword rail was scored against the WHOLE catalog, so
// after a filter it kept offering keywords no remaining package carries —
// and under AND semantics (issue #5 item 6) every one of those chips is a
// click straight to "no matches". The rail is now rescored against the
// current result set, with the active keywords pinned in front so a filter
// can always be lifted from where it was applied.
//
// `.vue` internals are coverage-excluded, so none of this is visible to the
// coverage gate; the real rendered DOM is the gate.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

/** Component source with comments blanked, so a rule merely DISCUSSED in
 * prose can never satisfy an assertion about a rule that must be declared.
 * `process.cwd()` rather than `import.meta.url` — under happy-dom the latter
 * resolves to a Vite `/@fs/` URL (same reason as
 * `catalog_layout_wiring.test.ts`). */
function componentSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // useCatalog.ts caches at module level — re-import fresh per test.
  vi.resetModules();
  themeState.value = { brand: { title: "Acme Packages" } };
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function pkg(leaf: string, keywords: string[]) {
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
    keywords,
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}

// Three disjoint families of three. Twelve distinct keywords in total, more
// than the rail's eight slots, so the rail genuinely has to choose — and no
// keyword is shared across two families, so picking a family keyword makes
// the other eight keywords unreachable in one click.
const CATALOG = {
  generated: "2026-01-01T00:00:00Z",
  packages: [
    pkg("a-one", ["alpha", "a-one-only"]),
    pkg("a-two", ["alpha", "a-two-only"]),
    pkg("a-three", ["alpha", "a-three-only"]),
    pkg("b-one", ["beta", "b-one-only"]),
    pkg("b-two", ["beta", "b-two-only"]),
    pkg("b-three", ["beta", "b-three-only"]),
    pkg("c-one", ["gamma", "c-one-only"]),
    pkg("c-two", ["gamma", "c-two-only"]),
    pkg("c-three", ["gamma", "c-three-only"]),
  ],
};

async function mountCatalog() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG) }),
  ) as unknown as typeof fetch;
  const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
  const wrapper = mount(CatalogPage, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.find(".package-card").exists()).toBe(true));
  return wrapper;
}

type Catalog = Awaited<ReturnType<typeof mountCatalog>>;

/** Rail chip labels, in rendered order, with the active chip's "✕" affordance
 * stripped back off. */
function railLabels(wrapper: Catalog): string[] {
  return wrapper.findAll(".chip-keywords .chip").map(c => c.text().replace("✕", "").trim());
}

async function clickChip(wrapper: Catalog, label: string) {
  const chip = wrapper.findAll(".chip-keywords .chip").find(c => c.text().replace("✕", "").trim() === label);
  if (!chip) throw new Error(`no rail chip labelled "${label}" — rail was ${railLabels(wrapper).join(", ")}`);
  await chip.trigger("click");
  await wrapper.vm.$nextTick();
}

describe("keyword rail — rescored against the current result set", () => {
  test("before any filter the rail spans all three families", async () => {
    const wrapper = await mountCatalog();
    expect(railLabels(wrapper)).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
  });

  test("filtering by one family drops every keyword no surviving package carries", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "alpha");

    // The result set is exactly the three alpha packages, so the only
    // keywords left in existence are alpha and the three a-*-only ones.
    const survivors = ["alpha", "a-one-only", "a-two-only", "a-three-only"];
    for (const label of railLabels(wrapper)) expect(survivors).toContain(label);
    expect(wrapper.findAll(".package-card")).toHaveLength(3);
  });

  test("every rail chip is carried by at least one visible package", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "beta");

    const visible = wrapper.findAll(".package-card").map(c => c.text());
    for (const label of railLabels(wrapper)) {
      const carried = CATALOG.packages.filter(p => p.keywords.includes(label));
      expect(carried.some(p => visible.some(text => text.includes(p.package)))).toBe(true);
    }
  });

  // The pin is what makes the rescoring safe: an active keyword scores ~0
  // once every surviving package carries it, so greedy would drop the very
  // chip you need to click again to undo the filter.
  test("the active keyword is pinned first and stays pressed", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "gamma");

    expect(railLabels(wrapper)[0]).toBe("gamma");
    expect(wrapper.findAll(".chip-keywords .chip")[0]!.attributes("aria-pressed")).toBe("true");
  });

  test("two selections both stay pinned, in click order", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "alpha");
    await clickChip(wrapper, "a-two-only");

    expect(railLabels(wrapper).slice(0, 2)).toEqual(["alpha", "a-two-only"]);
    expect(wrapper.findAll(".package-card")).toHaveLength(1);
  });

  test("deselecting restores the full-catalog rail", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "alpha");
    await clickChip(wrapper, "alpha");

    expect(railLabels(wrapper)).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
  });

  // The popover deliberately does NOT narrow: it is the complete vocabulary,
  // the one way back to a keyword the current result set no longer offers.
  test("the +N more popover still counts the whole catalog's keywords", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "alpha");

    // 12 keywords in the fixture, 8 rail slots at most, so the overflow
    // trigger has to be showing something.
    const more = wrapper.find(".chip-more");
    expect(more.exists()).toBe(true);
    expect(Number(more.text().replace(/\D/g, ""))).toBeGreaterThanOrEqual(12 - 8);
  });
});

describe("keyword rail — the set changing is animated, not teleported", () => {
  const CHIPS = "src/theme/components/catalog/FilterChips.vue";

  // A behavioral assertion (chips carrying `.chip-move`/`.chip-enter-active`/
  // `.chip-leave-active` mid-transition) was tried here first and does not
  // work under happy-dom: probed directly against the mounted rail — click a
  // chip, then inspect `.chip-keywords .chip` classList immediately, after
  // two animation frames, and after a 50ms wait — and the transition classes
  // never appear at any point. Vue's TransitionGroup reads
  // `getComputedStyle(...).transitionDuration` to decide whether there is
  // anything to animate; happy-dom never reports one, so the FLIP path is
  // skipped entirely rather than run and immediately finished. This falls
  // back to a source-level pin, kept order-independent (the original
  // asserted the three attributes in one exact sequence on the opening tag,
  // which a harmless attribute reorder would have reddened for no
  // behavioral reason) plus the rendered-children check below.
  test("the keyword group is a TransitionGroup, so FLIP measures the reorder", () => {
    const source = componentSource(CHIPS);
    const opening = /<TransitionGroup\b([^>]*)>/.exec(source);
    expect(opening, "no <TransitionGroup> opening tag found in " + CHIPS).not.toBeNull();
    const attrs = opening![1]!;
    expect(attrs).toMatch(/\bname="chip"/);
    expect(attrs).toMatch(/\btag="span"/);
    expect(attrs).toMatch(/\bclass="chip-keywords"/);
  });

  // What the source pin above cannot show: that `.chip-keywords` is the real
  // rendered group (not just declared in source) and that a rail change —
  // the event the TransitionGroup exists to animate — leaves it holding the
  // new chip set rather than an empty or stale one.
  test("a rail change leaves the group holding the new chip set as real children", async () => {
    const wrapper = await mountCatalog();
    await clickChip(wrapper, "gamma");

    const group = wrapper.find(".chip-keywords");
    expect(group.exists()).toBe(true);
    const chips = group.findAll(".chip");
    expect(chips.length).toBe(railLabels(wrapper).length);
    expect(chips.map(c => c.text().replace("✕", "").trim())).toEqual(railLabels(wrapper));
  });

  test("move, enter and leave all carry a transition, and a leaving chip leaves the flow", () => {
    const source = componentSource(CHIPS);
    // One rule covering all three states — a `.chip-move` without the
    // enter/leave pair animates the survivors but pops the newcomers in.
    expect(source).toMatch(/\.chip-move,\s*\.chip-enter-active,\s*\.chip-leave-active\s*\{[^}]*transition:/);
    expect(source).toMatch(/\.chip-enter-from,\s*\.chip-leave-to\s*\{[^}]*opacity:\s*0/);
    // Out of flow, or it holds its slot for the whole duration and the
    // survivors slide only after it is gone.
    expect(source).toMatch(/\.chip-leave-active\s*\{[^}]*position:\s*absolute/);
    // …which needs a positioned ancestor to land against.
    expect(source).toMatch(/\.chip-keywords\s*\{[^}]*position:\s*relative/);
  });
});
