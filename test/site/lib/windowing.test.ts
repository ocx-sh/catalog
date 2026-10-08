import { describe, expect, test } from "vitest";
import { nextWindowLimit, WINDOW_SIZE, windowSlice } from "../../../src/site/lib/windowing.js";

describe("WINDOW_SIZE", () => {
  test("is 48", () => {
    expect(WINDOW_SIZE).toBe(48);
  });
});

describe("nextWindowLimit", () => {
  test("doubles from the first slice: 48, 96, 192, 384", () => {
    const steps = [WINDOW_SIZE];
    for (let i = 0; i < 3; i++) steps.push(nextWindowLimit(steps.at(-1)!));
    expect(steps).toEqual([48, 96, 192, 384]);
  });

  test("past 384 it grows by a flat 384", () => {
    expect(nextWindowLimit(384)).toBe(768);
    expect(nextWindowLimit(768)).toBe(1152);
    expect(nextWindowLimit(1152)).toBe(1536);
  });

  test("the cap scales with an injected slice size", () => {
    expect(nextWindowLimit(10, 10)).toBe(20);
    expect(nextWindowLimit(80, 10)).toBe(160);
    expect(nextWindowLimit(160, 10)).toBe(240);
  });
});

describe("windowSlice", () => {
  const all = ["a", "b", "c", "d"];

  test("takes the first `limit` items", () => {
    expect(windowSlice(all, 2)).toEqual(["a", "b"]);
  });

  test("returns the list itself, uncopied, once the limit reaches its length", () => {
    expect(windowSlice(all, 4)).toBe(all);
    expect(windowSlice(all, 99)).toBe(all);
  });

  test("an empty list stays empty", () => {
    expect(windowSlice([], 48)).toEqual([]);
  });
});
