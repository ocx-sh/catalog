import { describe, expect, test } from "vitest";
import {
  buildVersionOptions,
  depthLevel,
  PIN_LEVEL_RANK,
  pickVersionOption,
  type VersionOption,
} from "../../../src/site/lib/pinLevel.js";

describe("depthLevel", () => {
  test.each([
    ["latest", "latest"],
    ["slim", "rolling"],
    ["3", "major"],
    ["3.31", "minor"],
    ["3.31.7", "patch"],
    ["3.31.7-rc1", "pinned"],
    ["3.31.7+20260101", "pinned"],
    ["slim-3", "major"],
    ["slim-3.31.7", "patch"],
  ])("%s is %s", (tag, level) => {
    expect(depthLevel(tag)).toBe(level);
  });
});

describe("PIN_LEVEL_RANK", () => {
  test("latest and rolling share rank 0 and every deeper level ranks higher", () => {
    expect(PIN_LEVEL_RANK).toEqual({ latest: 0, rolling: 0, major: 1, minor: 2, patch: 3, pinned: 4 });
  });
});

describe("buildVersionOptions", () => {
  test("an empty chain has no options", () => {
    expect(buildVersionOptions([])).toEqual([]);
  });

  test("the deepest member is labelled pinned, keeping its real rank", () => {
    const opts = buildVersionOptions([{ tag: "latest" }, { tag: "3" }, { tag: "3.31" }, { tag: "3.31.7" }]);
    expect(opts).toEqual([
      { tag: "latest", rank: 0, label: "latest" },
      { tag: "3", rank: 1, label: "major" },
      { tag: "3.31", rank: 2, label: "minor" },
      { tag: "3.31.7", rank: 3, label: "pinned" },
    ]);
  });

  test("when a build tag exists too, the plain patch tag stays patch (no duplicate pinned)", () => {
    const opts = buildVersionOptions([{ tag: "3.31" }, { tag: "3.31.7" }, { tag: "3.31.7+b1" }]);
    expect(opts.map((o) => o.label)).toEqual(["minor", "patch", "pinned"]);
  });

  test("on a rank tie the later member is the deeper one", () => {
    const opts = buildVersionOptions([{ tag: "3.1.0" }, { tag: "3.2.0" }]);
    expect(opts.map((o) => o.label)).toEqual(["patch", "pinned"]);
  });
});

describe("pickVersionOption", () => {
  const chain: VersionOption[] = buildVersionOptions([
    { tag: "latest" },
    { tag: "3" },
    { tag: "3.31" },
    { tag: "3.31.7" },
  ]);

  test("an empty chain picks nothing", () => {
    expect(pickVersionOption([], "latest")).toBeNull();
  });

  test("an exact level match wins", () => {
    expect(pickVersionOption(chain, "latest")?.tag).toBe("latest");
    expect(pickVersionOption(chain, "major")?.tag).toBe("3");
    expect(pickVersionOption(chain, "minor")?.tag).toBe("3.31");
  });

  test("pinned lands on the deepest option, whatever its own level", () => {
    expect(pickVersionOption(chain, "pinned")?.tag).toBe("3.31.7");
  });

  test("a rolling preference counts as latest and lands on the depth-0 entry", () => {
    expect(pickVersionOption(chain, "rolling")?.tag).toBe("latest");
  });

  test("an absent level resolves to the nearest, ties toward the deeper option", () => {
    const noMinor = buildVersionOptions([{ tag: "latest" }, { tag: "3" }, { tag: "3.31.7" }]);
    // minor (2) sits between major (1) and the deepest (3): equal distance -> deeper.
    expect(pickVersionOption(noMinor, "minor")?.tag).toBe("3.31.7");
  });

  test("a patch preference with only a pinned build prefers it over the looser minor", () => {
    const opts = buildVersionOptions([{ tag: "3.31" }, { tag: "3.31.7+b1" }]);
    expect(pickVersionOption(opts, "patch")?.tag).toBe("3.31.7+b1");
  });

  test("does not reorder the options it was given", () => {
    const before = chain.map((o) => o.tag);
    pickVersionOption(chain, "pinned");
    expect(chain.map((o) => o.tag)).toEqual(before);
  });
});
