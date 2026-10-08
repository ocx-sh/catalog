import { describe, expect, test } from "vitest";
import { liveTagsNewestFirst } from "../../../src/site/lib/liveTags.js";

describe("liveTagsNewestFirst", () => {
  test("drops yanked tags, orders newest observation first, ties by descending numeric tag", () => {
    const tags = {
      "1.9.0": { observed: "2026-01-01T00:00:00Z" },
      "1.10.0": { observed: "2026-01-01T00:00:00Z", yanked: null },
      "2.0.0": { observed: "2026-03-01T00:00:00Z" },
      "1.0.0": { observed: "2026-04-01T00:00:00Z", yanked: { reason: "bad", at: "2026-04-02T00:00:00Z" } },
    };

    expect(liveTagsNewestFirst(tags)).toEqual(["2.0.0", "1.10.0", "1.9.0"]);
  });

  test("a package with no tags has none", () => {
    expect(liveTagsNewestFirst({})).toEqual([]);
  });
});
