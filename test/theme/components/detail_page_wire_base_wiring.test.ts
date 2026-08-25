// @vitest-environment happy-dom
//
// Shipped-entrypoint reachability pin for the multi-source `wireBase`
// (`build/pages.ts` -> page frontmatter -> every client-side wire fetch).
//
// This is the regression the 100% coverage gate could never have caught, and
// the reason AGENTS.md says so out loud: every line of `usePackageRoot` /
// `useImageIndex` / `utils/cas.ts` was already executed by their own unit
// tests, but nothing asserted the URL they built pointed at the tree
// `sources/mirror.ts` actually wrote. For a source without `root: true` the
// mirror writes `index/<label>/p/**` while all four builders emitted
// `/p/**` — every request 404'd, and because the logo/README paths both
// degrade silently (image-fallback chain exhausts to a monogram, ReadmePane
// shows its empty state), a wholly broken multi-source catalog rendered as
// one whose packages simply publish no description.
//
// So the assertion here is deliberately the FETCHED URL, not the rendered
// pixels: the router below registers the fixture bodies ONLY under the
// prefixed paths, so a regression to a site-root URL is a 404 and fails.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { computed, ref } from 'vue'

const relativePath = ref('widgets/tool.md')
const frontmatterState = ref<Record<string, unknown>>({ layout: 'detail' })

// `build/pages.ts` writes each package's identity into its page frontmatter
// (`ns`/`pkg`) and DetailPage reads it from there — never from the route,
// which leads with an index name for any non-root source. These tests keep
// driving navigation by path, so the stub derives the same pair from it.
function identityFromPath(path) {
  const segments = path.replace(/\.md$/, '').split('/')
  return { ns: segments[0], pkg: segments.slice(1).join('/') }
}
vi.mock('vitepress', () => ({
  useData: () => ({
    page: ref({ relativePath: relativePath.value }),
    frontmatter: computed(() => ({ ...identityFromPath(relativePath.value), ...frontmatterState.value })),
  }),
}))

const DetailPage = (await import('../../../src/theme/components/detail/DetailPage.vue')).default

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  frontmatterState.value = { layout: 'detail' }
  // Reset here, not at the end of the one test that changes it — a failing
  // assertion would otherwise skip the restore and leak into the next test.
  relativePath.value = 'widgets/tool.md'
})

const CONTENT_DIGEST = 'sha256:' + 'a'.repeat(64)
const README_DIGEST = 'sha256:' + 'b'.repeat(64)
const LOGO_DIGEST = 'sha256:' + 'c'.repeat(64)

const ROOT_FIXTURE = {
  name: 'ocx.sh/widgets/tool',
  repository: 'oci://registry.corp.example/widgets/tool',
  owners: [{ github: 'acme' }],
  status: 'active' as const,
  deprecated_message: null,
  source: null,
  created: '2026-01-01T00:00:00Z',
  desc: {
    digest: 'sha256:' + 'd'.repeat(64),
    title: 'Tool',
    description: 'A corporate-mirrored tool.',
    keywords: ['corp'],
    readme: README_DIGEST,
    logo: LOGO_DIGEST,
  },
  tags: { '1.0.0': { content: CONTENT_DIGEST, observed: '2026-01-01T00:00:00Z' } },
}

const IMAGE_INDEX_FIXTURE = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.index.v1+json',
  manifests: [],
}

/** Records every requested URL, and answers only the ones registered. */
function recordingFetch(routes: Record<string, unknown>) {
  const seen: string[] = []
  const fn = vi.fn((url: string) => {
    seen.push(url)
    const body = routes[url]
    if (body === undefined) return Promise.resolve({ ok: false, status: 404 })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return seen
}

describe('multi-source wireBase reaches every client-side wire fetch', () => {
  test('a non-root source page fetches its root and image index under /index/<label>/p/**', async () => {
    frontmatterState.value = { layout: 'detail', wireBase: 'index/corp' }
    const seen = recordingFetch({
      '/index/corp/p/widgets/tool.json': ROOT_FIXTURE,
      [`/index/corp/p/widgets/tool/o/sha256/${'a'.repeat(64)}.json`]: IMAGE_INDEX_FIXTURE,
    })

    const wrapper = mount(DetailPage)
    await flushPromises()
    await flushPromises()

    expect(seen).toContain('/index/corp/p/widgets/tool.json')
    // The root resolved, so the page rendered its title rather than the
    // not-found state — proof the prefixed URL was the one that answered.
    expect(wrapper.text()).toContain('Tool')
    // No request may fall back to the site root: that path only ever holds
    // the `root: true` source's copy.
    expect(seen.filter((url) => url.startsWith('/p/'))).toEqual([])
  })

  test('the logo and README URLs on a non-root source page carry the same prefix', async () => {
    frontmatterState.value = { layout: 'detail', wireBase: 'index/corp' }
    const seen = recordingFetch({
      '/index/corp/p/widgets/tool.json': ROOT_FIXTURE,
    })

    const wrapper = mount(DetailPage)
    await flushPromises()
    await flushPromises()

    expect(seen).toContain(`/index/corp/p/widgets/tool/o/sha256/${'b'.repeat(64)}.md`)
    const logoSrc = wrapper.findAll('img').map((img) => img.attributes('src'))
    expect(logoSrc).toContain(`/index/corp/p/widgets/tool/o/sha256/${'c'.repeat(64)}.svg`)
  })

  // The frontmatter identity channel's own red state. Every other test in
  // this file drives navigation by path and lets the stub derive `ns`/`pkg`
  // FROM that path, so route-split and frontmatter are indistinguishable in
  // all of them — the channel `build/pages.ts` exists to provide could be
  // deleted and nothing here would notice.
  //
  // This is the one case where the two DISAGREE. A non-root index's page is
  // served at `/<label>/<ns>/<pkg>`, so splitting the route reads the index
  // label `corp.example` as the namespace and asks for
  // `/index/corp.example/p/corp.example/widgets/…` — a 404 that the theme's
  // image-fallback chain and ReadmePane both degrade silently, rendering as
  // "this package publishes nothing" rather than as a broken fetch.
  test('identity comes from frontmatter, never from splitting the route', async () => {
    relativePath.value = 'corp.example/widgets/tool.md'
    frontmatterState.value = { layout: 'detail', wireBase: 'index/corp.example', ns: 'widgets', pkg: 'tool' }
    const seen = recordingFetch({
      '/index/corp.example/p/widgets/tool.json': ROOT_FIXTURE,
    })

    const wrapper = mount(DetailPage)
    await flushPromises()
    await flushPromises()

    expect(seen).toContain('/index/corp.example/p/widgets/tool.json')
    expect(wrapper.text()).toContain('Tool')
    // The route-split answer. Nothing may ask for it.
    expect(seen.filter((url) => url.includes('/p/corp.example/'))).toEqual([])
  })

  test('a root:true source page (no wireBase in frontmatter) still fetches the site root', async () => {
    const seen = recordingFetch({
      '/p/widgets/tool.json': ROOT_FIXTURE,
    })

    const wrapper = mount(DetailPage)
    await flushPromises()
    await flushPromises()

    expect(seen).toContain('/p/widgets/tool.json')
    expect(wrapper.text()).toContain('Tool')
    expect(seen.filter((url) => url.startsWith('/index/'))).toEqual([])
  })
})
