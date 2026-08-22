import { afterEach, describe, expect, test, vi } from 'vitest'
import { useImageIndex } from '../../../src/theme/composables/useImageIndex.js'

// `useImageIndex` is a plain composable (no `onMounted`/lifecycle hooks), so
// it's callable directly outside a component here — `ref()` alone doesn't
// need one.

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockJsonResponse(digest: string) {
  return {
    ok: true,
    json: async () => ({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest, size: 512, platform: { architecture: 'amd64', os: 'linux' } }],
    }),
  }
}

describe('useImageIndex', () => {
  test('discards a stale response that resolves after a newer load() call (out-of-order resolution)', async () => {
    const digestA = `sha256:${'a'.repeat(64)}`
    const digestB = `sha256:${'b'.repeat(64)}`
    const urlA = `/p/ns/pkg/o/sha256/${'a'.repeat(64)}.json`
    const urlB = `/p/ns/pkg/o/sha256/${'b'.repeat(64)}.json`

    const resolvers = new Map<string, () => void>()
    globalThis.fetch = vi.fn((url: string) => new Promise((resolve) => {
      resolvers.set(url, () => resolve(mockJsonResponse(url === urlA ? digestA : digestB)))
    })) as unknown as typeof fetch

    const { imageIndex, load } = useImageIndex()

    const p1 = load('ns', 'pkg', digestA)
    const p2 = load('ns', 'pkg', digestB)

    // Resolve the SECOND (newer) call first, then the first (now stale) —
    // simulates a slow response landing after a faster, later one.
    resolvers.get(urlB)!()
    await p2
    resolvers.get(urlA)!()
    await p1

    expect(imageIndex.value?.manifests[0]?.digest).toBe(digestB)
  })

  test('in-flight dedup: two concurrent loads for the same digest share one fetch', async () => {
    const digest = `sha256:${'c'.repeat(64)}`
    let fetchCalls = 0
    let resolveFetch: (v: unknown) => void = () => {}
    globalThis.fetch = vi.fn(() => {
      fetchCalls++
      return new Promise((resolve) => { resolveFetch = resolve })
    }) as unknown as typeof fetch

    const a = useImageIndex()
    const b = useImageIndex()

    const p1 = a.load('ns', 'pkg2', digest)
    const p2 = b.load('ns', 'pkg2', digest)

    resolveFetch(mockJsonResponse(digest))
    await Promise.all([p1, p2])

    expect(fetchCalls).toBe(1)
    expect(a.imageIndex.value?.manifests[0]?.digest).toBe(digest)
    expect(b.imageIndex.value?.manifests[0]?.digest).toBe(digest)
  })

  // WP-03 coverage-gap closure: the 3 cases below weren't in the ported
  // suite (source repo carried no coverage gate) — cache-hit reuse, a
  // non-ok response, and a thrown fetch all fall through paths the 2
  // dedup/staleness cases above never touch.
  test('cache hit: a second load() for an already-resolved digest skips the network', async () => {
    const digest = `sha256:${'d'.repeat(64)}`
    let fetchCalls = 0
    globalThis.fetch = vi.fn(() => {
      fetchCalls++
      return Promise.resolve(mockJsonResponse(digest))
    }) as unknown as typeof fetch

    const first = useImageIndex()
    await first.load('ns', 'pkg3', digest)
    expect(fetchCalls).toBe(1)

    const second = useImageIndex()
    await second.load('ns', 'pkg3', digest)
    expect(fetchCalls).toBe(1)
    expect(second.imageIndex.value?.manifests[0]?.digest).toBe(digest)
  })

  test('a non-ok response resolves to a null image index', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch

    const { imageIndex, loading, load } = useImageIndex()
    await load('ns', 'pkg4', `sha256:${'e'.repeat(64)}`)

    expect(imageIndex.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  test('a fetch that throws resolves to a null image index', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch

    const { imageIndex, loading, load } = useImageIndex()
    await load('ns', 'pkg5', `sha256:${'f'.repeat(64)}`)

    expect(imageIndex.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  test('an ok response with unparseable JSON resolves to a null image index', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }),
    ) as unknown as typeof fetch

    const { imageIndex, loading, load } = useImageIndex()
    await load('ns', 'pkg6', `sha256:${'0'.repeat(64)}`)

    expect(imageIndex.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  // C-600: `detail` reuses WP5's `readImageIndexAnnotations`
  // (`src/viewmodel/catalog.ts`) against `imageIndex`'s own `annotations` —
  // proves the client composable is a REAL caller of that shared parser
  // (the anti-orphan concern), never a second hand-rolled reader.
  describe('detail (C-600)', () => {
    function mockJsonResponseWithAnnotations(digest: string, annotations: unknown) {
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 2,
          mediaType: 'application/vnd.oci.image.index.v1+json',
          manifests: [],
          annotations,
        }),
      }
    }

    test('reads license/source/revision off a loaded image index', async () => {
      const digest = `sha256:${'1'.repeat(64)}`
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(mockJsonResponseWithAnnotations(digest, {
          'org.opencontainers.image.licenses': 'MIT',
          'org.opencontainers.image.source': 'https://github.com/acme/widget',
          'org.opencontainers.image.revision': 'abc123',
        })),
      ) as unknown as typeof fetch

      const { detail, load } = useImageIndex()
      await load('ns', 'pkg7', digest)

      expect(detail.value).toEqual({
        license: 'MIT',
        sourceRepository: 'https://github.com/acme/widget',
        revision: 'abc123',
      })
    })

    test('omits detail entirely when the image index has no annotations key', async () => {
      const digest = `sha256:${'2'.repeat(64)}`
      globalThis.fetch = vi.fn(() => Promise.resolve(mockJsonResponse(digest))) as unknown as typeof fetch

      const { detail, load } = useImageIndex()
      await load('ns', 'pkg8', digest)

      expect(detail.value).toEqual({})
    })

    test('a malformed annotations value degrades to omitted, never throws to the caller', async () => {
      const digest = `sha256:${'3'.repeat(64)}`
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(mockJsonResponseWithAnnotations(digest, 'not-an-object')),
      ) as unknown as typeof fetch

      const { detail, imageIndex, load } = useImageIndex()
      await expect(load('ns', 'pkg9', digest)).resolves.toBeUndefined()

      // The malformed field degrades to "omitted" — the REST of the fetch
      // (imageIndex itself) is unaffected, matching `casUrl`'s "malformed
      // input -> null, never a broken request" posture this wrapper mirrors.
      expect(detail.value).toEqual({})
      expect(imageIndex.value).not.toBeNull()
    })

    test('a non-ok response (null image index) resets detail to omitted too', async () => {
      globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch

      const { detail, load } = useImageIndex()
      await load('ns', 'pkg10', `sha256:${'4'.repeat(64)}`)

      expect(detail.value).toEqual({})
    })
  })
})
