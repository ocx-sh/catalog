/**
 * The Platforms card as data (D-061, D-072): shared architecture columns, rows
 * in canonical OS order, and the platform-agnostic collapse.
 */
import { describe, expect, it } from "vitest";
import { platformMatrix } from "../../../src/site/lib/platformMatrix.js";

describe("platformMatrix", () => {
  it("D-072: one row per OS over columns shared by every row, amd64 and arm64 first", () => {
    const matrix = platformMatrix(["windows/amd64", "linux/riscv64", "linux/arm64", "darwin/arm64", "linux/amd64", "linux/386"]);

    expect(matrix.agnostic).toBe(false);
    expect(matrix.columns).toEqual(["amd64", "arm64", "386", "riscv64"]);
    expect(matrix.rows).toEqual([
      { os: "linux", label: "Linux", arches: ["riscv64", "arm64", "amd64", "386"] },
      { os: "darwin", label: "macOS", arches: ["arm64"] },
      { os: "windows", label: "Windows", arches: ["amd64"] },
    ]);
  });

  it("D-072: a platform-agnostic tag collapses to one 'any platform' state and hides the specific builds beside it", () => {
    expect(platformMatrix(["any/any", "linux/amd64"])).toEqual({ agnostic: true, columns: [], rows: [] });
  });

  it("no platforms is an empty, non-agnostic card", () => {
    expect(platformMatrix([])).toEqual({ agnostic: false, columns: [], rows: [] });
  });

  it("an OS outside the glyph set keeps its own name and sorts after the known ones", () => {
    const { rows } = platformMatrix(["plan9/amd64", "freebsd/amd64", "linux/amd64"]);

    expect(rows.map((row) => [row.os, row.label])).toEqual([
      ["linux", "Linux"],
      ["freebsd", "freebsd"],
      ["plan9", "plan9"],
    ]);
  });

  it("a bare os adds a row and no column", () => {
    expect(platformMatrix(["linux"])).toEqual({ agnostic: false, columns: [], rows: [{ os: "linux", label: "Linux", arches: [] }] });
  });
});
