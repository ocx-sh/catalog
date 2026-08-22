// @vitest-environment happy-dom
//
// C-602: `SiteFooter.vue`'s github link and `EmptyState.vue`'s issue CTA
// used to hardcode `github.com/ocx-sh/*` URLs — this deployment's OWN
// identity, not this renderer's to assume. Both now source from the SAME
// `nav[]` config surface `SiteHeader.vue` already renders, omitted
// entirely when a deployment configures none (S-01: "no ocx.sh leakage").
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

describe("C-602 SiteFooter — nav-sourced external link, omitted when unset", () => {
  test("no nav[] configured -> no github/ocx-sh link at all", () => {
    themeState.value = {};
    const html = mount(SiteFooter).html();
    expect(html).not.toContain("ocx-sh");
    expect(html).not.toContain("github.com");
    expect(html).toContain("raw data");
    expect(html).toContain("privacy");
  });

  test("a configured nav[] entry renders as its own link, target=_blank for an external URL", () => {
    themeState.value = { nav: ACME_NAV };
    const html = mount(SiteFooter).html();
    expect(html).toContain('href="https://github.com/acme/tools"');
    expect(html).toContain("GitHub");
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("ocx-sh");
  });

  test("a same-site nav[] link does not carry target=_blank", () => {
    themeState.value = { nav: [{ text: "Status", link: "/status" }] };
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
