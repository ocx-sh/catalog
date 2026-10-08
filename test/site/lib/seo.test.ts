/** C-022 — head/SEO derivation: title, description fallbacks, OG tags, canonical only with a site. */
import { describe, expect, it } from "vitest";
import { faviconType, seoHead, type SeoInput } from "../../../src/site/lib/seo.js";

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
    expect(og(head, "og:title")).toBe("acme/tool | Mirror");
    expect(og(head, "og:description")).toBe("A tool.");
  });

  it("leaves a page titled with the site name bare", () => {
    expect(seoHead(input({ title: "Mirror" })).title).toBe("Mirror");
  });

  it("falls back from an empty page description to the site tagline", () => {
    expect(seoHead(input({ description: "", siteDescription: "Our mirror." })).description).toBe("Our mirror.");
  });

  it("falls back to generic copy when neither the page nor the site has a description", () => {
    expect(seoHead(input({ description: undefined })).description).toBe("acme/tool on Mirror.");
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

describe("faviconType", () => {
  it.each([
    ["/favicon.svg", "image/svg+xml"],
    ["/favicon.PNG", "image/png"],
    ["/favicon.ico", "image/x-icon"],
  ])("derives the type of %s", (href, type) => {
    expect(faviconType(href)).toBe(type);
  });

  it("is undefined for an unknown or missing extension", () => {
    expect(faviconType("/icon.webp")).toBeUndefined();
    expect(faviconType("/icon")).toBeUndefined();
  });
});
