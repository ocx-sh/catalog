import { describe, expect, test } from 'vitest'
import { buildVersionTable, compareVersions, minorGroupHasYanked, parseVersion, rowHasHiddenYanked } from '../../../src/theme/utils/version.js'
import type { Version } from '../../../src/theme/utils/version.js'

// Micro-suite for buildVersionTable's redesigned ownership: alias chains,
// yank threading, deprecated behavior.
//
// WP-03 addendum (characterization of lifted behavior): the `parseVersion`/
// `compareVersions` blocks below and the extra `buildVersionTable` cases
// near the end of the first describe are NEW, added to close a coverage gap
// the ported bun:test suite didn't need to close (no coverage gate in the
// source repo). They assert what this byte-verbatim-lifted code actually
// does today, derived by reading it and running it — not a judgment on
// whether that behavior is correct. Three provably-unreachable defensive
// branches found this way are documented inline in version.ts (the
// `v8 ignore` comments at the alias-chain dedup, the sort's `: 0`
// fallback, and the minor-insert else-branch), not fixed here.

describe('parseVersion', () => {
  test('a variant prefix literally named "latest" is rejected (reserved, like the bare "latest" tag)', () => {
    expect(parseVersion('latest-1.2.3')).toBeNull()
  })
})

describe('compareVersions', () => {
  function v(overrides: Partial<Version>): Version {
    return { variant: null, major: 1, minor: 1, patch: 1, prerelease: null, build: null, ...overrides }
  }

  test('variant: null sorts after (greater than) a non-null variant', () => {
    expect(compareVersions(v({ variant: null }), v({ variant: 'alpine' }))).toBe(1)
    expect(compareVersions(v({ variant: 'alpine' }), v({ variant: null }))).toBe(-1)
  })

  test('variant: two different non-null variants compare lexically', () => {
    expect(compareVersions(v({ variant: 'alpine' }), v({ variant: 'slim' }))).toBeLessThan(0)
  })

  test('minor: null sorts after (greater than) a non-null minor, given equal major', () => {
    expect(compareVersions(v({ minor: null }), v({ minor: 5 }))).toBe(1)
    expect(compareVersions(v({ minor: 5 }), v({ minor: null }))).toBe(-1)
  })

  test('minor: two different non-null minors compare numerically, given equal major', () => {
    expect(compareVersions(v({ minor: 5 }), v({ minor: 3 }))).toBe(2)
  })

  test('patch: null sorts after (greater than) a non-null patch, given equal major.minor', () => {
    expect(compareVersions(v({ patch: null }), v({ patch: 5 }))).toBe(1)
    expect(compareVersions(v({ patch: 5 }), v({ patch: null }))).toBe(-1)
  })

  test('patch: two different non-null patches compare numerically, given equal major.minor', () => {
    expect(compareVersions(v({ patch: 5 }), v({ patch: 3 }))).toBe(2)
  })

  test('prerelease: a present prerelease sorts BEFORE (lesser than) no prerelease', () => {
    expect(compareVersions(v({ prerelease: 'rc1' }), v({ prerelease: null }))).toBe(-1)
    expect(compareVersions(v({ prerelease: null }), v({ prerelease: 'rc1' }))).toBe(1)
  })

  test('prerelease: two different non-null prereleases compare lexically', () => {
    expect(compareVersions(v({ prerelease: 'rc1' }), v({ prerelease: 'rc2' }))).toBeLessThan(0)
  })

  test('build: a present build sorts BEFORE (lesser than) no build', () => {
    expect(compareVersions(v({ build: 'abc' }), v({ build: null }))).toBe(-1)
    expect(compareVersions(v({ build: null }), v({ build: 'abc' }))).toBe(1)
  })

  test('build: two different non-null builds compare lexically', () => {
    expect(compareVersions(v({ build: 'aaa' }), v({ build: 'bbb' }))).toBeLessThan(0)
  })

  test('two identical versions (every field equal) compare as equal', () => {
    expect(compareVersions(v({}), v({}))).toBe(0)
  })
})

