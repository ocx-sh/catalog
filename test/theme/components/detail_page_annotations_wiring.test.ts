// @vitest-environment happy-dom
//
// C-600 shipped-entrypoint reachability pin (mirrors
// `brand_install_wiring.test.ts`'s own reasoning): `readImageIndexAnnotations`
// is fully covered by `test/viewmodel/catalog_detail.test.ts`, but coverage
// cannot tell whether anything SHIPPED reaches it. This file proves the REAL
// `DetailPage.vue`, given real fetch responses, actually renders license and
// source data derived from an OCI image index's own annotations (via
// `useImageIndex.ts`'s `detail`), and omits it for a package that has none.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'

const relativePath = ref('widgets/tool.md')

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
    frontmatter: ref({ layout: 'detail', ...identityFromPath(relativePath.value) }),
  }),
}))

const DetailPage = (await import('../../../src/theme/components/detail/DetailPage.vue')).default

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function rootFixture(digest: string) {
  return {
    name: 'ocx.sh/widgets/tool',
    repository: 'oci://ghcr.io/acme/tool',
    owners: [{ github: 'acme' }],
    status: 'active' as const,
    deprecated_message: null,
    // Deliberately null — isolates the assertion to the NEW annotation-read
    // path (`detail.sourceRepository`), not the pre-existing `root.source`
    // fallback MetaRail also reads.
    source: null,
    created: '2026-01-01T00:00:00Z',
    desc: null,
    tags: { '1.0.0': { content: digest, observed: '2026-01-01T00:00:00Z' } },
  }
}

function imageIndexFixture(annotations?: Record<string, string>) {
  return {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [],
    ...(annotations ? { annotations } : {}),
  }
}

function mockFetchRouter(routes: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const body = routes[url]
    if (body === undefined) return Promise.resolve({ ok: false, status: 404 })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }) as unknown as typeof fetch
}

describe('C-600 detail page reachability — license/source from OCI annotations', () => {
  test('a fixture package WITH annotations renders license + source on the real DetailPage', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    relativePath.value = 'widgets/tool.md'
    globalThis.fetch = mockFetchRouter({
      '/p/widgets/tool.json': rootFixture(digest),
      [`/p/widgets/tool/o/sha256/${'a'.repeat(64)}.json`]: imageIndexFixture({
        'org.opencontainers.image.licenses': 'MIT',
        'org.opencontainers.image.source': 'https://github.com/acme/widget',
      }),
    })

    const wrapper = mount(DetailPage)
    await vi.waitFor(() => expect(wrapper.text()).toContain('MIT'))

    expect(wrapper.text()).toContain('MIT')
    expect(wrapper.html()).toContain('href="https://github.com/acme/widget"')
    wrapper.unmount()
  })

  test('a fixture package WITHOUT annotations omits license + the annotation-derived source row', async () => {
    const digest = `sha256:${'b'.repeat(64)}`
    relativePath.value = 'widgets/other.md'
    globalThis.fetch = mockFetchRouter({
      '/p/widgets/other.json': { ...rootFixture(digest), name: 'ocx.sh/widgets/other' },
      [`/p/widgets/other/o/sha256/${'b'.repeat(64)}.json`]: imageIndexFixture(),
    })

    const wrapper = mount(DetailPage)
    // Wait for the package identity to render (proves the root fetch
    // resolved), then for the image-index fetch itself to have been
    // dispatched, then flush its resolution + the resulting reactive
    // update through — asserting absence is only a REAL negative proof once
    // the annotation-read path has actually had the chance to run.
    await vi.waitFor(() => expect(wrapper.text()).toContain('widgets/other'))
    const imageIndexUrl = `/p/widgets/other/o/sha256/${'b'.repeat(64)}.json`
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(imageIndexUrl))
    await flushPromises()

    expect(wrapper.text()).not.toContain('license')
    expect(wrapper.text()).not.toContain('MIT')
    wrapper.unmount()
  })
})
