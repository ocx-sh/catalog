/**
 * The detail page's version table (D-053, D-054, D-057, D-059, D-076): one
 * row per variant, alias chains by digest, a major/minor/patch breakdown, and a
 * yanked tag that stays in its place. Digests decide chains and never reach the result.
 */
import { describe, expect, it } from "vitest";
import {
  breakdownCount,
  buildVersionTable,
  compareVersions,
  minorIsCut,
  parseTag,
  parseVersion,
  prerender,
  rowIsCut,
  SSR_LINES,
  SSR_OTHER,
  SSR_PATCHES,
  SSR_TRACKS,
  tagTitle,
  trackKey,
  versionDepth,
  type TableTag,
  type Version,
} from "../../../src/site/lib/versionTable.js";
import type { Yank } from "../../../src/viewmodel/types.js";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
const C = `sha256:${"c".repeat(64)}`;
const YANK: Yank = { reason: "bad build", at: "2026-02-03T00:00:00Z" };

const live = (content: string): TableTag => ({ content, yanked: null });
const yanked = (content: string): TableTag => ({ content, yanked: YANK });
const names = (tags: readonly { tag: string }[]): string[] => tags.map(({ tag }) => tag);

describe("parseVersion / parseTag", () => {
  it.each([
    ["3", { variant: null, major: 3, minor: null, patch: null, prerelease: null, build: null }],
    ["3.31", { variant: null, major: 3, minor: 31, patch: null, prerelease: null, build: null }],
    ["3.31.2", { variant: null, major: 3, minor: 31, patch: 2, prerelease: null, build: null }],
    ["3.31.2-rc1", { variant: null, major: 3, minor: 31, patch: 2, prerelease: "rc1", build: null }],
    ["3.31.2_b5", { variant: null, major: 3, minor: 31, patch: 2, prerelease: null, build: "b5" }],
    ["3.31.2-rc1+b5", { variant: null, major: 3, minor: 31, patch: 2, prerelease: "rc1", build: "b5" }],
    ["slim-1.2.3", { variant: "slim", major: 1, minor: 2, patch: 3, prerelease: null, build: null }],
  ])("reads %s", (tag, expected) => {
    expect(parseVersion(tag)).toEqual(expected);
  });

  it.each(["latest-1.2.3", "01.2.3", "1.2.3.4", "v1", "slim", ""])("rejects %j", (tag) => {
    expect(parseVersion(tag)).toBeNull();
  });

  it("classifies latest, versions and everything else", () => {
    expect(parseTag("latest")).toEqual({ kind: "latest" });
    expect(parseTag("1.2")).toMatchObject({ kind: "version", raw: "1.2" });
    expect(parseTag("nightly")).toEqual({ kind: "other", raw: "nightly" });
  });

  it("versionDepth counts major, minor, patch and a patch with a prerelease or build", () => {
    expect([ "1", "1.2", "1.2.3", "1.2.3-rc1", "1.2.3_b1"].map((t) => versionDepth(parseVersion(t)!))).toEqual([1, 2, 3, 4, 4]);
  });
});

describe("compareVersions", () => {
  const v = (overrides: Partial<Version>): Version => ({ variant: null, major: 1, minor: 1, patch: 1, prerelease: null, build: null, ...overrides });

  it("orders variants: the unprefixed one above any variant, variants lexically", () => {
    expect(compareVersions(v({}), v({ variant: "alpine" }))).toBe(1);
    expect(compareVersions(v({ variant: "alpine" }), v({}))).toBe(-1);
    expect(compareVersions(v({ variant: "alpine" }), v({ variant: "slim" }))).toBeLessThan(0);
  });

  it("orders numbers, with a missing component above a present one", () => {
    expect(compareVersions(v({ major: 2 }), v({ major: 1 }))).toBe(1);
    expect(compareVersions(v({ minor: null, patch: null }), v({ patch: null }))).toBe(1);
    expect(compareVersions(v({ patch: null }), v({ minor: null, patch: null }))).toBe(-1);
    expect(compareVersions(v({ minor: 2 }), v({ minor: 1 }))).toBe(1);
    expect(compareVersions(v({ patch: null }), v({}))).toBe(1);
    expect(compareVersions(v({}), v({ patch: null }))).toBe(-1);
    expect(compareVersions(v({ patch: 3 }), v({ patch: 2 }))).toBe(1);
  });

  it("a prerelease or build sorts below none, otherwise lexically", () => {
    expect(compareVersions(v({ prerelease: "rc1" }), v({}))).toBe(-1);
    expect(compareVersions(v({}), v({ prerelease: "rc1" }))).toBe(1);
    expect(compareVersions(v({ prerelease: "rc1" }), v({ prerelease: "rc2" }))).toBeLessThan(0);
    expect(compareVersions(v({ build: "b1" }), v({}))).toBe(-1);
    expect(compareVersions(v({}), v({ build: "b1" }))).toBe(1);
    expect(compareVersions(v({ build: "b2" }), v({ build: "b1" }))).toBeGreaterThan(0);
    expect(compareVersions(v({}), v({}))).toBe(0);
  });
});

