/**
 * Derived-label resolution (C-003/C-002's "Label resolution seam") — the
 * half `loadConfig` explicitly defers, per `config/types.ts`
 * `ResolvedSource`'s doc comment: "Turning a `null` into a derived string,
 * and re-checking `LABEL_CONFLICT` once derived labels are known too, is
 * the source-reading layer's job (downstream of this WP) — this loader
 * validates config SHAPE, not source CONTENT." That downstream job is this
 * file: `resolveLabel` per source, then `checkLabelConflicts` once every
 * source's final label is known.
 */

import type { ResolvedSource } from "../config/types.js";
import { extractPackages, SourceError, type WirePath } from "./types.js";

/**
 * Resolves `resolved`'s FINAL display label:
 * - `resolved.label !== null` (an explicit `label` in config): used
 *   verbatim. `loadConfig` already checked explicit labels pairwise
 *   (`ConfigError` `LABEL_CONFLICT`) — this function does not re-derive
 *   anything for this case, only path-safety-checks the value (see below).
 * - `resolved.label === null`: derived from `files` via `extractPackages`
 *   — collect the distinct first-`/`-segment prefixes of every package
 *   root's `root.name` found in `files`. Exactly one distinct prefix ⇒
 *   that prefix is the label. Zero package roots ⇒
 *   `SourceError("LABEL_DERIVATION_EMPTY", …)` naming the source (an empty
 *   source has nothing to derive an identity from). More than one distinct
 *   prefix ⇒ `SourceError("LABEL_DERIVATION_CONFLICT", …)` naming the
 *   source and every conflicting prefix found (a source's own roots
 *   disagreeing about which index they belong to is a data problem, not
 *   something this function can silently pick a winner for).
 *
 * Both the explicit and the derived result are passed through
 * `assertLabelPathSafe` before being returned — an explicit label is
 * config-authored free text `loadConfig` never shape-checks beyond
 * non-empty, and a derived label is only as trustworthy as whatever a
 * source's own `root.name` values contain (this repo's schema makes that
 * always literally `"ocx.sh"` today, but a forked schema — a corporate
 * mirror's own deployment — is not this module's to trust).
 */
export function resolveLabel(resolved: ResolvedSource, files: ReadonlyMap<WirePath, Uint8Array>): string {
  if (resolved.label !== null) {
    assertLabelPathSafe(resolved.label, "explicit label");
    return resolved.label;
  }

  const prefixes = new Set(extractPackages(files).map((pkg) => pkg.root.name.split("/")[0]!));

  if (prefixes.size === 0) {
    throw new SourceError("LABEL_DERIVATION_EMPTY", "source declares no label and has zero package roots to derive one from");
  }
  if (prefixes.size > 1) {
    throw new SourceError(
      "LABEL_DERIVATION_CONFLICT",
      `source's package roots disagree on their first name segment: ${[...prefixes].join(", ")}`,
    );
  }

  const derived = [...prefixes][0]!;
  assertLabelPathSafe(derived, "derived label");
  return derived;
}

/**
 * Re-checks label uniqueness across ALL resolved sources, in `sources[]`
 * order. Explicit labels were already checked pairwise by `loadConfig`
 * (`config/errors.ts` `ConfigError`'s `LABEL_CONFLICT`), but that check
 * only ever compares two EXPLICIT labels — it cannot see a derived one,
 * since deriving one needs fetched source data `loadConfig` never touches.
 * This function is that deferred second pass, run after every source's
 * `resolveLabel` result (explicit or derived) is known.
 *
 * Throws `SourceError("LABEL_CONFLICT", …)` naming both conflicting
 * indices the moment two sources — of ANY mix of explicit/derived origin —
 * share one final label. Deliberately reuses the "LABEL_CONFLICT" code
 * NAME `config/errors.ts` already established for the same real-world
 * mistake ("two sources want the same identity"), but as THIS module's own
 * `SourceError` rather than importing `ConfigError` — `ConfigError`'s code
 * union is documented as scoped to `loadConfig` only (see that file's own
 * doc comment), and this check runs strictly later, with strictly more
 * information, outside `loadConfig` entirely.
 */
export function checkLabelConflicts(labels: readonly string[]): void {
  const seenAt = new Map<string, number>();
  labels.forEach((label, index) => {
    const firstIndex = seenAt.get(label);
    if (firstIndex !== undefined) {
      throw new SourceError(
        "LABEL_CONFLICT",
        `sources[${firstIndex}] and sources[${index}] both resolve to label "${label}"`,
      );
    }
    seenAt.set(label, index);
  });
}

// Allowlist, not a blocklist: a derived label comes straight from a
// hostile source's own `root.name` (`resolveLabel` splits it on "/") — a
// blocklist naming only `/`, `\`, `.`, `..` (the pre-panel version) still
// let every control character through. Security panel BLOCK (2026-08-22):
// `name: "abc\n  Access-Control-Allow-Origin: *"` derives a label that
// injects a real header LINE into the shared `_headers` (`mirror.ts`
// writes one file covering every source); an explicit label carrying
// `\n\n` injects a whole new BLOCK for an unrelated path pattern. Every
// legitimate label (an explicit config value, or a derived `name` prefix)
// is printable ASCII with no path/header-structural characters — this
// allowlist is exactly that shape, nothing narrower.
const SAFE_LABEL_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validates that `label` is safe to use as exactly ONE filesystem path
 * segment under `dist/index/<label>/` (`mirror.ts`) AND as one line of the
 * shared `_headers` file — non-empty, no path separators, no control
 * characters (that includes `\n`/`\r`, which `_headers` — a line-oriented
 * format — would otherwise let a label inject as new lines/blocks into),
 * and not `.` or `..` (which collide with "current/parent directory" on
 * every filesystem `mirror.ts` writes to). Applies to both `resolveLabel`
 * branches — see that function's doc comment for why neither an explicit
 * nor a derived label can be trusted without this check.
 *
 * Throws `SourceError("LABEL_PATH_UNSAFE", …)` naming `label` and
 * `context` (which source, and whether the label was explicit or derived)
 * on failure.
 */
function assertLabelPathSafe(label: string, context: string): void {
  const unsafe = label === "." || label === ".." || !SAFE_LABEL_RE.test(label);
  if (unsafe) {
    throw new SourceError(
      "LABEL_PATH_UNSAFE",
      `label ${JSON.stringify(label)} (${context}) is not safe as one path segment`,
    );
  }
}
