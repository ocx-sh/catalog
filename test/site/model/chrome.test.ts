/**
 * C-021 / C-031 — `chromeView`: the page shell's props per chrome mode.
 * Internal hrefs, the favicon included, are `base`-joined; the brand logo and
 * css stay catalog-root-relative (C-008), the layout joins `base` itself.
 */
import { describe, expect, it } from "vitest";
import type { CatalogConfig, LoadedConfig } from "../../../src/config/types.js";
import { chromeView } from "../../../src/site/model/chrome.js";
import { siteModel } from "../../../src/site/model/index.js";

function config(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return { sources: [], brand: { title: "Mirror" }, base: "/catalog/", ...overrides };
}

describe("chromeView neutral (C-021)", () => {
  it("is the default mode and carries the brand title, wordmark and logo", () => {
    const view = chromeView(
      config({ brand: { title: "Mirror", wordmark: "mirror.example", logo: "assets/mark.svg" } }),
      "/catalog/",
    );
    expect(view.mode).toBe("neutral");
    expect(view.brand).toEqual({ title: "Mirror", wordmark: "mirror.example", logoSrc: "/mark.svg" });
    expect(view.siteName).toBe("Mirror");
  });

  it("falls back to an empty title when a hand-built neutral config has no brand", () => {
    expect(chromeView(config({ brand: undefined }), "/").siteName).toBe("");
  });

  it("omits wordmark and logoSrc when the brand sets neither", () => {
    expect(chromeView(config(), "/catalog/").brand).toEqual({ title: "Mirror" });
  });

  it("joins internal nav and footer links onto base and leaves external ones", () => {
    const view = chromeView(
      config({
        nav: [
          { text: "blog", link: "/blog/" },
          { text: "source", link: "https://github.com/acme/mirror" },
        ],
        footer: { links: [{ text: "terms", link: "/terms/" }] },
      }),
      "/catalog/",
    );
    expect(view.nav).toEqual([
      { label: "blog", href: "/catalog/blog/" },
      { label: "source", href: "https://github.com/acme/mirror" },
    ]);
    expect(view.footer).toEqual({ links: [{ label: "terms", href: "/catalog/terms/" }] });
  });

  it("has empty nav, footer and docsNav when none is configured", () => {
    const view = chromeView(config(), "/");
    expect([view.nav, view.footer.links, view.docsNav]).toEqual([[], [], []]);
  });

  it("adds one auto docs entry joined with base when docs is set and docsNav is not", () => {
    expect(chromeView(config({ docs: "./docs" }), "/catalog/").docsNav).toEqual([
      { label: "docs", href: "/catalog/docs/" },
    ]);
  });

  it("uses the configured docsNav, joined with base, instead of the auto entry", () => {
    const view = chromeView(
      config({
        docs: "./docs",
        docsNav: [
          { text: "guide", link: "/docs/guide/" },
          { text: "reference", link: "/docs/reference/" },
        ],
      }),
      "/catalog/",
    );
    expect(view.docsNav).toEqual([
      { label: "guide", href: "/catalog/docs/guide/" },
      { label: "reference", href: "/catalog/docs/reference/" },
    ]);
  });

  it("has no docsNav without a docs mount", () => {
    expect(chromeView(config(), "/catalog/").docsNav).toEqual([]);
  });

  it("base-joins a root-relative favicon, keeps css catalog-root-relative, null when unset", () => {
    expect(chromeView(config({ favicon: "/favicon.svg", css: "styles/custom.css" }), "/catalog/")).toMatchObject({
      favicon: "/catalog/favicon.svg",
      css: "/custom.css",
    });
    expect(chromeView(config(), "/catalog/")).toMatchObject({ favicon: null, css: null });
  });

  it("leaves an absolute http(s) favicon as written, never joining it onto base", () => {
    expect(chromeView(config({ favicon: "https://cdn.example/icon.svg" }), "/catalog/").favicon).toBe(
      "https://cdn.example/icon.svg",
    );
  });

  it("carries the site tagline, null when unset", () => {
    expect(chromeView(config({ description: "Our mirror." }), "/").description).toBe("Our mirror.");
    expect(chromeView(config(), "/").description).toBeNull();
  });
});

describe("chromeView ocx (C-021, S-015)", () => {
  const ocx = config({ chrome: "ocx", brand: undefined, docs: "./docs", favicon: "/favicon.svg" });

  it("renders the theme's own header: no brand, nav, footer or docs entries", () => {
    const view = chromeView(ocx, "/catalog/");
    expect(view.mode).toBe("ocx");
    expect(view.brand).toBeNull();
    expect([view.nav, view.footer.links, view.docsNav]).toEqual([[], [], []]);
  });

  it("names the site for OG tags, and still carries favicon, css and description", () => {
    const view = chromeView({ ...ocx, css: "custom.css", description: "Catalog." }, "/catalog/");
    expect(view).toMatchObject({ siteName: "ocx.sh", favicon: "/catalog/favicon.svg", css: "/custom.css", description: "Catalog." });
  });
});

describe("chromeView purity (C-031)", () => {
  it("is deterministic and does not mutate its input", () => {
    const input = config({ nav: [{ text: "blog", link: "/blog/" }], docs: "./docs" });
    const before = JSON.stringify(input);
    expect(JSON.stringify(chromeView(input, "/catalog/"))).toBe(JSON.stringify(chromeView(input, "/catalog/")));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("siteModel reaches chromeView (C-031)", () => {
  it("carries the chrome view of the loaded config, built with its base", () => {
    const loaded: LoadedConfig = { config: config({ nav: [{ text: "blog", link: "/blog/" }] }), configDir: "/cfg", sources: [] };
    const model = siteModel({ generated: null, indexes: [], packages: [] }, [], loaded);
    expect(model.chrome).toEqual(chromeView(loaded.config, "/catalog/"));
    expect(model.chrome.nav).toEqual([{ label: "blog", href: "/catalog/blog/" }]);
  });
});