describe("buildVersionTable — the default row", () => {
  it("D-053: a live latest is primary; the alias chain is rolling first, then least to most specific", () => {
    const { rows } = buildVersionTable(
      { "1.2.3": live(A), "1": live(A), latest: live(A), "1.2": live(A), "1.2.2": live(B) },
      "active",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ variant: null, label: "default", isDefault: true, primaryTag: "latest", showLatestHighlight: true });
    expect(names(rows[0]!.aliasChain)).toEqual(["latest", "1", "1.2", "1.2.3"]);
    expect(rows[0]!.preciseAliasTag).toBe("1.2.3");
  });

  it("D-076: the precise alias is the newest among equally deep aliases of latest", () => {
    const { rows } = buildVersionTable({ latest: live(A), "1.2.3": live(A), "1.2.4": live(A) }, "active");

    expect(rows[0]!.preciseAliasTag).toBe("1.2.4");
  });

  it("an ephemeral newer alias of latest is never the precise alias", () => {
    const { rows } = buildVersionTable({ latest: live(A), "1.2.3": live(A), "1.2.4": { content: A, yanked: null, ephemeral: true } }, "active");

    expect(rows[0]!.preciseAliasTag).toBe("1.2.3");
  });

  it("a latest with no sibling has no precise alias", () => {
    expect(buildVersionTable({ latest: live(A) }, "active").rows[0]!.preciseAliasTag).toBeNull();
  });

  it("without latest the newest most-precise live version is primary and carries no highlight", () => {
    const { rows } = buildVersionTable({ "1.0.0": live(A), "2.0": live(B), "2.1.0": live(C), "2.0.9": live(B) }, "active");

    expect(rows[0]).toMatchObject({ primaryTag: "2.1.0", showLatestHighlight: false, preciseAliasTag: null });
    expect(names(rows[0]!.aliasChain)).toEqual(["2.1.0"]);
  });

  it("falls to a shallower depth when no patch exists", () => {
    expect(buildVersionTable({ "1": live(A), "1.1": live(B) }, "active").rows[0]!.primaryTag).toBe("1.1");
    expect(buildVersionTable({ "3": live(A) }, "active").rows[0]!.primaryTag).toBe("3");
  });

  it("a pre-release or ephemeral tag is never primary, so the install card never opens on it", () => {
    const { rows } = buildVersionTable({ "1.0.0": live(A), "1.0.1-rc1": live(B), "1.0.2": { content: B, yanked: null, ephemeral: true } }, "active");

    expect(rows[0]!.primaryTag).toBe("1.0.0");
    expect(names(rows[0]!.aliasChain)).toEqual(["1.0.0"]);
  });

  it("an ephemeral rolling tag is skipped as primary too", () => {
    expect(buildVersionTable({ latest: { content: B, yanked: null, ephemeral: true }, "1.0.0": live(A) }, "active").rows[0]!.primaryTag).toBe("1.0.0");
  });

  it("D-054: a yanked rolling tag is never primary but stays beside the chain", () => {
    const { rows } = buildVersionTable({ latest: yanked(A), "1.0.0": live(B) }, "active");

    expect(rows[0]!.primaryTag).toBe("1.0.0");
    expect(rows[0]!.showLatestHighlight).toBe(false);
    expect(rows[0]!.yankedRolling).toEqual([{ tag: "latest", yanked: YANK, ephemeral: false }]);
    expect(names(rows[0]!.aliasChain)).toEqual(["1.0.0"]);
  });

  it("a deprecated package drops its stray latest; the install target is the newest version", () => {
    const { rows } = buildVersionTable({ latest: live(A), "1.0.0": live(B), "1.1.0": live(C) }, "deprecated");

    expect(rows[0]).toMatchObject({ primaryTag: "1.1.0", showLatestHighlight: false, preciseAliasTag: null });
    expect(names(rows[0]!.aliasChain)).toEqual(["1.1.0"]);
  });

  it("a package with only yanked tags has no primary and an empty chain, but still lists them", () => {
    const { rows } = buildVersionTable({ "1.0.0": yanked(A) }, "active");

    expect(rows[0]).toMatchObject({ primaryTag: null, aliasChain: [], preciseAliasTag: null });
    expect(rows[0]!.majorGroups[0]!.minorGroups[0]!.patches).toEqual([{ tag: "1.0.0", yanked: YANK, ephemeral: false }]);
  });

  it("no tags, no rows", () => {
    expect(buildVersionTable({}, "active")).toEqual({ rows: [], tracks: [], unknownTags: [] });
  });
});

