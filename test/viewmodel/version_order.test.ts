/**
 * Unit spec for `version_order.ts`'s public surface
 * (`isBuildPinnedVersion`/`variantNames`/`findLatestVersion`) — mirrors the
 * bot's own `bot/tests/core/test_version_order.py` and
 * `bot/tests/core/test_variant_names.py` case-for-case (Python test name
 * cited per case), plus companion assertions for the 9th golden fixture's
 * four tags (`test/golden/prerelease_build_tags/input.ts`).
 *
 * `parseVersion` is module-private and untested directly — its behavior is
 * observed only through these three exported functions, per its own doc
 * comment.
 */
import { describe, expect, it } from "vitest";
import {
  findLatestVersion,
  isBuildPinnedVersion,
  variantNames,
} from "../../src/viewmodel/version_order.js";
import type { TagEntry, Yank } from "../../src/viewmodel/types.js";

function tag(content: string, yanked: Yank | null = null): TagEntry {
  return { content, observed: "2026-07-17T00:00:00Z", yanked };
}

describe("isBuildPinnedVersion", () => {
  // Mirrors test_is_build_pinned_version_true_for_build_tagged_release (bot/tests/core/test_version_order.py)
  it("is true for a build-tagged release", () => {
    expect(isBuildPinnedVersion("3.28.1_20260216120000")).toBe(true);
  });

  // Mirrors test_is_build_pinned_version_true_for_variant_prefixed_build_tag
  it("is true for a variant-prefixed build tag", () => {
    expect(isBuildPinnedVersion("slim-3.12.13_20260728")).toBe(true);
  });

  // Mirrors test_is_build_pinned_version_true_for_prerelease_with_build
  it("is true for a prerelease tag that also carries a build fragment", () => {
    expect(isBuildPinnedVersion("1.0.0-rc1_20260728")).toBe(true);
  });

  // Mirrors test_is_build_pinned_version_true_for_plus_separator
  it("is true when the build fragment uses a + separator", () => {
    expect(isBuildPinnedVersion("3.28.1+20260216120000")).toBe(true);
  });

  // Mirrors test_is_build_pinned_version_false_for_rolling_patch
  it("is false for the rolling patch a build tag would cascade from", () => {
    expect(isBuildPinnedVersion("3.28.1")).toBe(false);
  });

  // Mirrors test_is_build_pinned_version_false_for_rolling_ancestors_and_latest
  it.each(["latest", "3", "3.28", "slim", "slim-3.12.13", "1.0.0-rc1"])(
    "is false for rolling ancestor/opaque tag %s",
    (candidate) => {
      expect(isBuildPinnedVersion(candidate)).toBe(false);
    },
  );

  // Mirrors test_is_build_pinned_version_false_for_non_version_shape
  it("is false for tags that are not a version shape at all", () => {
    expect(isBuildPinnedVersion("v3.28.1_20260728")).toBe(false);
    expect(isBuildPinnedVersion("nightly_20260728")).toBe(false);
  });

  // Mirrors test_is_build_pinned_version_false_for_latest_prefix
  it("is false for a latest- prefix — reserved, refused as a variant prefix", () => {
    expect(isBuildPinnedVersion("latest-3.28.1_20260728")).toBe(false);
  });

  // Mirrors test_is_build_pinned_version_false_for_trailing_newline
  it("is false for a tag with a trailing newline (fullmatch discipline, not match)", () => {
    expect(isBuildPinnedVersion("3.28.1_20260216120000\n")).toBe(false);
  });
});

describe("variantNames", () => {
  // Mirrors test_no_variant_prefixed_tag_yields_no_variants (bot/tests/core/test_variant_names.py)
  it("yields no variants when no tag carries a prefix", () => {
    expect(variantNames(["latest", "3", "3.28", "3.28.1"])).toEqual([]);
  });

  // Mirrors test_a_variant_prefixed_tag_yields_its_prefix
  it("yields a prefix for a variant-prefixed tag", () => {
    expect(variantNames(["3.28.1", "slim-3.28.1"])).toEqual(["slim"]);
  });

  // Mirrors test_variants_are_sorted_and_deduplicated
  it("sorts and deduplicates variant names", () => {
    expect(variantNames(["musl-3", "slim-3.28", "musl-3.28.1", "slim-3", "3.28.1"])).toEqual([
      "musl",
      "slim",
    ]);
  });

  // Mirrors test_latest_is_reserved_and_never_a_variant
  it("never treats a latest- prefix as a variant", () => {
    expect(variantNames(["latest-3.28.1"])).toEqual([]);
  });

  // Mirrors test_a_bare_variant_rolling_tag_alone_is_not_a_variant
  it("does not infer a variant from a bare rolling tag alone", () => {
    expect(variantNames(["slim", "latest"])).toEqual([]);
    expect(variantNames(["slim", "slim-3.28.1"])).toEqual(["slim"]);
  });

  // Mirrors test_prerelease_and_build_suffixes_still_carry_their_variant
  it("still carries the variant through prerelease/build suffixes", () => {
    expect(variantNames(["slim-3.28.1-rc1"])).toEqual(["slim"]);
    expect(variantNames(["slim-3.28.1_20260101"])).toEqual(["slim"]);
    expect(variantNames(["slim-3.28.1+20260101"])).toEqual(["slim"]);
  });

  // Mirrors test_a_dotted_variant_name_is_one_variant
  it("treats a dotted variant name as a single variant", () => {
    expect(variantNames(["pgo.lto-3.28.1"])).toEqual(["pgo.lto"]);
  });

  // Mirrors test_non_version_tags_contribute_nothing
  it("contributes nothing from tags that are not versions at all", () => {
    expect(variantNames(["__ocx.desc", "v3.28.1", "nightly", "SLIM-3.28.1"])).toEqual([]);
  });

  // Mirrors test_a_leading_zero_component_is_not_a_version
  it("rejects a leading-zero version component, so no variant is derived", () => {
    expect(variantNames(["slim-01.2.3"])).toEqual([]);
  });
});

