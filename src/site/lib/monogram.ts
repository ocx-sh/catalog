// Package-tile monogram — pure, deterministic, SSR/CSR-hydration-safe (a
// function of its string input only: no Date, Math.random, or env reads).
//
// This module carries NO colour: a tile's colour is a theme concern
// (`--ocx-color-monogram-*` in `@ocx-sh/theme`), so a consumer stylesheet can
// rebrand it. Only the initials come from here.

/**
 * Up to two display initials for a package's tile, derived from the bare
 * package segment (e.g. `cmake` → `CM`, `shellcheck` → `SH`). Splits on
 * non-alphanumeric separators (`-`, `_`, `.`) and takes the first character
 * of the first two segments; falls back to the package name's own first two
 * characters when there's no separator to split on.
 *
 * ponytail: a heuristic, not a lookup table — the design mock's example
 * tiles (`uv`, `gh`, `hf`, `nv`, …) are designer-hand-picked shorthand, not
 * output of an algorithm; this won't reproduce them letter-for-letter, and
 * doesn't need to.
 */
export function monogramInitials(pkg: string): string {
  const segments = pkg.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (segments.length >= 2) {
    return (segments[0][0] + segments[1][0]).toUpperCase()
  }
  return pkg.slice(0, 2).toUpperCase()
}
