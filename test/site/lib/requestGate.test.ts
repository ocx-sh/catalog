import { describe, expect, test } from "vitest";
import { createRequestGate } from "../../../src/site/lib/requestGate.js";

describe("createRequestGate", () => {
  test("the latest request is current", () => {
    const gate = createRequestGate();
    expect(gate.begin()()).toBe(true);
  });

  test("a newer begin() supersedes every earlier request, and only the newest stays current", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    const third = gate.begin();
    expect([first(), second(), third()]).toEqual([false, false, true]);
  });

  test("gates are independent of each other", () => {
    const a = createRequestGate();
    const b = createRequestGate();
    const fromA = a.begin();
    b.begin();
    b.begin();
    expect(fromA()).toBe(true);
  });
});
