/**
 * Which modifier this visitor's keyboard actually uses for the command
 * palette. `useCommandPalette.ts` accepts `metaKey || ctrlKey`, so BOTH
 * spellings are live — the header used to advertise `⌘K` unconditionally,
 * which is simply wrong on Linux and Windows.
 *
 * Deliberately not a composable: a pure function is inside the coverage gate,
 * where an SFC's `<script setup>` is not.
 */

/** Written as `⌘` on Apple keyboards, `Ctrl` everywhere else. */
export interface ModifierKey {
  /** What the key cap says. */
  readonly label: string
  /** How the shortcut is spoken in an `aria-label` — `⌘` has no useful
   * pronunciation, and a screen reader either skips it or reads a codepoint
   * name. */
  readonly spoken: string
  /** True for `⌘`, so the caller can give the glyph its own type treatment. */
  readonly glyph: boolean
}

export const CTRL: ModifierKey = { label: 'Ctrl', spoken: 'Ctrl', glyph: false }
export const COMMAND: ModifierKey = { label: '⌘', spoken: 'Command', glyph: true }

/**
 * True on macOS, iPadOS and iOS. Read at call time rather than at module load
 * so a caller can defer it past hydration.
 *
 * `navigator.userAgentData.platform` first (the modern, non-deprecated
 * source), then `navigator.platform`, which is deprecated but still the only
 * thing every current browser reports. Under SSG there is no `navigator` at
 * all — that path returns false, which is why the caller must render the
 * non-Apple spelling server-side and swap after mount.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** The modifier to advertise. Never call before mount — see above. */
export function paletteModifier(): ModifierKey {
  return isApplePlatform() ? COMMAND : CTRL
}
