/**
 * `404.html` (S-011): the static host serves it for any unknown URL, so it is
 * a complete page in the site's own chrome whose way home and assets are
 * joined to `base`. Needs `root` (base `/`) and `catalog` (base `/catalog/`).
 */
import { describe, expect, it } from "vitest";
import { listTree, readHtml, site } from "./helpers.js";

describe.each([
  { name: "root" as const, base: "/" },
  { name: "catalog" as const, base: "/catalog/" },
])("S-011 404 page of $name", ({ name, base }) => {
  it("is emitted at the site root as 404.html and as no route directory", async () => {
    const files = await listTree(site(name));

    expect(files).toContain("404.html");
    expect(files).not.toContain("404/index.html");
  });

  it("says what happened and links back to the catalog under base", async () => {
    const doc = await readHtml(site(name), "/404.html");

    expect(doc.querySelector("main#main h1")?.textContent).toBe("Page not found");
    expect(doc.querySelector("main#main a.ocx-ui-button")?.getAttribute("href")).toBe(base);
    expect(doc.querySelector("main#main a.ocx-ui-button")?.textContent?.trim()).toBe("Back to the catalog");
  });

  it("is a complete page: header, main, footer, skip link, and the document language", async () => {
    const doc = await readHtml(site(name), "/404.html");

    expect(doc.documentElement.lang).toBe("en");
    expect(doc.querySelector("header.ocx-shell__header .ocx-header")).not.toBeNull();
    expect(doc.querySelector("a.ocx-skip")?.getAttribute("href")).toBe("#main");
    expect(doc.querySelector("footer.ocx-footer")).not.toBeNull();
  });

  it("loads every stylesheet and script from under base", async () => {
    const doc = await readHtml(site(name), "/404.html");
    const assets = [
      ...[...doc.querySelectorAll('link[rel="stylesheet"]')].map((el) => el.getAttribute("href")!),
      ...[...doc.querySelectorAll("script[src]")].map((el) => el.getAttribute("src")!),
    ];

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) expect(asset.startsWith(`${base}_astro/`), asset).toBe(true);
  });
});
