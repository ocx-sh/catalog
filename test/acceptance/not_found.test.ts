/**
 * `404.html` (S-011): the static host serves it for any unknown URL, so it is
 * a complete page in the site's own chrome whose way home and assets are
 * joined to `base`. Needs `root` (base `/`) and `catalog` (base `/catalog/`).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("D-129 leads with the large 404 status code, then the message, then a back link under base", async () => {
    const doc = await readHtml(site(name), "/404.html");
    const main = doc.querySelector("main#main")!;
    const back = main.querySelector("a.not-found-link");

    expect(main.querySelector("h1")?.textContent).toBe("404");
    expect(main.querySelector("p")?.textContent).toBe("This page doesn't exist.");
    expect(back?.getAttribute("href")).toBe(base);
    expect(back?.textContent?.trim()).toBe("← back to catalog");
  });

  it("D-128 the content block is a direct child of main and its built rules make main a flex column the block fills and centres in (the Chrome gate measures it)", async () => {
    const doc = await readHtml(site(name), "/404.html");
    const sheets = await Promise.all(
      [...doc.querySelectorAll('link[rel="stylesheet"]')].map((el) =>
        readFile(join(site(name), el.getAttribute("href")!.slice(base.length)), "utf8"),
      ),
    );
    const css = sheets.join("\n").replace(/\s+/g, "");
    const rule = css.match(/\.not-found(?![\w-])[^{]*\{[^}]*\}/g) ?? [];

    expect(doc.querySelector("main#main > div.not-found")).not.toBeNull();
    const mainRule = css.match(/main:has\(>\.not-found\)\{[^}]*\}/g) ?? [];

    expect(rule.some((block) => block.includes("flex:10auto") && block.includes("place-content:center"))).toBe(true);
    expect(mainRule.some((block) => block.includes("display:flex") && block.includes("flex-direction:column"))).toBe(true);
  });

  it("D-130 the 404 page's script names a package URL with the old wording, from its own bundle", async () => {
    const doc = await readHtml(site(name), "/404.html");
    // Astro inlines the page's own script and links the shared ones from `_astro/`.
    const inline = [...doc.querySelectorAll("script:not([src])")].map((el) => el.textContent ?? "");
    const linked = [...doc.querySelectorAll("script[src]")].map((el) => el.getAttribute("src")!);
    const bodies = [
      ...inline,
      ...(await Promise.all(linked.map((src) => readFile(join(site(name), src.slice(base.length)), "utf8")))),
    ];

    expect(bodies.some((body) => body.includes("Package not found: "))).toBe(true);
    expect(bodies.some((body) => body.includes("all packages"))).toBe(true);
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