describe("buildVersionTable — variants and unknown tags", () => {
  it("D-053: variants get their own rows after the default one, sorted by name", () => {
    const { rows } = buildVersionTable(
      { "1.0.0": live(A), "slim-1.0.0": live(B), "alpine-1.0.0": live(C), alpine: live(C) },
      "active",
    );

    expect(rows.map((row) => row.variant)).toEqual([null, "alpine", "slim"]);
    expect(rows[1]).toMatchObject({ label: "alpine", isDefault: false, primaryTag: "alpine", showLatestHighlight: false });
    expect(names(rows[1]!.aliasChain)).toEqual(["alpine", "alpine-1.0.0"]);
    expect(rows[2]!.primaryTag).toBe("slim-1.0.0");
  });

  it("the default row leads however the wire orders its tags", () => {
    const { rows } = buildVersionTable({ "alpine-1.0.0": live(B), "slim-1.0.0": live(C), "1.0.0": live(A) }, "active");

    expect(rows.map((row) => row.variant)).toEqual([null, "alpine", "slim"]);
  });

  it("variants sort by name when only variants exist", () => {
    const { rows } = buildVersionTable({ "slim-1.0.0": live(A), "alpine-1.0.0": live(B) }, "active");

    expect(rows.map((row) => row.variant)).toEqual(["alpine", "slim"]);
  });

  it("a deprecated package keeps a variant's rolling tag", () => {
    const { rows } = buildVersionTable({ "slim-1.0.0": live(A), slim: live(A) }, "deprecated");

    expect(rows[0]!.primaryTag).toBe("slim");
  });

  it("a bare name is a variant only when a prefixed version proves it; otherwise it is unknown", () => {
    const { rows, unknownTags } = buildVersionTable({ nightly: yanked(A), "1.0.0": live(B), slim: live(C), "slim-1.0.0": live(C) }, "active");

    expect(rows.map((row) => row.variant)).toEqual([null, "slim"]);
    expect(unknownTags).toEqual([{ tag: "nightly", yanked: YANK, ephemeral: false }]);
  });
});

