// @vitest-environment happy-dom
//
// D-017: the keyword rail reorders, enters and leaves with motion (FLIP). The
// old Vue rail pinned three behaviours with tests (kept chips slide, entering
// chips fade in, leaving chips leave the flow); each has its counterpart here.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { animateRail } from "../../../src/site/client/rail_motion.js";

interface Frame {
  readonly left: number;
  readonly top: number;
}

let frames: Map<Element, Frame>;
let animations: { el: Element; keyframes: Keyframe[]; timing: KeyframeAnimationOptions; finish: () => void }[];

function chip(name: string): HTMLElement {
  const el = document.createElement("button");
  el.setAttribute("data-grid-chip", "");
  el.dataset.keyword = name;
  return el;
}

function rail(...names: string[]): HTMLElement {
  const el = document.createElement("div");
  el.append(...names.map(chip));
  document.body.append(el);
  return el;
}

const at = (el: Element, left: number, top = 0) => frames.set(el, { left, top });

beforeEach(() => {
  frames = new Map();
  animations = [];
  document.body.replaceChildren();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { left = 0, top = 0 } = frames.get(this) ?? {};
    return { left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON: () => ({}) };
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: (name: string) => (name === "--ocx-duration-moderate" ? "0.2s" : "") }) as CSSStyleDeclaration,
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      const handlers: (() => void)[] = [];
      animations.push({ el: this, keyframes, timing, finish: () => handlers.forEach((handler) => handler()) });
      return { addEventListener: (_type: string, handler: () => void) => handlers.push(handler) };
    },
  });
});

afterEach(() => {
  // @ts-expect-error the stub was installed as an own property of the prototype
  delete HTMLElement.prototype.animate;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("D-017 the rail moves", () => {
  test("D-017 a kept chip slides from where it was, and one that did not move does not animate", () => {
    const el = rail("a", "b");
    const [a, b] = [...el.children] as HTMLElement[];
    at(a!, 0);
    at(b!, 50);
    animateRail(el, () => {
      el.append(a!); // b first, a second: both change places
      at(b!, 0);
      at(a!, 60);
    });
    expect(animations.map((animation) => animation.el)).toEqual([a, b]);
    expect(animations[0]?.keyframes).toEqual([{ transform: "translateX(-60px)" }, { transform: "none" }]);
    expect(animations[1]?.keyframes).toEqual([{ transform: "translateX(50px)" }, { transform: "none" }]);
    expect(animations[0]?.timing.duration).toBe(200);

    animations = [];
    animateRail(el, () => undefined);
    expect(animations).toEqual([]);
  });

  test("D-017 an entering chip fades in from the side", () => {
    const el = rail("a");
    const entering = chip("b");
    animateRail(el, () => el.append(entering));
    expect(animations).toHaveLength(1);
    expect(animations[0]?.el).toBe(entering);
    expect(animations[0]?.keyframes).toEqual([
      { opacity: 0, transform: "translateX(calc(-1 * var(--ocx-space-4)))" },
      { opacity: 1, transform: "none" },
    ]);
  });

  test("D-017 a leaving chip is taken out of the flow where it stood, fades, and is removed once it is gone", () => {
    const el = rail("a", "b");
    const [a, b] = [...el.children] as HTMLElement[];
    at(el, 10, 100);
    at(a!, 30, 104);
    at(b!, 70, 104);
    Object.defineProperty(el, "scrollLeft", { configurable: true, value: 5 });
    animateRail(el, () => b!.remove());

    expect(b!.parentElement).toBe(el);
    expect(b!.hasAttribute("data-leaving")).toBe(true);
    expect(b!.getAttribute("aria-hidden")).toBe("true");
    expect(b!.tabIndex).toBe(-1);
    expect(b!.style.position).toBe("absolute");
    expect(b!.style.left).toBe("65px"); // 70 - 10 + scrollLeft 5
    expect(b!.style.top).toBe("4px");
    expect(b!.style.pointerEvents).toBe("none");
    expect(animations.find((animation) => animation.el === b)?.keyframes[1]).toEqual({
      opacity: 0,
      transform: "translateX(calc(-1 * var(--ocx-space-4)))",
    });

    animations.find((animation) => animation.el === b)!.finish();
    expect(b!.isConnected).toBe(false);
  });

  test("D-017 a chip still fading is not part of the rail for the next change", () => {
    const el = rail("a", "b");
    const [, b] = [...el.children] as HTMLElement[];
    animateRail(el, () => b!.remove());
    animations = [];
    const added = chip("c");
    animateRail(el, () => el.append(added));
    // Only the new chip animates: the fading one is neither measured as kept nor counted as entering.
    expect(animations.map((animation) => animation.el)).toEqual([added]);
  });

  test("D-017 reduced motion, a missing token or no animation API gets the plain change", () => {
    const el = rail("a");
    const change = vi.fn(() => el.append(chip("b")));

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    animateRail(el, change);
    expect(change).toHaveBeenCalledTimes(1);

    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: () => "" }) as unknown as CSSStyleDeclaration);
    animateRail(el, change);
    expect(change).toHaveBeenCalledTimes(2);

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ getPropertyValue: () => "150ms" }) as unknown as CSSStyleDeclaration,
    );
    // @ts-expect-error the stub was installed as an own property of the prototype
    delete HTMLElement.prototype.animate;
    animateRail(el, change);
    expect(change).toHaveBeenCalledTimes(3);
    expect(animations).toEqual([]);
  });

  test("D-017 a browser without matchMedia still animates", () => {
    const el = rail("a");
    vi.stubGlobal("matchMedia", undefined);
    animateRail(el, () => el.append(chip("b")));
    expect(animations[0]?.timing.duration).toBe(200);
  });

  test("D-017 milliseconds and seconds both read as the token's duration", () => {
    const el = rail("a");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ getPropertyValue: () => " 150ms " }) as unknown as CSSStyleDeclaration,
    );
    animateRail(el, () => el.append(chip("b")));
    expect(animations[0]?.timing.duration).toBe(150);
  });
});
