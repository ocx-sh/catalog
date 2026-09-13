// @vitest-environment happy-dom
//
// The window is what keeps the catalog from building every package it shows.
// Its two failure modes are silent in opposite directions: a window that never
// grows hides packages from a reader who scrolls, and a window that resets on
// nothing leaves the whole catalog built after one filter. Both are asserted
// here against the real composable, driven through a stub IntersectionObserver
// — happy-dom lays nothing out, so a real one could never intersect.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { effectScope, nextTick, ref, computed } from "vue";

import { useWindowedList, WINDOW_SIZE } from "../../../src/theme/composables/useWindowedList";

/** Fires the composable's callback the way the browser would: with the
 * entries AND the observer, which the composable uses to re-observe. */
let fire: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
/** Every `observe()` call, in order — a re-observe shows up as a second one. */
let observed: unknown[] = [];
const nativeObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  fire = undefined;
  observed = [];
  // @ts-expect-error — a stand-in for the browser's, with only the surface
  // `useIntersectionObserver` and the composable actually call.
  globalThis.IntersectionObserver = class {
    constructor(callback: (entries: { isIntersecting: boolean }[], observer: unknown) => void) {
      fire = (entries) => callback(entries, this);
    }
    observe(target: unknown) {
      observed.push(target);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

afterEach(() => {
  globalThis.IntersectionObserver = nativeObserver;
});

/** Run `body` inside a scope, so the observer's dispose hook has one. */
function inScope<T>(body: () => T): { result: T; stop: () => void } {
  const scope = effectScope();
  const result = scope.run(body) as T;
  return { result, stop: () => scope.stop() };
}

function items(count: number) {
  return Array.from({ length: count }, (_, i) => `pkg-${i}`);
}

describe("useWindowedList", () => {
  test("builds one slice of a long list, and reports there is more", () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(300)), 48));

    expect(result.visible.value).toHaveLength(48);
    expect(result.visible.value[0]).toBe("pkg-0");
    expect(result.hasMore.value).toBe(true);
    stop();
  });

  test("passes a short list through untouched, with no sentinel to render", () => {
    const source = ref(items(6));
    const { result, stop } = inScope(() => useWindowedList(source, 48));

    // The same array, not a copy: a list inside one window costs nothing.
    expect(result.visible.value).toBe(source.value);
    expect(result.hasMore.value).toBe(false);
    stop();
  });

  test("grows a slice at a time when the sentinel is reached, and stops at the end", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(100)), 48));
    result.sentinel.value = document.createElement("div");
    await nextTick();
    expect(observed).toHaveLength(1);

    fire?.([{ isIntersecting: true }]);
    expect(result.visible.value).toHaveLength(96);

    fire?.([{ isIntersecting: true }]);
    expect(result.visible.value).toHaveLength(100);
    expect(result.hasMore.value).toBe(false);

    // Everything is built; the observer firing again must not keep counting.
    fire?.([{ isIntersecting: true }]);
    expect(result.visible.value).toHaveLength(100);
    stop();
  });

  // An IntersectionObserver reports transitions, not states: if the sentinel
  // is still inside the margin after the slice is built, nothing transitions
  // and nothing fires. The composable re-observes after every growth so the
  // browser reports the sentinel's current position afresh. Seen for real: a
  // scroll to the bottom of 3000 packages stopped at 720.
  test("re-observes the sentinel after every growth, so a still-visible sentinel keeps growing", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(200)), 48));
    const el = document.createElement("div");
    result.sentinel.value = el;
    await nextTick();
    expect(observed).toEqual([el]);

    fire?.([{ isIntersecting: true }]);
    await nextTick();
    expect(result.visible.value).toHaveLength(96);
    expect(observed).toEqual([el, el]);

    // The browser answers the re-observe with a fresh record; still inside
    // the margin means another slice, and another re-observe.
    fire?.([{ isIntersecting: true }]);
    await nextTick();
    // Geometric: the second growth doubles again.
    expect(result.visible.value).toHaveLength(192);
    expect(observed).toEqual([el, el, el]);
    stop();
  });

  // Every growth re-lays-out the whole table, so what a full scroll costs is
  // the number of growths. Doubling keeps that logarithmic; the cap keeps any
  // one growth from being a several-hundred-item freeze.
  test("grows geometrically, capped at eight slices per step", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(2000)), 48));
    result.sentinel.value = document.createElement("div");
    await nextTick();

    const seen = [result.visible.value.length];
    for (let i = 0; i < 7; i++) {
      fire?.([{ isIntersecting: true }]);
      await nextTick();
      seen.push(result.visible.value.length);
    }
    expect(seen).toEqual([48, 96, 192, 384, 768, 1152, 1536, 1920]);
    stop();
  });

  test("does not re-observe once the list is exhausted and the sentinel is gone", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(50)), 48));
    const el = document.createElement("div");
    result.sentinel.value = el;
    await nextTick();

    fire?.([{ isIntersecting: true }]);
    // The page removes the sentinel (`hasMore` is false) before the tick.
    result.sentinel.value = null;
    await nextTick();
    expect(result.visible.value).toHaveLength(50);
    expect(observed).toEqual([el]);
    stop();
  });

  test("resets to one slice on demand", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(200)), 48));
    result.sentinel.value = document.createElement("div");
    await nextTick();
    fire?.([{ isIntersecting: true }]);
    expect(result.visible.value).toHaveLength(96);

    result.reset();
    expect(result.visible.value).toHaveLength(48);
    stop();
  });

  test("ignores an observation that is not an intersection", async () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(100)), 48));
    result.sentinel.value = document.createElement("div");
    await nextTick();

    fire?.([{ isIntersecting: false }]);
    expect(result.visible.value).toHaveLength(48);
    stop();
  });

  test("a new result set starts a new window", async () => {
    const query = ref("");
    const all = items(300);
    const source = computed(() => all.filter((name) => name.includes(query.value)));
    const { result, stop } = inScope(() => useWindowedList(source, 48));
    result.sentinel.value = document.createElement("div");
    await nextTick();

    fire?.([{ isIntersecting: true }]);
    expect(result.visible.value).toHaveLength(96);

    // Narrow to a handful, then widen again: the window must be back to one
    // slice, not still holding the 96 the reader had scrolled to.
    // `pkg-29` matches pkg-29 and pkg-290..299.
    query.value = "pkg-29";
    await nextTick();
    expect(result.visible.value).toHaveLength(11);

    query.value = "";
    await nextTick();
    expect(result.visible.value).toHaveLength(48);
    stop();
  });

  test("defaults to the shipped window size", () => {
    const { result, stop } = inScope(() => useWindowedList(ref(items(300))));

    expect(result.visible.value).toHaveLength(WINDOW_SIZE);
    stop();
  });
});