describe("buildVersionTable — the breakdown", () => {
  const table = () =>
    buildVersionTable(
      {
        latest: live(A),
        "3.31.2": live(A),
        "3.31.1": yanked(B),
        "3.31": live(A),
        "3": live(A),
        "3.30.0-rc1": live(C),
        "3.30.0_b1": live(C),
        "2.1.0": live(C),
        "1": live(C),
      },
      "active",
    ).rows[0]!;

  it("D-057: groups by major, then minor, newest first, with real group tags where they exist", () => {
    const row = table();

    expect(row.majorGroups.map((m) => m.label)).toEqual(["3", "2", "1"]);
    const three = row.majorGroups[0]!;
    expect(three).toMatchObject({ major: 3, tag: "3", synthetic: false, yanked: null });
    expect(three.minorGroups.map((m) => m.label)).toEqual(["3.31", "3.30"]);
    expect(three.minorGroups[0]).toMatchObject({ tag: "3.31", synthetic: false });
    expect(names(three.minorGroups[0]!.patches)).toEqual(["3.31.2", "3.31.1"]);
  });

  it("D-057: a missing group tag is synthesised from the newest release beneath it", () => {
    const row = table();
    const three = row.majorGroups[0]!;
    const thirty = three.minorGroups[1]!;

    expect(thirty).toMatchObject({ label: "3.30", tag: "3.30.0_b1", synthetic: true, yanked: null });
    expect(names(thirty.patches)).toEqual(["3.30.0_b1"]); // 3.30.0-rc1 is a track, not a patch
    const two = row.majorGroups[1]!;
    expect(two).toMatchObject({ label: "2", tag: "2.1.0", synthetic: true });
    expect(two.minorGroups[0]).toMatchObject({ label: "2.1", tag: "2.1.0", synthetic: true });
    expect(row.majorGroups[2]).toMatchObject({ label: "1", tag: "1", synthetic: false });
    expect(row.majorGroups[2]!.minorGroups).toEqual([]);
  });

  it("a variant's synthesised group labels keep the prefix", () => {
    const row = buildVersionTable({ "slim-2.1.0": live(A) }, "active").rows[0]!;

    expect(row.majorGroups[0]).toMatchObject({ label: "slim-2", tag: "slim-2.1.0" });
    expect(row.majorGroups[0]!.minorGroups[0]).toMatchObject({ label: "slim-2.1", tag: "slim-2.1.0" });
  });

  it("a minor tag with no patches is a group with an empty list", () => {
    const row = buildVersionTable({ "2.1": live(A) }, "active").rows[0]!;

    expect(row.majorGroups[0]!.minorGroups[0]).toMatchObject({ label: "2.1", tag: "2.1", patches: [] });
    expect(row.majorGroups[0]).toMatchObject({ label: "2", tag: "2.1", synthetic: true });
  });

  it("D-054: a yanked tag stays in its group with its record; group heads carry their own", () => {
    const row = buildVersionTable({ "3": yanked(A), "3.1": yanked(A), "3.1.0": yanked(A), "3.1.1": live(B) }, "active").rows[0]!;
    const major = row.majorGroups[0]!;

    expect(major.yanked).toEqual(YANK);
    expect(major.minorGroups[0]!.yanked).toEqual(YANK);
    expect(major.minorGroups[0]!.patches).toEqual([
      { tag: "3.1.1", yanked: null, ephemeral: false },
      { tag: "3.1.0", yanked: YANK, ephemeral: false },
    ]);
  });

  it("D-057: the toggle counts real group tags, minor groups and their patches", () => {
    // 3 (real) + 3.31 and its two patches + 3.30 and its one patch + 2 (synthetic, not counted) + 2.1 and 1 patch + 1 (real)
    expect(breakdownCount(table())).toBe(1 + 3 + 2 + 0 + 2 + 1);
  });
});

describe("buildVersionTable — unknown tags", () => {
  it("lists tags that are neither versions nor variants, yanked ones with their record", () => {
    const { rows, unknownTags } = buildVersionTable({ nightly: live(A), edge: yanked(B) }, "active");

    expect(rows).toEqual([]);
    expect(unknownTags).toEqual([
      { tag: "nightly", yanked: null, ephemeral: false },
      { tag: "edge", yanked: YANK, ephemeral: false },
    ]);
  });
});

