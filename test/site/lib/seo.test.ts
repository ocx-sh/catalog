/** C-022 — head/SEO derivation: title, description fallbacks, OG tags, canonical only with a site. */
import { describe, expect, it } from "vitest";
import { seoHead, type SeoInput } from "../../../src/site/lib/seo.js";

const input = (overrides: Partial<SeoInput> = {}): SeoInput => ({
  siteName: "Mirror",
  siteDescription: null,
  title: "acme/tool",
  description: "A tool.",
  pathname: "/catalog/acme/tool/",
  site: undefined,
  logoHref: null,
  ...overrides,
});

const og = (head: ReturnType<typeof seoHead>, key: string) =>
  head.tags.find((tag) => tag.property === key || tag.name === key)?.content;

describe("seoHead title and description", () => {
  it("suffixes the site name onto a page title and carries the page description", () => {
    const head = seoHead(input());
    expect(head.title).toBe("acme/tool | Mirror");
    expect(head.description).toBe("A tool.");
    expect(og(head, "og:description")).toBe("A tool.");
  });

  it("D-145 joins og:title to the site name with an em dash, where the <title> takes a pipe", () => {
    const head = seoHead(input());
    expect(head.title).toBe("acme/tool | Mirror");
    expect(og(head, "og:title")).toBe("acme/tool — Mirror");
  });

  it("leaves a page titled with the site name bare", () => {
    expect(seoHead(input({ title: "Mirror" })).title).toBe("Mirror");
  });

  it("falls back from an empty page description to the site tagline", () => {
    expect(seoHead(input({ description: "", siteDescription: "Our mirror." })).description).toBe("Our mirror.");
  });

  it("D-145 falls back to 'Install <name> from <site>.' for a package without a description, ahead of the site tagline", () => {
    const head = seoHead(input({ description: "", packageName: "acme/tool", siteDescription: "Our mirror." }));
    expect(head.description).toBe("Install acme/tool from Mirror.");
    expect(og(head, "og:description")).toBe("Install acme/tool from Mirror.");
  });

  it("D-146 carries no description when neither the page nor the site has one", () => {
    const head = seoHead(input({ description: undefined }));
    expect(head.description).toBeNull();
    expect(og(head, "og:description")).toBeUndefined();
  });

  it("always carries the site-wide OG tags", () => {
    const head = seoHead(input());
    expect(og(head, "og:site_name")).toBe("Mirror");
    expect(og(head, "og:type")).toBe("website");
    expect(og(head, "twitter:card")).toBe("summary");
  });
});

describe("seoHead canonical and og:url (S-015)", () => {
  it("has neither without a site", () => {
    const head = seoHead(input({ canonical: "https://elsewhere.example/x/" }));
    expect(head.url).toBeNull();
    expect(og(head, "og:url")).toBeUndefined();
  });

  it("derives both from the request path against the site", () => {
    const head = seoHead(input({ site: new URL("https://mirror.example/catalog/") }));
    expect(head.url).toBe("https://mirror.example/catalog/acme/tool/");
    expect(og(head, "og:url")).toBe("https://mirror.example/catalog/acme/tool/");
  });

  it("D-147 declares no canonical and no og:url for a page that passes null", () => {
    const head = seoHead(input({ site: new URL("https://mirror.example/"), canonical: null }));
    expect(head.url).toBeNull();
    expect(og(head, "og:url")).toBeUndefined();
  });

  it("prefers the page's own canonical, resolved against the site", () => {
    const site = new URL("https://mirror.example/");
    expect(seoHead(input({ site, canonical: "/canonical/" })).url).toBe("https://mirror.example/canonical/");
    expect(seoHead(input({ site, canonical: new URL("https://mirror.example/u/") })).url).toBe("https://mirror.example/u/");
  });
});

describe("seoHead og:image", () => {
  it("has none without a logo", () => {
    expect(og(seoHead(input()), "og:image")).toBeUndefined();
  });

  it("uses the base-joined logo href as given without a site", () => {
    const head = seoHead(input({ logoHref: "/catalog/mark.svg" }));
    expect(og(head, "og:image")).toBe("/catalog/mark.svg");
    expect(og(head, "twitter:image")).toBe("/catalog/mark.svg");
  });

  it("makes the logo absolute against the site", () => {
    const head = seoHead(input({ logoHref: "/catalog/mark.svg", site: new URL("https://mirror.example/catalog/") }));
    expect(og(head, "og:image")).toBe("https://mirror.example/catalog/mark.svg");
    expect(og(head, "twitter:image")).toBe("https://mirror.example/catalog/mark.svg");
  });
});
