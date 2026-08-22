// @vitest-environment happy-dom
//
// C-605: `superseded_by` is wire data interpolated into an `:href` — a
// value carrying a leading `/` (or `//`, scheme-relative) must never reach
// the DOM sink as a link; it degrades to plain text instead.
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import DeprecationBanner from '../../../src/theme/components/detail/DeprecationBanner.vue'
import MetaRail from '../../../src/theme/components/detail/MetaRail.vue'

describe('C-605 DeprecationBanner superseded_by href validation', () => {
  test('a well-formed bare <ns>/<pkg> renders as a real link', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: 'kitware/cmake' },
    }).html()
    expect(html).toContain('href="/kitware/cmake"')
    expect(html).toContain('kitware/cmake')
  })

  test('a depth-N bare package path renders as a real link too', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: 'ns/pkg/sub/path' },
    }).html()
    expect(html).toContain('href="/ns/pkg/sub/path"')
  })

  test('a leading-slash value (same-origin absolute-path override) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '/evil/path' },
    }).html()
    expect(html).not.toContain('<a')
    expect(html).toContain('/evil/path')
  })

  test('a protocol-relative // value (off-site navigation) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '//evil.test/x' },
    }).html()
    expect(html).not.toContain('<a')
    expect(html).toContain('//evil.test/x')
  })

  test('a single-segment value (no /) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: 'onlyonesegment' },
    }).html()
    expect(html).not.toContain('<a')
    expect(html).toContain('onlyonesegment')
  })

  // CWE-601 open redirect: a BACKSLASH slips past a `[^/]`-based allowlist, but
  // `/${value}` = `/\evil.com/x`, and browsers apply the WHATWG special-scheme
  // "authority ignores slashes" rule (`/\` == `//`) — the same-tab link
  // navigates OFF-SITE to https://evil.com/x. `new URL("/\\evil.com/x", base)`
  // resolves to `https://evil.com/x`. Must degrade to plain text.
  test('a backslash-carrying value (`\\evil.com/x` -> off-site redirect) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '\\evil.com/x' },
    }).html()
    expect(html).not.toContain('<a')
    expect(html).toContain('evil.com/x')
  })

  test('a leading-backslash-then-slash value (`\\/evil.com`) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '\\/evil.com' },
    }).html()
    expect(html).not.toContain('<a')
  })

  test('a slash-then-backslash value (`/\\evil.com`) is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '/\\evil.com' },
    }).html()
    expect(html).not.toContain('<a')
  })

  test('a whitespace-carrying value is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: 'ns /pkg' },
    }).html()
    expect(html).not.toContain('<a')
  })

  test('a leading `../` traversal value is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: '../x' },
    }).html()
    expect(html).not.toContain('<a')
  })

  test('a `..` path segment inside the value is rejected, rendered as plain text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: 'ns/../x' },
    }).html()
    expect(html).not.toContain('<a')
  })

  test('no supersededBy at all renders neither a link nor the "superseded by" text', () => {
    const html = mount(DeprecationBanner, {
      props: { message: null, supersededBy: null },
    }).html()
    expect(html).not.toContain('<a')
    expect(html).not.toContain('superseded by')
  })
})

// C-605: MetaRail's owner-profile link is a FIXED `https://github.com/`
// prefix around wire text (low risk — the scheme/host are never
// attacker-controlled), but routed through `safeHref` for consistency with
// every other wire-adjacent href on this page rather than being the one
// hardcoded exception.
describe('C-605 MetaRail owner href — routed through safeHref for consistency', () => {
  const ROOT = {
    name: 'ocx.sh/kitware/cmake',
    repository: 'oci://ghcr.io/ocx-contrib/cmake',
    owners: [{ github: 'ocx-sh' }],
    status: 'active' as const,
    deprecated_message: null,
    created: '2026-01-01T00:00:00Z',
    desc: null,
    tags: {},
  }

  test('a normal owner login renders the expected github profile href', () => {
    const html = mount(MetaRail, {
      props: {
        root: ROOT,
        qualifiedName: 'ocx.sh/kitware/cmake',
        primaryTag: null,
        latestVersionLabel: null,
        activeImageIndex: null,
        tagCount: 0,
        table: { rows: [], unknownTags: [] },
      },
    }).html()
    expect(html).toContain('href="https://github.com/ocx-sh"')
  })
})
