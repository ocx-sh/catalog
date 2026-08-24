// Package-tile monogram — pure, deterministic, SSR/CSR-hydration-safe (a
// function of its string input only: no Date, Math.random, or env reads).

/** Hue arrays verbatim from the design mock's x-dc data script (LT/LB/DT/DB) —
 * the same palette `PackageCard`/`MonogramTile` (WP-C) and `IdentityBlock`
 * (WP-D) tiles render from. Indexed 0-3 by `monogramHue()`.
 *
 * WP6 (theme a11y pass, 2026-08-22): `light.text[1]` darkened from the mock's
 * verbatim `#0e9f6e` to `#0a7652` — text-on-its-own-10%-tint-background was
 * 3.01:1 (PackageCard, tint over --ocx-color-surface) / 2.83:1 (IdentityBlock, tint
 * over --ocx-color-bg), both below WCAG AA's 4.5:1 for small text. `#0a7652` clears
 * both (4.89:1 / 4.57:1, relative-luminance formula) and matches
 * `palette.css`'s own `--ocx-color-success` token, which needed the identical fix for the
 * same reason (`--ocx-color-success` and this hue were the same verbatim green). `dark`
 * is untouched — `#3edea6` already clears 7.9:1+ on its own tint background
 * in both callers. */
export const MONOGRAM_HUES = {
  light: {
    text: ['#d84a34', '#0a7652', '#6f5bd0', '#9a6b13'],
    bg: ['rgba(255,96,71,.10)', 'rgba(14,159,110,.10)', 'rgba(111,91,208,.10)', 'rgba(250,184,51,.16)'],
  },
  dark: {
    text: ['#ff8570', '#3edea6', '#c0b3ff', '#fab833'],
    bg: ['rgba(255,96,71,.14)', 'rgba(62,222,166,.12)', 'rgba(192,179,255,.12)', 'rgba(250,184,51,.12)'],
  },
} as const

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
