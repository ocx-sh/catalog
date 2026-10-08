// OCX's platform-agnostic platform. On the wire it is an image-index
// descriptor `"platform": {"os":"any","architecture":"any"}` (an OCX
// extension — a package that ships one build for every host), which
// `catalogPlatforms` flattens to the string `any/any`. It is NOT an OS: the
// glyph table, filter chips and table columns all model real operating
// systems, so `any` is peeled off here, once, instead of each surface
// discovering that it is an unknown OS.

export const AGNOSTIC_OS = 'any'

/** The OS half of a `<os>/<arch>` platform string. */
export function osOf(platform: string): string {
  return platform.split('/')[0]!
}

/** True when the package publishes the platform-agnostic platform AT ALL.
 * One build that runs everywhere subsumes any platform-specific build listed
 * beside it, so `any` wins outright rather than being shown next to them.
 * Empty is not agnostic — a package with no platforms says nothing. */
export function isPlatformAgnostic(platforms: readonly string[]): boolean {
  return platforms.some(p => osOf(p) === AGNOSTIC_OS)
}

/** The distinct real operating systems in `platforms`, in first-seen order —
 * none for an agnostic package (see `isPlatformAgnostic`). This is what the
 * table draws slots for. */
export function concreteOses(platforms: readonly string[]): string[] {
  return isPlatformAgnostic(platforms) ? [] : [...new Set(platforms.map(osOf))]
}

/** Canonical display order of the OSes with a glyph: linux, darwin, windows. */
export const OS_ORDER = ['linux', 'darwin', 'windows']

/**
 * The glyphs a card draws, in canonical order: `any` alone for a
 * platform-agnostic package (it subsumes every OS beside it), else the glyphed
 * OSes it ships. An OS with no glyph draws nothing.
 */
export function displayOses(platforms: readonly string[]): string[] {
  return isPlatformAgnostic(platforms) ? [AGNOSTIC_OS] : OS_ORDER.filter(os => platforms.some(p => osOf(p) === os))
}

/** Position of `os` in the canonical order: `any` leads wherever OSes are listed
 * together (it is the widest claim, and `-1` keeps it clear of every real OS's
 * rank), an OS with no glyph sorts after every glyphed one. */
export function osRank(os: string): number {
  if (os === AGNOSTIC_OS) return -1
  const index = OS_ORDER.indexOf(os)
  return index === -1 ? OS_ORDER.length : index
}
