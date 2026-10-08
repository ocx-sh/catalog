import { INLINE_SCRIPT_HASHES } from "@ocx-sh/theme/csp";

/**
 * The `script-src` SHA-256 sources for the inline scripts the theme's `Shell`
 * emits (C-043). Astro's `security.csp` hashes only its own bundled scripts, not
 * `is:inline` ones, so these come from the theme: it derives them from the very
 * constants the chrome renders, so they cannot drift. Never derive them from the
 * scripts found in our own output, that would allow-list whatever appears there.
 */
export function cspHashes(): string[] {
  return [...INLINE_SCRIPT_HASHES];
}
