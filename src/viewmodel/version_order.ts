/**
 * Version-tag ordering — TS port surface of the index bot's
 * `core/version_order.py` (indexbot, Python, `ocx-sh/index`). See that
 * module for the canonical prose; this file restates its two regexes
 * verbatim (syntax translated only where JS `RegExp` diverges from Python
 * `re`) and mirrors its three public functions 1:1.
 *
 * Python -> TS name mapping:
 *   - `is_build_pinned_version`   -> `isBuildPinnedVersion`
 *   - `variant_names`             -> `variantNames`
 *   - `find_latest_version`       -> `findLatestVersion`
 *   - `_parse_version` (private)  -> `parseVersion` (module-private, not exported)
 *
 * Regex-translation deltas (both patterns below):
 *   - Python's `re.fullmatch(pattern, s)` has no direct JS equivalent
 *     method; both patterns already anchor with `^...$`, so
 *     `pattern.exec(s)` on an anchored, non-multiline pattern (neither
 *     carries the `m` flag here) is the JS equivalent — `$` matches only at
 *     the very end of input, same effective behavior as `fullmatch` for
 *     these grammars. (Python's bare `$` additionally matches just before a
 *     single trailing `\n`, which `fullmatch` itself does not accept as a
 *     full match since the `\n` is then left unconsumed — so this is not
 *     actually a behavioral delta, just a documented non-issue.)
 *   - No other syntax delta: every construct used (character classes,
 *     groups, alternation, quantifiers) is already valid, unchanged, JS
 *     `RegExp` syntax.
 *
 * DELIBERATE PORT — DO NOT MERGE OR REPLACE:
 * This module and `site/.vitepress/theme/utils/version.ts` (the catalog
 * theme's own version-display helper, in the `ocx-sh/index` repo) parse two
 * DIFFERENT grammars on purpose. `VERSION_RE` below (ported from the bot's
 * `_VERSION_RE`) stops at bare `major[.minor[.patch]]` — it predates
 * prerelease/build support. `OCX_VERSION_RE` (ported from the bot's
 * `_OCX_VERSION_RE`) parses the full grammar, prerelease and build segments
 * included. Reusing the theme's parser here (or vice versa) would silently
 * corrupt `latestVersion` — see the Python module's docstring for the full
 * rationale.
 */

import type { TagEntry } from "./types.js";

/**
 * Ported verbatim from Python `_VERSION_RE` (`core/version_order.py:21-23`).
 * Stops at bare `major[.minor[.patch]]` — no prerelease/build support. Sole
 * caller: `findLatestVersion`, which compares the parsed int tuple.
 */
const VERSION_RE =
  /^(?:([a-z][a-z0-9.]*)-)?((0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?)?)$/;

/**
 * Ported verbatim from Python `_OCX_VERSION_RE` (`core/version_order.py:25-29`)
 * — the *whole* version grammar, matching `Version::parse` in
 * `crates/ocx_lib/src/package/version.rs` (prerelease + build segments
 * included). Two capture groups, both read by callers: group 1 is the
 * variant prefix (`variantNames`), group 2 is the build fragment
 * (`isBuildPinnedVersion`). `[_+]` mirrors `Version::parse`'s accepted
 * separators even though only `_` is legal in an OCI tag
 * (`schema/root.schema.json`'s `propertyNames` pattern), so the two
 * grammars stay comparable line for line. Sole caller: `parseVersion`.
 */
const OCX_VERSION_RE =
  /^(?:([a-z][a-z0-9.]*)-)?(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)(?:-[0-9a-zA-Z]+)?(?:[_+]([0-9a-zA-Z]+))?)?)?$/;

/**
 * Ported from Python `_parse_version` (`core/version_order.py:50-60`). `tag`
 * as `Version::parse` sees it, or `null` if it is not a version. `latest` is
 * refused as a variant prefix exactly as the Rust parser refuses it, so
 * `latest-3.28.1` is not a version here either — it is an opaque tag that
 * happens to contain digits. Module-private — mirrors Python's
 * leading-underscore convention via omission from this module's exports.
 */
