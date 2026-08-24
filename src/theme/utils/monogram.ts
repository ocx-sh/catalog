// Package-tile monogram — pure, deterministic, SSR/CSR-hydration-safe (a
// function of its string input only: no Date, Math.random, or env reads).
//
// This module carries NO colour. The hue arrays that used to live here were 16
// hardcoded literals applied as inline styles, which a consumer stylesheet
// could only beat with `!important` — so a corporate mirror could never
// rebrand a monogram tile. `monogramHue()` still picks the rotation index; the
// colours are `--ocx-color-monogram-{0..3}` in palette.css, applied by an
// `.mg-<index>` class in MonogramTile.vue / IdentityBlock.vue.


/**
 * Deterministic djb2-style string hash → hue index in `[0, 3]`. Pure
 * function of `key` (pass the bare `<ns>/<pkg>`) — must render identically
 * server- and client-side, so no source of entropy beyond the string itself.
 */
export function monogramHue(key: string): number {
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 4
}

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
