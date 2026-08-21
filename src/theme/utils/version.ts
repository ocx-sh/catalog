/**
 * TypeScript port of the Rust version parsing and ordering logic.
 * Source of truth: crates/ocx_lib/src/package/version.rs
 *
 * Handles OCX's variant-prefix tag format: `{variant}-{version}` where
 * variants match `[a-z][a-z0-9.]*` and versions start with a digit.
 *
 * Drift risk: this port isn't mechanically checked against the Rust source
 * (no shared test-vector fixture, no CI cross-check) — accepted as-is; a
 * future contract test is the upgrade path if the two ever silently diverge.
 */

import type { TagEntry } from '../composables/usePackageRoot'

// --- Types ---

export interface Version {
  variant: string | null
  major: number
  minor: number | null
  patch: number | null
  prerelease: string | null
  build: string | null
}

export type ParsedTag =
  | { kind: 'latest' }
  | { kind: 'version'; version: Version; raw: string }
  | { kind: 'other'; raw: string }

/** A single materialized tag, carrying its CAS digest + optional yank record
 * straight through from the wire (`root.schema.json`'s `tagEntry`/`yanked`
 * defs) — every rendered tag in the table carries these so `TagBadge` can
 * strike yanked rows and `VersionTree` can fire an image-index fetch on
 * hover without a second lookup back into the raw tags map. */
export interface RenderedTag {
  tag: string
  digest: string
  yanked?: { reason: string, at: string }
}

/** One equal-digest alias member in a row's default segmented control
 * (design mock 1c: "equal-digest tags render as one segmented control").
 * Ordered least- to most-specific (rolling → major → minor → patch/build). */
export type AliasMember = RenderedTag

/** A collapsible minor version group. */
export interface MinorGroup {
  /** The minor tag itself (e.g. "3.31") when a real tag observes it —
   * `undefined` digest/yanked when no such tag exists and this header is a
   * synthesized label for its patch children only. */
  minorTag: string
  digest?: string
  yanked?: { reason: string, at: string }
  /** Patch/build tags under this minor, sorted newest-first. Inclusive of
   * any tag that also appears in the row's `aliasChain` — ponytail:
   * deliberate simplification (plan's "Version-table ownership" section),
   * alias-chain members are not excluded here, so a tag can legitimately
   * render twice (segmented control + patch chip). Matches the pre-existing
   * `keyTags`/`majorGroups` duplication this redesign inherits. */
  patches: RenderedTag[]
}

/** A major version group in the expanded view. */
export interface MajorGroup {
  major: number
  /** Rolling major tag (e.g. "3", "slim-3") — `undefined` if not observed. */
  majorTag: string | null
  digest?: string
  yanked?: { reason: string, at: string }
  minorGroups: MinorGroup[]
}

/** A variant row in the version table. */
export interface VariantRow {
  variant: string | null
  label: string               // display label
  isDefault: boolean          // true when variant is null (the default variant)
  /** The row's identity tag for the default segmented control's click-to-copy
   * and for eager image-index prefetch: `latest` when live and status isn't
   * `deprecated`, else the row's own rolling tag (bare variant name) when
   * live, else the highest-precision live version tag. `null` when the row
   * has no live (non-yanked) tag at all. */
  primaryTag: string | null
  /** True only when `primaryTag === 'latest'` — drives the coral "latest"
   * segment highlight. Never true for a `deprecated` package (governance:
   * deprecated rows never select `latest` as primary, even if the tag is
   * still technically present in `tags` — see `buildVersionTable`). */
  showLatestHighlight: boolean
  /** Every live (non-yanked) tag sharing `primaryTag`'s digest, ordered
   * rolling → major → minor → patch/build. Empty when `primaryTag` is
   * `null`. */
  aliasChain: AliasMember[]
  /** The most precise (highest-depth) member of `aliasChain`, excluding
   * `primaryTag` itself — among ties at the same depth, the newest version.
   * `null` unless `primaryTag` is a live `latest` (`showLatestHighlight`).
   * Single owner of the "latest x.y.z" pin label (IdentityBlock's title-row
   * pill, MetaRail's install/metadata cards) — computed here, not
   * re-derived per consumer. */
  preciseAliasTag: string | null
  /** Depth-0 (rolling) tags for this variant that are yanked — excluded
   * from `live`/`aliasChain` (a yanked `latest` never wins primary
   * selection) but yanking must still be visible somewhere: rendered as a
   * struck-through, dashed-amber segment next to the alias-chain control. */
  yankedRolling: RenderedTag[]
  majorGroups: MajorGroup[]   // expanded view: grouped by major version, sorted descending
}