describe("prerender — a bounded tree, the rest fetched on interaction (D-149)", () => {
  /** `lines` minors of major 1, each with `patches` patch tags, all on distinct digests, plus `latest` on the newest. */
  function big(lines: number, patches: number, extra: Record<string, TableTag> = {}) {
    const tags: Record<string, TableTag> = { latest: live(A), ...extra };
    for (let minor = 0; minor < lines; minor++) {
      tags[`1.${minor}`] = live(B);
      for (let patch = 0; patch < patches; patch++) tags[`1.${minor}.${patch}`] = live(C);
    }
    return buildVersionTable(tags, "active");
  }

  it("D-149: a small package is prerendered whole, with nothing left to fetch", () => {
    const small = big(3, 4);
    const { shown, tags, cut } = prerender(small);

    expect(cut).toBe(false);
    const row = small.rows[0]!;
    expect(rowIsCut(row, shown)).toBe(false);
    expect(row.majorGroups.every((major) => shown.has(major))).toBe(true);
    for (const name of ["latest", "1.0", "1.2", "1.2.3"]) expect(tags.has(name)).toBe(true);
  });

  it("D-149: every alias of a row is a prerendered tag, whatever the bounds cut", () => {
    const { tags } = prerender(big(SSR_LINES + 5, 3));
    expect(tags.has("latest")).toBe(true);
  });

  it("D-149: the newest SSR_PATCHES patch tags are prerendered, newest minor first, and the older minors keep their count only", () => {
    const table = big(5, SSR_PATCHES);
    const { shown, tags, cut } = prerender(table);
    const [newest, second] = table.rows[0]!.majorGroups[0]!.minorGroups;

    expect(cut).toBe(true);
    expect(newest!.patches.every((patch) => shown.has(patch))).toBe(true);
    expect(minorIsCut(newest!, shown)).toBe(false);
    expect(second!.patches.some((patch) => shown.has(patch))).toBe(false);
    expect(minorIsCut(second!, shown)).toBe(true);
    expect(tags.has("1.4.0")).toBe(true);
    expect(tags.has("1.3.0")).toBe(false);
    expect(second!.patches.length).toBe(SSR_PATCHES);
  });

  it("D-149: a minor line that does not fit the patch budget is prerendered with the patches that do", () => {
    const table = big(1, SSR_PATCHES + 4);
    const { shown } = prerender(table);
    const minor = table.rows[0]!.majorGroups[0]!.minorGroups[0]!;

    expect(minor.patches.filter((patch) => shown.has(patch))).toHaveLength(SSR_PATCHES);
    expect(minorIsCut(minor, shown)).toBe(true);
    expect(rowIsCut(table.rows[0]!, shown)).toBe(true);
  });

  it("D-149: lines are bounded per row: past SSR_LINES the major and minor groups are left out whole", () => {
    const table = big(SSR_LINES + 6, 0);
    const { shown, cut } = prerender(table);
    const [major] = table.rows[0]!.majorGroups;

    expect(cut).toBe(true);
    expect(shown.has(major!)).toBe(true);
    // The major takes one line, so SSR_LINES - 1 minor lines follow.
    expect(major!.minorGroups.filter((minor) => shown.has(minor))).toHaveLength(SSR_LINES - 1);
  });

  it("D-149: a row past SSR_LINES leaves its older majors out whole", () => {
    const tags: Record<string, TableTag> = {};
    for (let major = 1; major <= SSR_LINES + 3; major++) tags[String(major)] = live(A);
    const table = buildVersionTable(tags, "active");
    const { shown, cut } = prerender(table);

    expect(cut).toBe(true);
    expect(table.rows[0]!.majorGroups.filter((major) => shown.has(major))).toHaveLength(SSR_LINES);
    expect(rowIsCut(table.rows[0]!, shown)).toBe(true);
  });

  it("D-149: the budget is per variant row, so every variant keeps its newest lines", () => {
    const tags: Record<string, TableTag> = {};
    for (const variant of ["", "slim-"]) for (let minor = 0; minor < SSR_LINES + 4; minor++) tags[`${variant}1.${minor}`] = live(B);
    const table = buildVersionTable(tags, "active");
    const { shown } = prerender(table);

    for (const row of table.rows) expect(row.majorGroups[0]!.minorGroups.filter((minor) => shown.has(minor)).length).toBe(SSR_LINES - 1);
  });

  it("D-149: the other row shows SSR_OTHER tags and counts the rest as left to fetch", () => {
    const others = Object.fromEntries(Array.from({ length: SSR_OTHER + 2 }, (_, i) => [`edge${String.fromCharCode(97 + i)}`, live(A)]));
    const table = buildVersionTable(others, "active");
    const { tags, cut } = prerender(table);

    expect(cut).toBe(true);
    expect([...tags]).toEqual(table.unknownTags.slice(0, SSR_OTHER).map(({ tag }) => tag));
    expect(prerender(buildVersionTable(Object.fromEntries(Object.entries(others).slice(0, SSR_OTHER)), "active")).cut).toBe(false);
  });

  it("D-149: rolling and withdrawn-rolling tags are always prerendered", () => {
    const table = buildVersionTable({ latest: yanked(A), "1.0.0": live(B) }, "active");
    expect(prerender(table).tags.has("latest")).toBe(true);
  });
});

