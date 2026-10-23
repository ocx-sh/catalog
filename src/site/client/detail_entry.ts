/**
 * The detail page's entry (C-017). It loads `detail.ts` on the first interaction with the page, or at once when
 * the visitor has a stored pin other than the default: the HTML already holds the default pick, so a first visit
 * has nothing to apply before input and ships none of the island's bytes. A click that beats the module is
 * replayed into it once it is live.
 */
import { browserStorage, readPin } from "../lib/installPin.js";
import type { DetailOptions } from "./detail.js";

/** The first sign of a person: hover, press, focus or touch. Keyboard users arrive by focus. */
const FIRST_INPUT = ["pointerover", "pointerdown", "focusin", "touchstart"];

export function bootDetail(root: HTMLElement, options: DetailOptions = {}): { destroy(): void } {
  let island: Promise<{ destroy(): void }> | undefined;
  let early: Event | undefined;
  const remember = (event: Event): void => void (early ??= event);
  const disarm = (): void => {
    for (const type of FIRST_INPUT) root.removeEventListener(type, load);
    root.removeEventListener("click", remember, true);
  };
  function load(): void {
    disarm();
    root.addEventListener("click", remember, true);
    island = import("./detail.js").then(({ mount }) => {
      const mounted = mount(root, options);
      root.removeEventListener("click", remember, true);
      if (early) mounted.replay(early);
      return mounted;
    });
    island.catch((error: unknown) => {
      root.removeEventListener("click", remember, true);
      console.error("[ocx] the detail script failed to load", error);
    });
  }

  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (readPin(storage) !== "latest") load();
  else for (const type of FIRST_INPUT) root.addEventListener(type, load, { passive: true });

  return { destroy: () => (disarm(), void island?.then((mounted) => mounted.destroy(), () => {})) };
}
