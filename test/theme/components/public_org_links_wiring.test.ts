// @vitest-environment happy-dom
//
// C-602: `SiteFooter.vue`'s github link, its hardcoded `/docs/privacy`
// anchor, and `EmptyState.vue`'s issue CTA all used to hardcode this
// deployment's OWN identity, not this renderer's to assume. `EmptyState`
// still sources from the `nav[]` config surface `SiteHeader.vue` renders;
// `SiteFooter` (WP-1) now has its own dedicated `footer.links[]` key
// instead, so a mirror's header nav and footer links no longer have to be
// the same list. Both are omitted entirely when unconfigured (S-01: "no
// ocx.sh leakage").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState }) }));

const SiteFooter = (await import("../../../src/theme/components/layout/SiteFooter.vue")).default;
const EmptyState = (await import("../../../src/theme/components/catalog/EmptyState.vue")).default;

const ACME_NAV = [{ text: "GitHub", link: "https://github.com/acme/tools" }];

describe("WP-1 SiteFooter — footer.links[]-sourced links, no hardcoded privacy anchor", () => {
  test("nothing configured -> catalog json only, no privacy anchor, no github/ocx-sh link", () => {
    themeState.value = {};
    const html = mount(SiteFooter).html();
    expect(html).toContain("catalog json");
    // Inverted from the pre-WP-1 assertion: the hardcoded /docs/privacy
    // anchor is gone entirely, not just omittable.
    expect(html).not.toContain("privacy");
    expect(html).not.toContain("ocx-sh");
    expect(html).not.toContain("github.com");
  });

  // The footer no longer reads theme.nav at all (WP-1: nav[] and
  // footer.links[] are separate keys) — a mirror that configures nav[] for
  // its header, but no footer, gets no footer links either.
  // Owner finding: this link pointed at `/c/index.json`, the ROOT source's
  // own wire enumeration. A deployment whose sources are all non-root mirrors
  // no tree at the site root at all, so that anchor 404s — and `c/index.json`
  // is optional per source anyway. The view model this renderer emits itself
  // is the one file guaranteed to exist at a fixed path for every
  // configuration, root or not, single-source or aggregated.
  test("the catalog json link points at the emitted view model, never the root source's wire index", () => {
    themeState.value = {};
    const html = mount(SiteFooter).html();
    expect(html).toContain('href="/data/catalog/catalog.json"');
    expect(html).not.toContain("/c/index.json");
  });

  test("nav[] configured but no footer -> footer still shows only the catalog json link", () => {
    themeState.value = { nav: ACME_NAV };
    const html = mount(SiteFooter).html();
    expect(html).not.toContain("github.com/acme/tools");
    expect(html).toContain("catalog json");
  });

  test("a configured footer.links[] entry renders as its own link, target=_blank for an external URL", () => {
    themeState.value = { footer: { links: ACME_NAV } };
    const html = mount(SiteFooter).html();
    expect(html).toContain('href="https://github.com/acme/tools"');
    expect(html).toContain("GitHub");
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("ocx-sh");
  });

  test("a same-site footer.links[] entry does not carry target=_blank", () => {
    themeState.value = { footer: { links: [{ text: "Status", link: "/status" }] } };
    const html = mount(SiteFooter).html();
    expect(html).toContain('href="/status"');
    expect(html).not.toContain('href="/status" target="_blank"');
  });
});

describe("C-602 EmptyState — nav-sourced CTAs, omitted when unset", () => {
  test("no-data variant with no nav[] configured shows no CTA row at all", () => {
    themeState.value = {};
    const html = mount(EmptyState, { props: { variant: "no-data" } }).html();
    expect(html).not.toContain("ocx-sh");
    expect(html).not.toContain("github.com");
    expect(html).not.toContain("empty-ctas");
  });

  test("no-data variant with nav[] configured renders it as a CTA, never the old hardcoded issue URL", () => {
    themeState.value = { nav: ACME_NAV };
    const html = mount(EmptyState, { props: { variant: "no-data" } }).html();
    expect(html).toContain('href="https://github.com/acme/tools"');
    expect(html).toContain("GitHub");
    expect(html).not.toContain("ocx-sh");
  });

  test("no-match variant always keeps clear-search, adds nav[] CTAs only when configured", async () => {
    themeState.value = {};
    const noNav = mount(EmptyState, { props: { variant: "no-match", query: "foo", total: 3 } });
    expect(noNav.html()).toContain("clear search");
    expect(noNav.html()).not.toContain("ocx-sh");

    themeState.value = { nav: ACME_NAV };
    const withNav = mount(EmptyState, { props: { variant: "no-match", query: "foo", total: 3 } });
    expect(withNav.html()).toContain("clear search");
    expect(withNav.html()).toContain('href="https://github.com/acme/tools"');
  });

  test("clear-search still emits on click (unaffected by the nav-CTA change)", async () => {
    themeState.value = {};
    const wrapper = mount(EmptyState, { props: { variant: "no-match", query: "foo", total: 3 } });
    await wrapper.find(".cta-outline").trigger("click");
    expect(wrapper.emitted("clear-search")).toHaveLength(1);
  });
});

// A component may name the historical bug in a comment (both files do,
// documenting what this WP fixed) — only executable template/script text
// is checked, same reasoning as `brand_install_wiring.test.ts`'s own
// `sourceWithoutComments`.
function sourceWithoutComments(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("no hardcoded ocx-sh/public-org URL left in source (C-602)", () => {
  test("SiteFooter and EmptyState carry no github.com/ocx-sh literal", () => {
    for (const relPath of [
      "src/theme/components/layout/SiteFooter.vue",
      "src/theme/components/catalog/EmptyState.vue",
    ]) {
      expect(sourceWithoutComments(relPath), relPath).not.toContain("ocx-sh");
    }
  });
});
