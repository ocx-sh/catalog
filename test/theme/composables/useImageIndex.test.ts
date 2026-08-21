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
})