describe("ephemeral tags", () => {
  it("carries the marker onto every chip kind: alias, header, patch and other", () => {
    const eph = (content: string): TableTag => ({ content, yanked: null, ephemeral: true });
    const { rows, unknownTags } = buildVersionTable(
      { latest: live(A), "1": eph(A), "1.2": live(B), "1.2.3": eph(B), "1.2.4": live(C), nightly: eph(C) },
      "active",
    );
    expect(rows[0]!.aliasChain.map(({ tag, ephemeral }) => [tag, ephemeral])).toEqual([["latest", false], ["1", true]]);
    expect(rows[0]!.majorGroups[0]!.ephemeral).toBe(true);
    expect(rows[0]!.majorGroups[0]!.minorGroups[0]!.ephemeral).toBe(false);
    expect(rows[0]!.majorGroups[0]!.minorGroups[0]!.patches.map(({ tag, ephemeral }) => [tag, ephemeral])).toEqual([["1.2.4", false], ["1.2.3", true]]);
    expect(unknownTags).toEqual([{ tag: "nightly", yanked: null, ephemeral: true }]);
  });

  it.each([[undefined], [false], [null], ["true"], [1]])("a wire value of %j is durable", (value) => {
    const { unknownTags } = buildVersionTable({ x: { content: A, yanked: null, ephemeral: value as boolean } }, "active");
    expect(unknownTags[0]!.ephemeral).toBe(false);
  });

  it("a synthesised header is durable; its tag's own chip is the marked one", () => {
    const { rows } = buildVersionTable({ "2.0.1": { content: A, yanked: null, ephemeral: true } }, "active");
    expect(rows[0]!.majorGroups[0]!.ephemeral).toBe(false);
    expect(rows[0]!.majorGroups[0]!.minorGroups[0]!.patches[0]!.ephemeral).toBe(true);
  });

  it("tagTitle gives the reason, and a yank outranks it", () => {
    expect(tagTitle(null, true)).toBe("Ephemeral: may be pruned from the registry — click to copy identifier · right-click for more");
    expect(tagTitle(YANK, true)).toBe(tagTitle(YANK));
  });
});

