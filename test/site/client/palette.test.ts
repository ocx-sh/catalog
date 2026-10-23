// @vitest-environment happy-dom
//
// The palette's eager entry (C-011, C-019): it binds the catalog's two decisions to the theme's
// `mountCommandPalette` — where the search lives and when "/" is the palette's. The theme's own
// behaviour (Mod+K, keyboard, focus) is its tests' and the real-browser gate's
// (`scripts/quality-palette.mjs`); the double here records what the entry hands over.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PaletteOptions } from "@ocx-sh/theme/command-palette";
import { mountPalette } from "../../../src/site/client/palette.js";

let handed: PaletteOptions[];
const destroy = vi.fn();
const mountCommandPalette = vi.fn((_root: HTMLElement, options: PaletteOptions) => {
  handed.push(options);
  return { destroy };
});

function wrapper(): HTMLElement {
  document.body.innerHTML = `<div class="ocx-palette" data-base="/"><div class="ocx-cmdpalette"></div></div>`;
  return document.querySelector<HTMLElement>(".ocx-palette")!;
}

beforeEach(() => {
  handed = [];
  mountCommandPalette.mockClear();
  destroy.mockClear();
});

afterEach(() => document.body.replaceChildren());

describe("mountPalette", () => {
  test("mounts the theme's palette on the .ocx-cmdpalette inside the wrapper and returns its destroy", () => {
    const root = wrapper();

    const mounted = mountPalette(root, mountCommandPalette);

    expect(mountCommandPalette).toHaveBeenCalledOnce();
    expect(mountCommandPalette.mock.calls[0]![0]).toBe(root.querySelector(".ocx-cmdpalette"));
    mounted.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("a wrapper without the theme's palette is an error, not a silent no-op", () => {
    document.body.innerHTML = `<div class="ocx-palette"></div>`;

    expect(() => mountPalette(document.querySelector<HTMLElement>(".ocx-palette")!, mountCommandPalette)).toThrow(
      "palette: missing .ocx-cmdpalette",
    );
  });

  test("D-106 the search module is not loaded by mounting: the source thunk is only handed over", () => {
    mountPalette(wrapper(), mountCommandPalette);

    // Nothing has been imported yet; the theme calls the thunk on the first open.
    expect(typeof handed[0]!.source).toBe("function");
  });

  test("D-106 the thunk resolves to the lazy source module (search and warm)", async () => {
    mountPalette(wrapper(), mountCommandPalette);

    const source = await handed[0]!.source();

    expect(typeof source.search).toBe("function");
    expect(typeof source.warm).toBe("function");
  });

  test('D-094 "/" opens the palette on pages without the grid (detail, docs, 404)', () => {
    mountPalette(wrapper(), mountCommandPalette);
    const slash = handed[0]!.slash as () => boolean;

    expect(slash()).toBe(true);
  });

  test('D-094 "/" stays the grid\'s on the catalog index, where the grid island is present', () => {
    mountPalette(wrapper(), mountCommandPalette);
    document.body.insertAdjacentHTML("beforeend", `<section data-grid></section>`);
    const slash = handed[0]!.slash as () => boolean;

    expect(slash()).toBe(false);
  });
});