/** Result of building the version table from a package's wire tags map. */
export interface VersionTable {
  rows: VariantRow[]        // one per variant, default first
  unknownTags: RenderedTag[] // tags that don't parse as versions or known rolling names
}

// --- Parsing ---

// Exact port of the Rust regex from Version::parse()
const VERSION_RE =
  /^(([a-z][a-z0-9.]*)-)?(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)(-([0-9a-zA-Z]+))?([_+]([0-9a-zA-Z]+))?)?)?$/

export function parseVersion(tag: string): Version | null {
  const m = VERSION_RE.exec(tag)
  if (!m) return null

  // Group 2: variant name. "latest" is reserved.
  const variantStr = m[2] ?? null
  if (variantStr === 'latest') return null
  const variant = variantStr

  const major = parseInt(m[3], 10)
  const minorStr = m[5]
  if (minorStr === undefined) {
    return { variant, major, minor: null, patch: null, prerelease: null, build: null }
  }
  const minor = parseInt(minorStr, 10)

  const patchStr = m[7]
  if (patchStr === undefined) {
    return { variant, major, minor, patch: null, prerelease: null, build: null }
  }
  const patch = parseInt(patchStr, 10)

  const prerelease = m[9] ?? null
  const build = m[11] ?? null

  return { variant, major, minor, patch, prerelease, build }
}

export function parseTag(tag: string): ParsedTag {
  if (tag === 'latest') return { kind: 'latest' }
  const version = parseVersion(tag)
  if (version) return { kind: 'version', version, raw: tag }
  return { kind: 'other', raw: tag }
}

// --- Ordering ---

/**
 * Mirrors the Rust Ord impl for Version.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareVersions(a: Version, b: Version): number {
  // Variant: None > Some (default variant sorts last)
  if (a.variant === null && b.variant !== null) return 1
  if (a.variant !== null && b.variant === null) return -1
  if (a.variant !== null && b.variant !== null) {
    const cmp = a.variant.localeCompare(b.variant)
    if (cmp !== 0) return cmp
  }

  // Major
  if (a.major !== b.major) return a.major - b.major

  // Minor: null > non-null (rolling sorts greater)
  if (a.minor === null && b.minor !== null) return 1
  if (a.minor !== null && b.minor === null) return -1
  if (a.minor !== null && b.minor !== null && a.minor !== b.minor) return a.minor - b.minor

  // Patch: null > non-null
  if (a.patch === null && b.patch !== null) return 1
  if (a.patch !== null && b.patch === null) return -1
  if (a.patch !== null && b.patch !== null && a.patch !== b.patch) return a.patch - b.patch

  // Prerelease: Some < None
  if (a.prerelease !== null && b.prerelease === null) return -1
  if (a.prerelease === null && b.prerelease !== null) return 1
  if (a.prerelease !== null && b.prerelease !== null) {
    const cmp = a.prerelease.localeCompare(b.prerelease)
    if (cmp !== 0) return cmp
  }

  // Build: Some < None
  if (a.build !== null && b.build === null) return -1
  if (a.build === null && b.build !== null) return 1
  if (a.build !== null && b.build !== null) {
    return a.build.localeCompare(b.build)
  }

  return 0
}

// --- Version depth ---

export function versionDepth(v: Version): number {
  if (v.patch !== null) return v.build !== null || v.prerelease !== null ? 4 : 3
  if (v.minor !== null) return 2
  return 1
}

// --- Table building ---

type Yanked = { reason: string, at: string }

interface ClassifiedEntry {
  tag: string
  variant: string | null
  version: Version | null  // null for "latest" and bare variant names
  depth: number            // 0 for rolling, 1-4 for versioned
  digest: string
  yanked?: Yanked
}

/**
 * Build the version table from a package's wire tags map
 * (`root.schema.json`'s `tags`) plus its governance `status`.
 *
 * Single owner of three things (plan `plan_site_redesign.md`,
 * "Version-table ownership"):
 *
 * 1. **Digest-equality alias chains** — the default row's segmented
 *    control. `primaryTag` is `latest` when live (never for a `deprecated`
 *    package, even if a stray `latest` tag exists — governance: deprecated
 *    packages don't get new `latest` writes, but this guards the display
 *    regardless), else the row's own rolling tag when live, else the
 *    highest-precision live version tag. `aliasChain` is every live tag
 *    sharing that tag's digest.
 * 2. **Major → minor grouping** with inclusive `·N` patch counts — the
 *    existing lexical grouping logic (major/minor tag maps, sorted
 *    descending), extended to carry digest + yank data per tag.
 * 3. **Yank threading** — every `RenderedTag` (alias member, major/minor
 *    header, patch) carries its `yanked` record through untouched from the
 *    wire, so `TagBadge`/`VersionTree` render strike-through without a
 *    second lookup.
 *
 * Tags that don't parse as versions and aren't known rolling names go into
 * `unknownTags`.
 */
