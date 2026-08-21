/**
 * Default action pins the templates render when no committed pin exists to
 * carry forward. Verified against the live tag ref at authoring time
 * (`git ls-remote https://github.com/<action>.git refs/tags/<version>`).
 * GitHub-only — GitLab templates pin by `image:`, not `uses:`, and this
 * module's carry-forward contract (C-007) is scoped to "action pins".
 */
export const DEFAULT_PINS: Readonly<Record<string, string>> = {
  "actions/checkout": "34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020  # v7.0.0",
  "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6  # v2.2.0",
};

/** One `uses: owner/action@ref  # comment` line, list-form dash optional —
 * mirrors `normalize.ts`'s line shape so scraping and drift-normalization
 * agree on what counts as a pin. */
const USES_LINE = /^[ \t]*(?:-[ \t]+)?uses:[ \t]*([^@\s]+)@([^\s#]+)([ \t]*#[^\n]*)?$/gm;

/** Security panel WARN (2026-08-22, W4): a carried-forward ref must be a
 * full 40-hex commit SHA. `USES_LINE`'s `([^\s#]+)` matches ANY ref, `main`
 * included, and `normalize.ts`'s `normalizeForDrift` strips `@ref` before
 * comparing — so the `verify-catalog-ci` job this package generates cannot
 * flag a hand-edit from `@<sha>` to `@main`, and the next `ocx-catalog ci`
 * render would then adopt that mutable ref as the new pin. This package
 * generates the workflows the "SHA-pinned actions" invariant governs, so a
 * mutable ref must never survive a render: it is dropped here, and the
 * template default (a real SHA) is used instead. */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

export interface ScrapedPins {
  /** action name -> the pin (`ref` + verbatim trailing comment, if any) to
   * carry forward — present only for actions with exactly one distinct
   * SHA pin across every discovered file. */
  pins: Map<string, string>;
  /** Action names that appeared with more than one distinct pin across the
   * discovered set — sorted, for a deterministic stderr warning order. */
  conflicts: string[];
  /** Action names whose committed `uses:` ref was not a 40-hex commit SHA
   * (`@main`, `@v4`, a tag) — sorted, same deterministic-warning reason as
   * `conflicts`, but reported separately because the fix is different: a
   * mutable ref is a hand-edit to re-pin, not two files disagreeing. */
  mutableRefs: string[];
}

/**
 * Scrapes every `uses:` pin out of `files`' content (C-007 pin
 * carry-forward). An action pinned identically everywhere it appears is
 * carried forward; an action pinned to more than one distinct value is a
 * conflict, and an action pinned to anything but a 40-hex commit SHA is a
 * mutable ref — in BOTH cases the caller falls back to `DEFAULT_PINS` and
 * warns (see `COMMIT_SHA_RE` for why a mutable ref can never be carried).
 */
export function scrapePins(files: readonly { content: string }[]): ScrapedPins {
  const found = new Map<string, Set<string>>();
  const mutable = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(USES_LINE)) {
      const name = match[1] as string;
      const ref = match[2] as string;
      if (!COMMIT_SHA_RE.test(ref)) {
        mutable.add(name);
        continue;
      }
      const pin = `${ref}${match[3] ?? ""}`;
      const seen = found.get(name);
      if (seen === undefined) {
        found.set(name, new Set([pin]));
      } else {
        seen.add(pin);
      }
    }
  }

  const pins = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [name, values] of found) {
    // An action with BOTH a mutable ref somewhere and a SHA elsewhere is
    // reported as mutable and gets the template default — carrying the SHA
    // forward would silently paper over the hand-edit this exists to surface.
    if (mutable.has(name)) {
      continue;
    }
    if (values.size === 1) {
      pins.set(name, [...values][0] as string);
    } else {
      conflicts.push(name);
    }
  }
  return { pins, conflicts: conflicts.sort(), mutableRefs: [...mutable].sort() };
}
