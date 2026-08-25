// @vitest-environment happy-dom
//
// Issue #5 item 4: the header's search trigger advertised a literal `⌘K` to
// every visitor, though `useCommandPalette.ts` answers to `metaKey || ctrlKey`
// — so on Linux and Windows the badge named a key the shortcut does not use.
// `modifierKey.ts` carries the detection and is unit-tested on its own; what
// is untestable there, and invisible to coverage because `.vue` internals are
// excluded, is whether the SHIPPED header actually reaches it. That is what
// this asserts (subsystem-tests.md, "coverage cannot detect unreachable
// production code").
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({ brand: { title: "Acme Packages" } });
vi.mock("vitepress", () => ({
  useData: () => ({ theme: themeState }),
  useRoute: () => ({ path: "/" }),
}));

const SiteHeader = (await import("../../../src/theme/components/layout/SiteHeader.vue")).default;

const hadNavigator = "navigator" in globalThis;
const realNavigator = (globalThis as { navigator?: unknown }).navigator;

function asPlatform(platform: string): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { platform },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (hadNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
      writable: true,
    });
  } else {
    delete (globalThis as { navigator?: unknown }).navigator;
  }
});

const keyCaps = (html: string): string[] => [...html.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map(m => m[1]!.trim());

describe("issue #5 item 4 — the shortcut badge names the key this keyboard has", () => {
  test("a non-Apple platform is told Ctrl, not command", async () => {
    asPlatform("Linux x86_64");
    const wrapper = mount(SiteHeader);
    await wrapper.vm.$nextTick();

    expect(keyCaps(wrapper.html())).toEqual(["Ctrl", "K"]);
    // Scoped to the badge: the template's own explanatory comment names the
    // glyph, and Vue keeps comments in the rendered output.
    expect(wrapper.find(".search-trigger-keys").text()).not.toContain("⌘");
  });

  test("an Apple platform gets the command glyph", async () => {
    asPlatform("MacIntel");
    const wrapper = mount(SiteHeader);
    await wrapper.vm.$nextTick();

    expect(keyCaps(wrapper.html())).toEqual(["⌘", "K"]);
  });

  // Each key is its own cap. The old badge was one span holding the whole
  // `⌘K` string, which read as a word rather than as two keys.
  test("each key is its own <kbd>, not one run-together string", async () => {
    asPlatform("MacIntel");
    const wrapper = mount(SiteHeader);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("kbd")).toHaveLength(2);
    expect(wrapper.html()).not.toContain(">⌘K<");
  });

  // The glyph class is what swaps the mono face out for the sans one — `⌘`
  // renders badly in the mono stack at this size. Only the glyph carries it.
  test("only the command glyph is marked for the sans treatment", async () => {
    asPlatform("MacIntel");
    const apple = mount(SiteHeader);
    await apple.vm.$nextTick();
    expect(apple.findAll("kbd.glyph")).toHaveLength(1);

    asPlatform("Win32");
    const windows = mount(SiteHeader);
    await windows.vm.$nextTick();
    expect(windows.findAll("kbd.glyph")).toHaveLength(0);
  });

  // `⌘` has no pronunciation a screen reader can use, so the caps are hidden
  // and the button's own label spells the shortcut out in words.
  test("the caps are hidden from the accessibility tree and the label speaks the modifier", async () => {
    asPlatform("MacIntel");
    const wrapper = mount(SiteHeader);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".search-trigger-keys").attributes("aria-hidden")).toBe("true");
    expect(wrapper.find(".search-trigger").attributes("aria-label")).toBe("Search (Command+K)");

    asPlatform("Linux x86_64");
    const linux = mount(SiteHeader);
    await linux.vm.$nextTick();
    expect(linux.find(".search-trigger").attributes("aria-label")).toBe("Search (Ctrl+K)");
  });

  // Detection has to wait for mount: VitePress prerenders every page under
  // Node, where there is no `navigator`. Resolving at setup would bake one
  // spelling into the HTML and then disagree with the client's first render
  // — a hydration mismatch. The pre-mount render is the non-Apple spelling.
  test("the first render is Ctrl even on Apple, so SSR and hydration agree", () => {
    asPlatform("MacIntel");
    const wrapper = mount(SiteHeader);

    // Read before the mounted hook's swap has been flushed to the DOM.
    expect(keyCaps(wrapper.html())).toEqual(["Ctrl", "K"]);
  });
});
