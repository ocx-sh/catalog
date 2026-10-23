/** D-136 — the footer's freshness stamp, from the catalog's `generated` timestamp. */
import { describe, expect, it } from "vitest";
import { freshnessLabel } from "../../../src/site/lib/freshness.js";

const GENERATED = "2026-10-01T12:00:00.000Z";
const at = (minutes: number): number => Date.parse(GENERATED) + minutes * 60_000;

describe("freshnessLabel (D-136)", () => {
  it("D-136 reads 'updated just now' under a minute", () => {
    expect(freshnessLabel(GENERATED, at(0))).toBe("updated just now");
    expect(freshnessLabel(GENERATED, at(0.5))).toBe("updated just now");
  });

  it("D-136 reads minutes, then hours, then days", () => {
    expect(freshnessLabel(GENERATED, at(5))).toBe("updated 5m ago");
    expect(freshnessLabel(GENERATED, at(59))).toBe("updated 59m ago");
    expect(freshnessLabel(GENERATED, at(60))).toBe("updated 1h ago");
    expect(freshnessLabel(GENERATED, at(60 * 23))).toBe("updated 23h ago");
    expect(freshnessLabel(GENERATED, at(60 * 24))).toBe("updated 1d ago");
    expect(freshnessLabel(GENERATED, at(60 * 24 * 3))).toBe("updated 3d ago");
  });

  it("D-136 clamps a timestamp in the future to just now", () => {
    expect(freshnessLabel(GENERATED, at(-30))).toBe("updated just now");
  });

  it("D-136 names nothing for a timestamp that does not parse", () => {
    expect(freshnessLabel("not a date", at(0))).toBeNull();
  });
});