describe("tracks — pre-releases and builds apart from the stable tree", () => {
  const eph = (content: string, observed: string): TableTag => ({ content, yanked: null, ephemeral: true, observed });

  it.each([
    ["mr11_20261020T101500Z", "mr11"],
    ["canary_20261020", "canary"],
    ["1.3.0-snapshot_20261020", "1.3.0-snapshot"],
    ["2.0.0-rc.1", "2.0.0-rc"],
    ["nightly-2026-10-20", "nightly"],
    ["build.42", "build"],
    ["2.0.0-beta", "2.0.0-beta"],
    ["1.3.0-20261020", "1.3.0-20261020"],
    ["mr11", "mr11"],
  ])("trackKey strips only a trailing build stamp: %s -> %s", (tag, key) => {
    expect(trackKey(tag)).toBe(key);
  });

  it("splits stable tags from tracks: versions and rolling names stay in rows, pre-releases and stamped names are tracks", () => {
    const { rows, tracks, unknownTags } = buildVersionTable(
      {
        latest: live(A),
        "1.4.2": live(A),
        "2.0.0-rc.1": live(B),
        "2.0.0-rc.2": live(B),
        mr11_20261020T101500Z: eph(B, "2026-10-20T10:15:00Z"),
        mr11_20261021T090000Z: eph(B, "2026-10-21T09:00:00Z"),
        canary_20261022: eph(B, "2026-10-22T03:00:00Z"),
        edge: live(C),
      },
      "active",
    );

    expect(names(rows[0]!.aliasChain)).toEqual(["latest", "1.4.2"]);
    expect(names(unknownTags)).toEqual(["edge"]);
    expect(tracks.map((track) => track.key)).toEqual(["canary", "mr11", "2.0.0-rc"]);
  });

  it("a track headlines its newest build and lists the older ones newest first, numbers by value", () => {
    const { tracks } = buildVersionTable(
      { mr11_20261020T101500Z: eph(B, ""), mr11_20261021T090000Z: eph(B, ""), "2.0.0-rc.9": live(B), "2.0.0-rc.10": live(B) },
      "active",
    );
    const [rc, mr] = [tracks.find(({ key }) => key === "2.0.0-rc")!, tracks.find(({ key }) => key === "mr11")!];

    expect(mr).toMatchObject({ tag: "mr11_20261021T090000Z", label: "mr11_20261021T090000Z", ephemeral: true, synthetic: false });
    expect(names(mr.patches)).toEqual(["mr11_20261020T101500Z"]);
    expect(rc.tag).toBe("2.0.0-rc.10");
    expect(rc.ephemeral).toBe(false);
    expect(names(rc.patches)).toEqual(["2.0.0-rc.9"]);
  });

  it("a withdrawn newest build is not the headline but stays in the list", () => {
    const { tracks } = buildVersionTable({ "3.0.0-rc.1": live(A), "3.0.0-rc.2": yanked(A) }, "active");

    expect(tracks[0]!.tag).toBe("3.0.0-rc.1");
    expect(tracks[0]!.patches).toEqual([{ tag: "3.0.0-rc.2", yanked: YANK, ephemeral: false }]);
  });

  it("a track with only withdrawn builds headlines the newest", () => {
    expect(buildVersionTable({ "3.0.0-rc.1": yanked(A), "3.0.0-rc.2": yanked(A) }, "active").tracks[0]!.tag).toBe("3.0.0-rc.2");
  });

  it("orders tracks by their latest observation, then by key", () => {
    const at = (observed: string): TableTag => ({ content: A, yanked: null, observed });
    const { tracks } = buildVersionTable(
      { b_1: at("2026-10-02T00:00:00Z"), a_1: at("2026-10-02T00:00:00Z"), c_1: at("2026-10-03T00:00:00Z"), d_1: at("2026-10-01T00:00:00Z"), d_2: at("2026-10-01T00:00:00Z"), e_1: live(A) },
      "active",
    );

    expect(tracks.map(({ key }) => key)).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("a bare variant name that looks stamped stays a variant row, not a track", () => {
    const { rows, tracks } = buildVersionTable({ "node.20-1.0.0": live(A), "node.20": live(A) }, "active");

    expect(rows.map((row) => row.variant)).toEqual(["node.20"]);
    expect(tracks).toEqual([]);
  });

  it("a variant's pre-release is a track too", () => {
    expect(buildVersionTable({ "slim-1.0.0": live(A), "slim-1.1.0-rc1": live(B) }, "active").tracks.map(({ key }) => key)).toEqual(["slim-1.1.0-rc1"]);
  });

  it("prerender: SSR_TRACKS tracks and SSR_PATCHES builds each are drawn; the rest is left to fetch", () => {
    const many = Object.fromEntries(Array.from({ length: SSR_TRACKS + 1 }, (_, i) => [`mr${i}_1`, live(A)]));
    const table = buildVersionTable(many, "active");
    const { shown, tags, cut } = prerender(table);

    expect(table.tracks.filter((track) => shown.has(track))).toHaveLength(SSR_TRACKS);
    expect(tags.size).toBe(SSR_TRACKS);
    expect(cut).toBe(true);

    const deep = buildVersionTable(Object.fromEntries(Array.from({ length: SSR_PATCHES + 2 }, (_, i) => [`mr1_${i}`, live(A)])), "active");
    expect(prerender(deep).cut).toBe(true);
    expect(prerender(buildVersionTable({ mr1_1: live(A), mr1_2: live(A) }, "active")).cut).toBe(false);
  });

  it("tagTitle marks a pre-release, and both marks compose", () => {
    expect(tagTitle(null, false, true)).toBe("Pre-release: not a stable version — click to copy identifier · right-click for more");
    expect(tagTitle(null, true, true)).toContain("Pre-release: not a stable version · Ephemeral: may be pruned");
  });
});

describe("tagTitle — the gestures a chip names (D-082, D-054)", () => {
  it("D-082: a live tag says click copies the identifier and right-click offers more", () => {
    expect(tagTitle(null)).toBe("Click to copy identifier · right-click for more");
  });

  it("D-054: a withdrawn tag leads with its reason and date", () => {
    expect(tagTitle(YANK)).toBe("Yanked — bad build · 2026-02-03 — click to copy identifier · right-click for more");
  });
});

describe("the prerender bounds are the budget's numbers (D-149)", () => {
  it("D-149: 24 major/minor lines, 12 patch tags and 5 other tags per page are what keeps 300 tags inside 1,100 DOM nodes and 14.2 KB", () => {
    expect([SSR_LINES, SSR_PATCHES, SSR_OTHER]).toEqual([24, 12, 5]);
  });
});
