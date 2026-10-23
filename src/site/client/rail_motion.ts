/**
 * Motion for the keyword rail (D-017). The rail is rescored against the
 * current result set on every click, so its chips reorder, appear and leave;
 * without motion that reads as the chips having been replaced rather than
 * reordered. FLIP: measure, change the DOM, then animate each kept chip from
 * where it was. A leaving chip is taken out of flow (absolute, in the rail,
 * which is the containing block) so the survivors slide while it fades, not
 * after it is gone.
 *
 * The duration is the theme's `--ocx-duration-moderate` token; a reader who
 * asked for reduced motion, or a browser without the Web Animations API,
 * gets the plain change.
 */
import { everyEl } from "../lib/dom.js";

/** A chip still fading out is not part of the rail any more. */
const CHIPS = "[data-grid-chip]:not([data-leaving])";
const SHIFT = "translateX(calc(-1 * var(--ocx-space-4)))";

/** The token in milliseconds; 0 turns the motion off. */
function duration(el: HTMLElement): number {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const raw = getComputedStyle(el).getPropertyValue("--ocx-duration-moderate").trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return raw.endsWith("ms") ? value : value * 1000;
}

/** Runs `change` (which rearranges the chips of `rail`) and animates the difference. */
export function animateRail(rail: HTMLElement, change: () => void): void {
  const ms = duration(rail);
  if (ms === 0 || typeof rail.animate !== "function") {
    change();
    return;
  }
  const timing = { duration: ms, easing: "ease-out" };
  const before = new Map(everyEl(rail, CHIPS).map((chip) => [chip, chip.getBoundingClientRect()]));
  change();
  const origin = rail.getBoundingClientRect();
  for (const [chip, from] of before) {
    if (chip.parentElement === rail) {
      const dx = from.left - chip.getBoundingClientRect().left;
      if (dx !== 0) chip.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
      continue;
    }
    chip.dataset.leaving = "";
    chip.setAttribute("aria-hidden", "true");
    chip.tabIndex = -1;
    Object.assign(chip.style, {
      position: "absolute",
      left: `${from.left - origin.left + rail.scrollLeft}px`,
      top: `${from.top - origin.top + rail.scrollTop}px`,
      pointerEvents: "none",
    });
    rail.append(chip);
    chip.animate([{ opacity: 1 }, { opacity: 0, transform: SHIFT }], timing).addEventListener("finish", () => chip.remove());
  }
  for (const chip of everyEl(rail, CHIPS)) {
    if (!before.has(chip)) chip.animate([{ opacity: 0, transform: SHIFT }, { opacity: 1, transform: "none" }], timing);
  }
}
