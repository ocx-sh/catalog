// @vitest-environment happy-dom
//
// The palette island on the REAL `@ocx-sh/theme/lazy` (K.2, C-011): the theme's trigger layer arms
// and loads the island, while the trigger button and Mod+K start it themselves (`replay: false`), so
// an early activation opens the dialog exactly once.
import { mount as themeMount } from "@ocx-sh/theme/lazy";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LazyMount } from "../../../src/site/client/mount.js";
import { mountPalette } from "../../../src/site/client/palette.js";

let destroy: (() => void) | undefined;
let loads: ReturnType<typeof vi.fn>;
let lazy: LazyMount;
let opened: string[];
let fetch: ReturnType<typeof vi.fn>;

const onOpen = (event: Event) => opened.push((event as CustomEvent<{ id: string }>).detail.id);

beforeEach(() => {
  document.body.innerHTML = `
    <div class="ocx-palette" data-base="/catalog/">
      <button type="button" data-palette-trigger>Search packages</button>
      <div data-zag-root="dialog" data-zag-id="palette-dialog">
        <input type="search">
        <p data-palette-status role="status"></p>
        <div data-zag-root="listbox"></div>
      </div>
    </div>`;
  opened = [];
  loads = vi.fn();
  fetch = vi.fn();
  lazy = {
    mount: (root, spec) =>
      themeMount(root, {
        ...spec,
        load: () => {
          loads();
          return spec.load();
        },
      }),
  };
  document.addEventListener("ocx:dialog:open", onOpen);
});

afterEach(() => {
  document.removeEventListener("ocx:dialog:open", onOpen);
  destroy?.();
  destroy = undefined;
  document.body.replaceChildren();
});

const root = () => document.querySelector<HTMLElement>(".ocx-palette")!;

test("nothing loads before the first interaction; hovering loads once and opens nothing", async () => {
  destroy = mountPalette(root(), lazy, { fetch }).destroy;
  expect(root().dataset.zagState).toBeUndefined();
  expect(loads).not.toHaveBeenCalled();

  root().dispatchEvent(new Event("pointerenter"));
  await vi.waitFor(() => expect(root().dataset.zagState).toBe("live"));

  expect(loads).toHaveBeenCalledTimes(1);
  expect(opened).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("a trigger click before the island is live starts it and opens the dialog once", async () => {
  destroy = mountPalette(root(), lazy, { fetch }).destroy;

  document.querySelector<HTMLElement>("[data-palette-trigger]")!.click();
  await vi.waitFor(() => expect(opened).toEqual(["palette-dialog"]));

  expect(loads).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test("Mod+K pressed before any pointer interaction starts the island and opens the dialog once", async () => {
  destroy = mountPalette(root(), lazy, { fetch }).destroy;

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(opened).toEqual(["palette-dialog"]));

  expect(loads).toHaveBeenCalledTimes(1);
});
