import { parseTag } from './version.js'

/**
 * Granularity of one alias-chain member, derived from the tag itself: depth 0
 * is `latest` (default variant) or the bare variant name (`rolling`); then
 * major ("3"), minor ("3.31"), patch ("3.31.7"), and a build/prerelease-
 * qualified tag is the fully `pinned` one.
 */
export type PinLevel = 'latest' | 'rolling' | 'major' | 'minor' | 'patch' | 'pinned'

/** Depth of each level. `latest` and `rolling` share rank 0: both mean "track
 * the newest", so a preference for one lands on the other. */
export const PIN_LEVEL_RANK: Record<PinLevel, number> = { latest: 0, rolling: 0, major: 1, minor: 2, patch: 3, pinned: 4 }

export function depthLevel(tag: string): PinLevel {
  const parsed = parseTag(tag)
  if (parsed.kind === 'latest') return 'latest'
  if (parsed.kind === 'other') return 'rolling'
  const v = parsed.version
  if (v.minor === null) return 'major'
  if (v.patch === null) return 'minor'
  if (v.prerelease === null && v.build === null) return 'patch'
  return 'pinned'
}

export interface VersionOption {
  tag: string
  /** Real depth rank — preference matching works on this. */
  rank: number
  /** Displayed label — the deepest option always reads "pinned". */
  label: PinLevel
}

/**
 * One option per alias-chain member. The DEEPEST member always displays as
 * "pinned" regardless of its depth (owner spec: only when a build tag exists
 * too does the plain patch tag show as "patch" — no duplicate "pinned"
 * labels). On a rank tie the later member is the deeper one.
 */
export function buildVersionOptions(aliasChain: readonly { tag: string }[]): VersionOption[] {
  const opts = aliasChain.map((member) => {
    const level = depthLevel(member.tag)
    return { tag: member.tag, rank: PIN_LEVEL_RANK[level], label: level }
  })
  if (opts.length) {
    const deepest = opts.reduce((a, b) => (b.rank >= a.rank ? b : a))
    deepest.label = 'pinned'
  }
  return opts
}

/**
 * The option that best fits a stored granularity preference (a LEVEL, not a
 * tag — tags are package-specific): nearest by depth rank, ties resolved
 * toward the deeper option (a "pinned" preference on a chain ending at patch
 * still lands on that deepest tag; a "patch" preference with no patch tag
 * prefers the pinned build over the looser minor). `null` for an empty chain.
 */
export function pickVersionOption(opts: readonly VersionOption[], preference: PinLevel): VersionOption | null {
  const target = PIN_LEVEL_RANK[preference]
  return [...opts].sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target) || b.rank - a.rank)[0] ?? null
}