describe("findLatestVersion", () => {
  // Mirrors test_find_latest_version_picks_highest_semver
  it("picks the highest semver", () => {
    const tags = {
      "3.28.1": tag("sha256:aaaa"),
      "3.29.0": tag("sha256:bbbb"),
      "3.9.0": tag("sha256:cccc"),
    };
    expect(findLatestVersion(tags)).toBe("3.29.0");
  });

  // Mirrors test_find_latest_version_skips_latest_tag
  it("skips the latest tag", () => {
    const tags = { latest: tag("sha256:aaaa"), "1.0.0": tag("sha256:bbbb") };
    expect(findLatestVersion(tags)).toBe("1.0.0");
  });

  // Mirrors test_find_latest_version_skips_variant_prefixed_tags
  it("skips variant-prefixed tags", () => {
    const tags = { "1.0.0": tag("sha256:aaaa"), "musl-9.9.9": tag("sha256:bbbb") };
    expect(findLatestVersion(tags)).toBe("1.0.0");
  });

  // Mirrors test_find_latest_version_skips_yanked_tags
  it("skips yanked tags", () => {
    const tags = {
      "1.0.0": tag("sha256:aaaa"),
      "2.0.0": tag("sha256:bbbb", { reason: "cve", at: "2026-07-17T00:00:00Z" }),
    };
    expect(findLatestVersion(tags)).toBe("1.0.0");
  });

  // Mirrors test_find_latest_version_skips_non_version_tags
  it("skips non-version tags", () => {
    const tags = { nightly: tag("sha256:aaaa"), "1.0.0": tag("sha256:bbbb") };
    expect(findLatestVersion(tags)).toBe("1.0.0");
  });

  // Mirrors test_find_latest_version_partial_versions_compare_by_present_components
  it("compares partial versions by present components only, not zero-padded", () => {
    // "3.28" -> (3, 28); "3.9.1" -> (3, 9, 1). Tuple comparison: (3, 28) > (3, 9, 1).
    const tags = { "3.28": tag("sha256:aaaa"), "3.9.1": tag("sha256:bbbb") };
    expect(findLatestVersion(tags)).toBe("3.28");
  });

  // Mirrors test_find_latest_version_returns_none_when_no_eligible_tag
  it("returns null when no tag is eligible", () => {
    const tags = { latest: tag("sha256:aaaa"), nightly: tag("sha256:bbbb") };
    expect(findLatestVersion(tags)).toBeNull();
  });

  // Mirrors test_find_latest_version_returns_none_for_empty_tags
  it("returns null for an empty tag map", () => {
    expect(findLatestVersion({})).toBeNull();
  });

  // Mirrors test_find_latest_version_ignores_trailing_newline_tag_name
  it("ignores a tag name with a trailing newline (fullmatch discipline, not match)", () => {
    expect(findLatestVersion({ "1.0.0\n": tag("sha256:aaaa") })).toBeNull();
  });
});

describe("9th golden fixture (test/golden/prerelease_build_tags) companion coverage", () => {
  // Same four tags as test/golden/prerelease_build_tags/input.ts, one per
  // version-grammar-discriminating branch (see that file's doc comment).
  const tags = {
    "1.0.0": tag("sha256:" + "1".repeat(64)),
    "1.1.0-rc1": tag("sha256:" + "2".repeat(64)),
    "1.1.0-rc1_20260101": tag("sha256:" + "3".repeat(64)),
    "slim-1.1.0-rc1_20260216": tag("sha256:" + "4".repeat(64)),
  };

  it("1.0.0 wins latestVersion — the only tag VERSION_RE accepts", () => {
    expect(findLatestVersion(tags)).toBe("1.0.0");
  });

  it("1.1.0-rc1 is excluded from latestVersion and is not build-pinned", () => {
    expect(isBuildPinnedVersion("1.1.0-rc1")).toBe(false);
    expect(findLatestVersion({ "1.1.0-rc1": tags["1.1.0-rc1"] })).toBeNull();
  });

  it("1.1.0-rc1_20260101 is excluded from latestVersion and IS build-pinned", () => {
    expect(isBuildPinnedVersion("1.1.0-rc1_20260101")).toBe(true);
    expect(findLatestVersion({ "1.1.0-rc1_20260101": tags["1.1.0-rc1_20260101"] })).toBeNull();
  });

  it("slim-1.1.0-rc1_20260216 contributes the slim variant, is build-pinned, and is excluded from latestVersion", () => {
    expect(variantNames(Object.keys(tags))).toEqual(["slim"]);
    expect(isBuildPinnedVersion("slim-1.1.0-rc1_20260216")).toBe(true);
    expect(
      findLatestVersion({ "slim-1.1.0-rc1_20260216": tags["slim-1.1.0-rc1_20260216"] }),
    ).toBeNull();
  });
});
