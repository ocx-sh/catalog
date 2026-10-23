// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readViewPrefs, SORT_STORAGE_KEY, VIEW_STORAGE_KEY, writeViewPrefs } from "../../../src/site/lib/viewPrefs.js";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("D-170 the remembered view and sort key", () => {
  test("D-170 nothing stored reads as nothing, and stored choices read back under the 0.5.x keys", () => {
    expect(readViewPrefs()).toEqual({ view: null, sort: null });
    localStorage.setItem("ocx-catalog-view", "table");
    localStorage.setItem("ocx-catalog-sort", "updated");
    expect(readViewPrefs()).toEqual({ view: "table", sort: "updated" });
    expect([VIEW_STORAGE_KEY, SORT_STORAGE_KEY]).toEqual(["ocx-catalog-view", "ocx-catalog-sort"]);
  });

  test("D-170 an unknown stored value is not a mode", () => {
    localStorage.setItem("ocx-catalog-view", "gallery");
    localStorage.setItem("ocx-catalog-sort", "popularity");
    expect(readViewPrefs()).toEqual({ view: null, sort: null });
  });

  test("D-170 writes only what it is given", () => {
    writeViewPrefs({ view: "table" });
    expect(localStorage.getItem("ocx-catalog-view")).toBe("table");
    expect(localStorage.getItem("ocx-catalog-sort")).toBeNull();
    writeViewPrefs({ sort: "created" });
    expect(localStorage.getItem("ocx-catalog-sort")).toBe("created");
    writeViewPrefs({});
    expect(readViewPrefs()).toEqual({ view: "table", sort: "created" });
  });

  test("D-170 blocked storage neither throws nor remembers (every access is guarded)", () => {
    const get = vi.fn(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const set = vi.fn(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.stubGlobal("localStorage", { getItem: get, setItem: set });
    expect(readViewPrefs()).toEqual({ view: null, sort: null });
    expect(() => writeViewPrefs({ view: "table", sort: "name" })).not.toThrow();
    // Both accesses really reached the throwing storage, so the guards are what held.
    expect(get).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
  });
});