function parseVersion(tag: string): RegExpExecArray | null {
  const match = OCX_VERSION_RE.exec(tag);
  if (match === null || match[1] === "latest") {
    return null;
  }
  return match;
}

/**
 * Ported from Python `is_build_pinned_version` (`core/version_order.py:63-80`).
 * True iff `tag` is a version carrying a build fragment (e.g.
 * `3.28.1_20260216`) — that fragment is what makes a tag immutable. See the
 * Python docstring for the full cascade rationale (`ocx package push`,
 * `crates/ocx_lib/src/package/cascade.rs`). Anything that is not a version
 * at all (`latest`, `nightly`, a bare variant name like `slim`) is `false`.
 *
 * No consumer in this package — the Python original's only caller is the
 * bot's `core/anomaly.py` (cascade-safety governance), out of scope for a
 * catalog renderer; `CatalogEntry`/`CatalogPackageRoot` carry no
 * build-pinned field for this to feed. Kept for 1:1 parity with the ported
 * module (see the file doc's "mirrors its three public functions" note) —
 * not an open gap.
 */
export function isBuildPinnedVersion(tag: string): boolean {
  const match = parseVersion(tag);
  return match !== null && match[2] !== undefined;
}

/**
 * Ported from Python `variant_names` (`core/version_order.py:83-109`). The
 * distinct variant names observed across `tags`, sorted, deduplicated. A tag
 * contributes a variant only when it is a version *and* carries a prefix, so
 * `"latest"`, an unprefixed `"3.28.1"`, and any tag that is not a version at
 * all contribute nothing. A bare rolling tag (`"slim"`) is invisible to this
 * function — inferring "`slim` is a variant because `slim-3.28.1` exists" is
 * a display-layer inference the theme makes in a second pass, not part of
 * the derivation this function performs.
 */
export function variantNames(tags: Iterable<string>): readonly string[] {
  const names = new Set<string>();
  for (const tag of tags) {
    const match = parseVersion(tag);
    if (match !== null && match[1] !== undefined) {
      names.add(match[1]);
    }
  }
  // ASCII-only variant names ([a-z][a-z0-9.]*), so default lexicographic
  // string sort matches Python's `sorted()` codepoint ordering exactly.
  return Array.from(names).sort();
}

/**
 * Ported from Python `find_latest_version` (`core/version_order.py:112-138`).
 * Highest version among tags that are not `"latest"`, unprefixed, and not
 * yanked. Comparison is by the parsed `(major, minor, patch)` int tuple,
 * missing components treated as absent (not zero) for tuple-comparison
 * purposes. `null` if no eligible tag exists.
 */
export function findLatestVersion(tags: Readonly<Record<string, TagEntry>>): string | null {
  let bestTag: string | null = null;
  let bestParts: readonly number[] = [];

  for (const [tag, entry] of Object.entries(tags)) {
    if (tag === "latest") {
      continue;
    }
    if (entry.yanked !== null) {
      continue;
    }
    const match = VERSION_RE.exec(tag);
    if (match === null) {
      continue;
    }
    if (match[1] !== undefined) {
      continue;
    }
    const parts = match[2].split(".").filter((x) => x !== "").map(Number);
    if (tupleGreater(parts, bestParts)) {
      bestParts = parts;
      bestTag = tag;
    }
  }

  return bestTag;
}

/**
 * Lexicographic (element-wise) comparison of two int tuples, ported from
 * Python's native tuple `>` — pairs elements in order; a shorter tuple that
 * is a strict prefix of the longer one compares less (Python's `(3, 28) >
 * (3, 28, 1)` is `False`, `(3, 28, 1) > (3, 28)` is `True`), matching
 * `findLatestVersion`'s "missing components treated as absent, not zero"
 * comparison rule.
 */
function tupleGreater(a: readonly number[], b: readonly number[]): boolean {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return a.length > b.length;
}