describe('buildVersionTable', () => {
  test('alias chain: latest + major + minor + patch sharing one digest', () => {
    const table = buildVersionTable(
      {
        latest: { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
        3: { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
        '3.31': { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
        '3.31.7': { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
        '3.31.6': { content: 'sha256:bbb', observed: '2025-12-01T00:00:00Z' },
      },
      'active',
    )

    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('latest')
    expect(row.showLatestHighlight).toBe(true)
    expect(row.aliasChain.map(m => m.tag)).toEqual(['latest', '3', '3.31', '3.31.7'])
    expect(row.aliasChain.every(m => m.digest === 'sha256:aaa')).toBe(true)
    expect(row.preciseAliasTag).toBe('3.31.7')

    // 3.31.6 is a different digest — grouped, not part of the chain.
    const major = row.majorGroups.find(mg => mg.major === 3)!
    const minor = major.minorGroups.find(m => m.minorTag === '3.31')!
    expect(minor.patches.map(p => p.tag)).toEqual(['3.31.7', '3.31.6'])
  })

  test('preciseAliasTag: same-depth multi-alias picks the newest, not the last-sorted', () => {
    // latest + 2.0.0 + 1.0.0 all share one digest — both versions are depth
    // 3 (equal precision). The "latest x.y.z" pin must read 2.0.0 (newest),
    // not 1.0.0 (what a naive `.at(-1)` over the depth-then-newest-first
    // sorted alias chain would wrongly pick).
    const table = buildVersionTable(
      {
        latest: { content: 'sha256:eee', observed: '2026-01-01T00:00:00Z' },
        '2.0.0': { content: 'sha256:eee', observed: '2026-01-01T00:00:00Z' },
        '1.0.0': { content: 'sha256:eee', observed: '2025-01-01T00:00:00Z' },
      },
      'active',
    )

    const row = table.rows.find(r => r.isDefault)!
    expect(row.aliasChain.map(m => m.tag)).toEqual(['latest', '2.0.0', '1.0.0'])
    expect(row.preciseAliasTag).toBe('2.0.0')
  })

  test('yanked rolling tag: yanked "latest" surfaces in yankedRolling, absent from the chain', () => {
    const table = buildVersionTable(
      {
        latest: {
          content: 'sha256:fff',
          observed: '2026-01-01T00:00:00Z',
          yanked: { reason: 'bad rolling pointer', at: '2026-01-02T00:00:00Z' },
        },
        '1.2.3': { content: 'sha256:aba', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )

    const row = table.rows.find(r => r.isDefault)!
    expect(row.yankedRolling).toEqual([{ tag: 'latest', digest: 'sha256:fff', yanked: { reason: 'bad rolling pointer', at: '2026-01-02T00:00:00Z' } }])
    expect(row.aliasChain.map(m => m.tag)).not.toContain('latest')
    expect(row.primaryTag).toBe('1.2.3')
  })

  test('yank threading: yanked patch is struck and carries its reason inline', () => {
    const table = buildVersionTable(
      {
        '3.30.2': {
          content: 'sha256:ccc',
          observed: '2026-05-14T00:00:00Z',
          yanked: { reason: 'upstream artifact checksum mismatch', at: '2026-05-14T00:00:00Z' },
        },
        '3.30.1': { content: 'sha256:ddd', observed: '2026-05-01T00:00:00Z' },
      },
      'active',
    )

    const row = table.rows.find(r => r.isDefault)!
    const minor = row.majorGroups[0].minorGroups[0]
    const yankedPatch = minor.patches.find(p => p.tag === '3.30.2')!
    expect(yankedPatch.yanked?.reason).toBe('upstream artifact checksum mismatch')

    // Yanked tags never win primary/alias-chain selection.
    expect(row.primaryTag).toBe('3.30.1')
    expect(row.aliasChain.map(m => m.tag)).not.toContain('3.30.2')
  })

  test('deprecated: no live latest, even if a stray "latest" tag is present', () => {
    const table = buildVersionTable(
      {
        latest: { content: 'sha256:eee', observed: '2026-01-01T00:00:00Z' },
        '0.10.0': { content: 'sha256:fff', observed: '2026-01-01T00:00:00Z' },
      },
      'deprecated',
    )

    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('0.10.0')
    expect(row.showLatestHighlight).toBe(false)
    expect(row.aliasChain.map(m => m.tag)).not.toContain('latest')
  })

  test('all-yanked row: no primary, no alias chain, groups still render', () => {
    const table = buildVersionTable(
      {
        '1.0.0': {
          content: 'sha256:111',
          observed: '2026-01-01T00:00:00Z',
          yanked: { reason: 'broken build', at: '2026-01-02T00:00:00Z' },
        },
      },
      'active',
    )

    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBeNull()
    expect(row.aliasChain).toEqual([])
    expect(row.majorGroups[0].minorGroups[0].patches[0].tag).toBe('1.0.0')
  })

  test('unknown tags carry digest + yanked through too', () => {
    const table = buildVersionTable(
      { nightly_build: { content: 'sha256:999', observed: '2026-01-01T00:00:00Z' } },
      'active',
    )
    expect(table.unknownTags).toEqual([{ tag: 'nightly_build', digest: 'sha256:999', yanked: undefined }])
  })

  test('primaryTag depth-fallback: depth-4 tag only (prerelease/build) wins with no shallower tags', () => {
    const table = buildVersionTable(
      { '1.2.3-rc1': { content: 'sha256:d4', observed: '2026-01-01T00:00:00Z' } },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('1.2.3-rc1')
  })

  test('primaryTag depth-fallback: depth-2 tag only (major.minor) wins with no shallower tags', () => {
    const table = buildVersionTable(
      { '1.2': { content: 'sha256:d2', observed: '2026-01-01T00:00:00Z' } },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('1.2')
  })

  test('primaryTag depth-fallback: depth-1 tag only (bare major) wins with no shallower tags', () => {
    const table = buildVersionTable(
      { 1: { content: 'sha256:d1', observed: '2026-01-01T00:00:00Z' } },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('1')
  })

  test('bare variant tag joins its own alias chain as the head (nginx "alpine" shape)', () => {
    // Regression coverage for a demo-fixtures data gap that shipped without
    // the bare "alpine" tag alongside alpine-1/alpine-1.2/alpine-1.2.0 (all
    // four sharing one digest, exactly like "latest" does for the default
    // row) — the rendered variant row started at "alpine-1" instead of the
    // bare rolling tag. `buildVersionTable` itself already threads a bare
    // variant tag through as the row's depth-0 `primaryTag` and therefore
    // the chain head; this test locks that behavior in so a future fixture
    // gap fails loudly here instead of only being visible on the rendered
    // detail page.
    const table = buildVersionTable(
      {
        alpine: { content: 'sha256:alp', observed: '2026-07-15T00:00:00Z' },
        'alpine-1': { content: 'sha256:alp', observed: '2026-07-15T00:00:00Z' },
        'alpine-1.2': { content: 'sha256:alp', observed: '2026-07-15T00:00:00Z' },
        'alpine-1.2.0': { content: 'sha256:alp', observed: '2026-07-15T00:00:00Z' },
      },
      'active',
    )

    const row = table.rows.find(r => r.variant === 'alpine')!
    expect(row.primaryTag).toBe('alpine')
    expect(row.showLatestHighlight).toBe(false)
    expect(row.aliasChain.map(m => m.tag)).toEqual(['alpine', 'alpine-1', 'alpine-1.2', 'alpine-1.2.0'])
    expect(row.aliasChain.every(m => m.digest === 'sha256:alp')).toBe(true)
  })

  test('latest-only package: no versioned tags at all, majorGroups stays empty', () => {
    const table = buildVersionTable(
      { latest: { content: 'sha256:only', observed: '2026-01-01T00:00:00Z' } },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.primaryTag).toBe('latest')
    expect(row.majorGroups).toEqual([])
    expect(row.preciseAliasTag).toBeNull()
  })

  test('rows sort default first, then named variants alphabetically', () => {
    const table = buildVersionTable(
      {
        'slim-1.0.0': { content: 'sha256:slim', observed: '2026-01-01T00:00:00Z' },
        latest: { content: 'sha256:def', observed: '2026-01-01T00:00:00Z' },
        'alpine-1.0.0': { content: 'sha256:alp', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )
    expect(table.rows.map(r => r.variant)).toEqual([null, 'alpine', 'slim'])
  })

  test('two minor groups under one major sort newest-minor-first', () => {
    const table = buildVersionTable(
      {
        '3.31.7': { content: 'sha256:a31', observed: '2026-01-01T00:00:00Z' },
        '3.30.5': { content: 'sha256:a30', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    const major = row.majorGroups.find(mg => mg.major === 3)!
    expect(major.minorGroups.map(m => m.minorTag)).toEqual(['3.31', '3.30'])
  })

  test('two equal-depth alias members (both prerelease tags on one digest) sort newest-first', () => {
    const table = buildVersionTable(
      {
        latest: { content: 'sha256:pre', observed: '2026-01-01T00:00:00Z' },
        '1.2.3-rc2': { content: 'sha256:pre', observed: '2026-01-01T00:00:00Z' },
        '1.2.3-rc1': { content: 'sha256:pre', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.aliasChain.map(m => m.tag)).toEqual(['latest', '1.2.3-rc2', '1.2.3-rc1'])
  })
})

describe('rowHasHiddenYanked / minorGroupHasYanked', () => {
  // Regression coverage for the "yanked tags render with zero distinction"
  // bug: `buildVersionTable` threads `yanked` correctly (see the yank-
  // threading tests above), but VersionTree.vue's collapsed default state
  // (every row/minor-group starts closed) gave zero passive signal that a
  // yanked release existed underneath — a user had to blindly expand a row
  // *and* open the exact right minor popover to ever see it. These two
  // functions are what VersionTree.vue now checks to color the collapsed
  // expand-toggle/minor-toggle before that drill-down happens.

  test('astral-sh/uv shape: a yanked patch nested under a synthesized minor group is flagged', () => {
    const table = buildVersionTable(
      {
        '1.0.0': { content: 'sha256:xxx', observed: '2026-07-17T00:00:00Z' },
        '0.9.0': {
          content: 'sha256:yyy',
          observed: '2026-07-01T00:00:00Z',
          yanked: { reason: 'broken build', at: '2026-07-20T00:00:00Z' },
        },
      },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(rowHasHiddenYanked(row)).toBe(true)

    const yankedMinor = row.majorGroups.find(mg => mg.major === 0)!.minorGroups[0]
    const liveMinor = row.majorGroups.find(mg => mg.major === 1)!.minorGroups[0]
    expect(minorGroupHasYanked(yankedMinor)).toBe(true)
    expect(minorGroupHasYanked(liveMinor)).toBe(false)
  })

  test('all-live package: no hidden yank anywhere', () => {
    const table = buildVersionTable(
      {
        latest: { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
        '1.2.3': { content: 'sha256:aaa', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(rowHasHiddenYanked(row)).toBe(false)
  })

  test('yanked rolling tag alone does not count as "hidden" — it already renders unconditionally', () => {
    const table = buildVersionTable(
      {
        latest: {
          content: 'sha256:fff',
          observed: '2026-01-01T00:00:00Z',
          yanked: { reason: 'bad rolling pointer', at: '2026-01-02T00:00:00Z' },
        },
        '1.2.3': { content: 'sha256:aba', observed: '2026-01-01T00:00:00Z' },
      },
      'active',
    )
    const row = table.rows.find(r => r.isDefault)!
    expect(row.yankedRolling.length).toBe(1)
    expect(rowHasHiddenYanked(row)).toBe(false)
  })
})