export function buildVersionTable(
  tags: Record<string, TagEntry>,
  status: 'active' | 'deprecated' | 'yanked',
): VersionTable {
  const variantEntries = new Map<string | null, ClassifiedEntry[]>()
  const unknownTags: RenderedTag[] = []
  const knownVariants = new Set<string>()
  const tagNames = Object.keys(tags)

  // First pass: collect all variant names from version tags
  for (const tag of tagNames) {
    const parsed = parseTag(tag)
    if (parsed.kind === 'version' && parsed.version.variant !== null) {
      knownVariants.add(parsed.version.variant)
    }
  }

  function pushEntry(variant: string | null, entry: ClassifiedEntry) {
    if (!variantEntries.has(variant)) variantEntries.set(variant, [])
    variantEntries.get(variant)!.push(entry)
  }

  // Second pass: classify each tag
  for (const tag of tagNames) {
    const wire = tags[tag]
    const parsed = parseTag(tag)

    if (parsed.kind === 'latest') {
      pushEntry(null, { tag, variant: null, version: null, depth: 0, digest: wire.content, yanked: wire.yanked })
    } else if (parsed.kind === 'version') {
      const v = parsed.version
      pushEntry(v.variant, { tag, variant: v.variant, version: v, depth: versionDepth(v), digest: wire.content, yanked: wire.yanked })
    } else if (parsed.kind === 'other' && knownVariants.has(parsed.raw)) {
      // Bare variant name (e.g., "slim") — rolling tag for that variant
      pushEntry(parsed.raw, { tag: parsed.raw, variant: parsed.raw, version: null, depth: 0, digest: wire.content, yanked: wire.yanked })
    } else {
      unknownTags.push({ tag: parsed.raw, digest: wire.content, yanked: wire.yanked })
    }
  }

  // Sort variants: default first, then alphabetically
  const sortedVariants = [...variantEntries.keys()].sort((a, b) => {
    if (a === null) return -1
    if (b === null) return 1
    return a.localeCompare(b)
  })

  const rows: VariantRow[] = sortedVariants.map((variant) => {
    const isDefault = variant === null
    const entries = variantEntries.get(variant)!

    // ALL versioned entries (yanked included) — feeds majorGroups, exactly
    // as before the redesign; yanked tags stay visible in their group, only
    // excluded from primary/alias-chain selection below.
    const versioned = entries
      .filter(e => e.version !== null)
      .sort((a, b) => compareVersions(b.version!, a.version!))

    // Live (non-yanked) entries only — feeds primary tag + alias chain.
    // ponytail: a deprecated package's stray `latest` tag (bot governance
    // says this shouldn't happen post-deprecation, but the schema doesn't
    // forbid it) is dropped from `live` entirely rather than merely
    // ineligible-as-primary — it won't appear in the alias chain even as a
    // passive member. Upgrade path if that gap ever matters: keep it in
    // `live` and only exclude it from primary-tag *selection*.
    const live = entries.filter(e => !e.yanked && !(isDefault && status === 'deprecated' && e.tag === 'latest'))
    const liveRolling = live.filter(e => e.depth === 0)
    const liveVersioned = live
      .filter((e): e is ClassifiedEntry & { version: Version } => e.depth > 0)
      .sort((a, b) => compareVersions(b.version, a.version))

    const liveLatestByDepth = new Map<number, ClassifiedEntry>()
    for (const e of liveVersioned) {
      if (!liveLatestByDepth.has(e.depth)) liveLatestByDepth.set(e.depth, e)
    }

    const primaryEntry: ClassifiedEntry | undefined
      = liveRolling[0]
        ?? liveLatestByDepth.get(4)
        ?? liveLatestByDepth.get(3)
        ?? liveLatestByDepth.get(2)
        ?? liveLatestByDepth.get(1)

    const primaryTag = primaryEntry?.tag ?? null
    const showLatestHighlight = primaryTag === 'latest'

    const aliasChain: AliasMember[] = []
    let preciseAliasTag: string | null = null
    if (primaryEntry) {
      const seen = new Set<string>()
      const members = live
        .filter(e => e.digest === primaryEntry.digest)
        .sort((a, b) => a.depth - b.depth || (a.version && b.version ? compareVersions(b.version, a.version) : 0)) /* v8 ignore next -- unreachable fallback: each variant row holds at most one depth-0 entry (pushEntry), so two same-depth members can never both lack a version */
      for (const m of members) {
        if (seen.has(m.tag)) continue /* v8 ignore next -- unreachable guard: `members` is filtered from `tags: Record<string,TagEntry>`, whose keys are unique by construction, so `.tag` can never repeat here */
        seen.add(m.tag)
        aliasChain.push({ tag: m.tag, digest: m.digest, yanked: m.yanked })
      }

      // Most precise (highest-depth) alias, newest among ties at that
      // depth — `members` is sorted depth-ascending with newest-first
      // within each depth, so the first non-primary entry at the max depth
      // is exactly that (NOT `.at(-1)`, which lands on the oldest entry at
      // the deepest level when multiple tags share a depth — the bug this
      // field replaces).
      if (showLatestHighlight) {
        const nonPrimary = members.filter(m => m.tag !== primaryEntry.tag)
        if (nonPrimary.length) {
          const maxDepth = Math.max(...nonPrimary.map(m => m.depth))
          preciseAliasTag = nonPrimary.find(m => m.depth === maxDepth)!.tag
        }
      }
    }

    // Yanked rolling (depth-0) tags for this row — excluded from `live` so
    // they never win primary/alias-chain selection, but a yanked `latest`
    // (or bare variant rolling tag) still needs to render *somewhere*, or
    // yanking it silently hides exactly what yank exists to surface.
    const yankedRolling: RenderedTag[] = entries
      .filter(e => e.depth === 0 && e.yanked)
      .map(e => ({ tag: e.tag, digest: e.digest, yanked: e.yanked }))

    // Build major groups from ALL versioned tags (existing lexical grouping
    // logic, unchanged shape — extended with digest/yanked per tag).
    const allMajorTags = new Map<number, ClassifiedEntry>()
    const majorMinorMap = new Map<number, Map<string, { minorEntry: ClassifiedEntry | null, minorTagSynth: string, patches: (ClassifiedEntry & { version: Version })[] }>>()

    for (const e of versioned) {
      const v = e.version!

      if (e.depth === 1) {
        // Major rolling tag (e.g., "3", "slim-3")
        if (!allMajorTags.has(v.major)) {
          allMajorTags.set(v.major, e)
        }
      } else if (e.depth >= 2) {
        if (!majorMinorMap.has(v.major)) majorMinorMap.set(v.major, new Map())
        const minorMap = majorMinorMap.get(v.major)!
        const mk = `${v.major}.${v.minor}`

        if (e.depth === 2) {
          const existing = minorMap.get(mk)
          if (!existing) {
            minorMap.set(mk, { minorEntry: e, minorTagSynth: e.tag, patches: [] })
          } else { /* v8 ignore next -- unreachable: VERSION_RE yields exactly one literal string per (major, minor, patch=null) triple and tag keys are unique, so a depth-2 entry can never be the second insert for its own key */
            existing.minorEntry = e /* v8 ignore next -- unreachable (see else-branch note) */
          } /* v8 ignore next -- unreachable (see else-branch note) */
        } else {
          if (!minorMap.has(mk)) {
            const prefix = v.variant ? `${v.variant}-` : ''
            minorMap.set(mk, { minorEntry: null, minorTagSynth: `${prefix}${v.major}.${v.minor}`, patches: [] })
          }
          minorMap.get(mk)!.patches.push(e as ClassifiedEntry & { version: Version })
        }
      }
    }

    // Collect all majors
    const allMajors = new Set<number>([
      ...allMajorTags.keys(),
      ...majorMinorMap.keys(),
    ])

    // Build major groups, sorted descending
    const majorGroups: MajorGroup[] = [...allMajors]
      .sort((a, b) => b - a)
      .map((major) => {
        const majorEntry = allMajorTags.get(major) ?? null
        const minorMap = majorMinorMap.get(major)

        let minorGroups: MinorGroup[] = []
        if (minorMap) {
          const sorted = [...minorMap.entries()].sort((a, b) => {
            const aMin = parseInt(a[0].split('.')[1], 10)
            const bMin = parseInt(b[0].split('.')[1], 10)
            return bMin - aMin
          })
          minorGroups = sorted.map(([, { minorEntry, minorTagSynth, patches }]) => {
            patches.sort((a, b) => compareVersions(b.version, a.version))
            return {
              minorTag: minorEntry?.tag ?? minorTagSynth,
              digest: minorEntry?.digest,
              yanked: minorEntry?.yanked,
              patches: patches.map(p => ({ tag: p.tag, digest: p.digest, yanked: p.yanked })),
            }
          })
        }

        return {
          major,
          majorTag: majorEntry?.tag ?? null,
          digest: majorEntry?.digest,
          yanked: majorEntry?.yanked,
          minorGroups,
        }
      })

    return {
      variant,
      label: variant ?? 'default',
      isDefault,
      primaryTag,
      showLatestHighlight,
      aliasChain,
      preciseAliasTag,
      yankedRolling,
      majorGroups,
    }
  })

  return { rows, unknownTags }
}

// --- Yank visibility (VersionTree's collapsed-state warning affordance) ---
//
// `buildVersionTable` above already threads `yanked` onto every
// `RenderedTag` it produces (single owner, per its own docblock) — these two
// pure functions are the single owner of *aggregating* that threaded data
// into "does this collapsed group hide a yanked release", so VersionTree.vue
// stays a pure renderer (never re-derives domain logic itself, per its own
// docblock) and the aggregation is unit-testable here instead of only
// reachable via a mounted-component/DOM test.

/** True when `minor`'s own tag or any of its nested patches is yanked. */
export function minorGroupHasYanked(minor: MinorGroup): boolean {
  return !!minor.yanked || minor.patches.some(p => !!p.yanked)
}

/**
 * True when `row`'s collapsed major/minor breakdown contains a yanked entry
 * — drives the row's expand-toggle warning affordance. Deliberately excludes
 * `row.yankedRolling` (already rendered unconditionally next to the alias
 * chain, never hidden behind the collapse), so this only flags yank state a
 * user can't already see without expanding.
 */
export function rowHasHiddenYanked(row: VariantRow): boolean {
  return row.majorGroups.some(mg => !!mg.yanked || mg.minorGroups.some(minorGroupHasYanked))
}
