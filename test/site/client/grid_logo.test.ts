// @vitest-environment happy-dom
//
// The package logo as the grid island clones it (ledger C16): a theme `LogoTile` filled by
// `fillLogoTile`, with the theme's document listeners settling the image.
import { fillLogoTile, install, monogramHue } from "@ocx-sh/theme/logo-tile";
import { describe, expect, test } from "vitest";
import { gridDom } from "./grid_dom.js";
import { catalog, pkg, useGridRun } from "./grid_harness.js";

const run = useGridRun();

const tileOf = (list: HTMLElement, name: string) => list.querySelector<HTMLElement>(`[data-key="${name}"] .ocx-logo-tile`)!;
const imageOf = (tile: HTMLElement) => tile.querySelector<HTMLImageElement>(".ocx-logo-tile__image")!;
const withLogo = (name: string, logoUrl: string | null) => pkg(name, { logoUrl });

describe("C16 logo tile", () => {
  test("D-035 a filled clone paints its initials at once and waits for the logo: loading, then ready on load", async () => {
    install();
    const dom = gridDom({ base: "/catalog/" });
    await run.open(dom, catalog([withLogo("a/acme/tool", "/p/acme/tool/o/sha256/l.png")]));
    const tile = tileOf(dom.cards, "a/acme/tool");
    expect(tile.dataset.state).toBe("loading");
    expect(tile.querySelector(".ocx-logo-tile__initials")?.textContent).toBe("TO");
    expect(imageOf(tile).getAttribute("src")).toBe("/catalog/p/acme/tool/o/sha256/l.png");
    imageOf(tile).dispatchEvent(new Event("load"));
    expect(tile.dataset.state).toBe("ready");
  });

  test("D-009 a logo that fails leaves the initials showing: the image hides and the tile falls back", async () => {
    install();
    const dom = gridDom();
    await run.open(dom, catalog([withLogo("a/acme/tool", "/p/acme/tool/o/sha256/l.png")]));
    const tile = tileOf(dom.cards, "a/acme/tool");
    imageOf(tile).dispatchEvent(new Event("error"));
    expect(imageOf(tile).hidden).toBe(true);
    expect(tile.dataset.state).toBe("fallback");
    expect(tile.querySelector(".ocx-logo-tile__initials")?.textContent).toBe("TO");
  });

  test("D-009 a package without a logo has no image to wait for: the tile is the monogram", async () => {
    const dom = gridDom();
    await run.open(dom, catalog([withLogo("a/acme/old", null)]));
    const tile = tileOf(dom.cards, "a/acme/old");
    expect(tile.dataset.state).toBe("fallback");
    expect(imageOf(tile).hidden).toBe(true);
    expect(imageOf(tile).hasAttribute("src")).toBe(false);
  });

  test("D-011 the monogram hue is the theme's hash of the bare name, so server tile and clone agree", async () => {
    const dom = gridDom();
    await run.open(dom, catalog([withLogo("a/acme/tool", null), withLogo("b/acme/tool", null)]));
    const hue = String(monogramHue("acme/tool"));
    expect(tileOf(dom.cards, "a/acme/tool").dataset.hue).toBe(hue);
    // The index prefix is not part of the hue key: one package, one colour in every index.
    expect(tileOf(dom.cards, "b/acme/tool").dataset.hue).toBe(hue);
  });

  test("D-036 a failed logo falls back to the monogram with no retry (the catalog knows no png sibling); refilling the tile resets the state", async () => {
    install();
    const dom = gridDom();
    await run.open(dom, catalog([withLogo("a/acme/tool", "/p/acme/tool/o/sha256/l.svg")]));
    const tile = tileOf(dom.cards, "a/acme/tool");
    const image = imageOf(tile);
    image.dispatchEvent(new Event("error"));
    expect(image.getAttribute("src")).toBe("/p/acme/tool/o/sha256/l.svg");
    expect(image.hidden).toBe(true);
    expect(tile.dataset.state).toBe("fallback");

    fillLogoTile(tile, { name: "tool", seed: "acme/tool", src: "/p/acme/tool/o/sha256/l.svg" });
    expect(tile.dataset.state).toBe("loading");
    expect(image.hidden).toBe(false);
    expect(image.hasAttribute("data-fallback")).toBe(false);

    // The refilled tile is as fallible as the first: a second failure falls back again.
    image.dispatchEvent(new Event("error"));
    expect(tile.dataset.state).toBe("fallback");
    expect(image.hidden).toBe(true);
  });

  test("D-038 a tile with neither a logo nor initials shows the cube, not an empty square", () => {
    const dom = gridDom();
    const tile = dom.cards.ownerDocument.querySelector<HTMLTemplateElement>("template[data-grid-card]")!.content.querySelector<HTMLElement>(".ocx-logo-tile")!;
    fillLogoTile(tile, { name: "", src: null });
    expect(tile.dataset.state).toBe("empty");
    expect(tile.querySelector('.ocx-logo-tile__cube svg[data-icon="box"]')).not.toBeNull();
  });
});
