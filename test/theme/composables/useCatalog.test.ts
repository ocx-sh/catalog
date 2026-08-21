import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// WP-03 coverage-gap closure: useCatalog had no ported test (source repo
// didn't carry one either). Mirrors useImageIndex.ts's own test shape (same
// module-level cache/in-flight-dedupe pattern) — `cache`/`inFlight` are
// module state, so the module is re-imported fresh per test (vi.resetModules)
// to keep cases isolated from each other.

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function freshUseCatalog() {
  const mod = await import('../../../src/theme/composables/useCatalog.js')
  return mod.useCatalog
}

describe('useCatalog', () => {
  test('fetches /data/catalog/catalog.json and populates catalog', async () => {
    const data = { generated: '2026-08-22T00:00:00Z', packages: [] }
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const { catalog, loading, load } = useCatalog()
    expect(loading.value).toBe(true)
    await load()

    expect(globalThis.fetch).toHaveBeenCalledWith('/data/catalog/catalog.json')
    expect(catalog.value).toEqual(data)
    expect(loading.value).toBe(false)
  })

  test('a 404 degrades to the empty catalog, not an error', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 })) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const { catalog, load } = useCatalog()
    await load()

    expect(catalog.value).toEqual({ generated: null, packages: [] })
  })

  test('a non-404 non-ok response also degrades to the empty catalog', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 })) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const { catalog, load } = useCatalog()
    await load()

    expect(catalog.value).toEqual({ generated: null, packages: [] })
  })

  test('a thrown fetch also degrades to the empty catalog', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const { catalog, load } = useCatalog()
    await load()

    expect(catalog.value).toEqual({ generated: null, packages: [] })
  })

  test('cache hit: a second load() reuses the module-level cache, no second fetch', async () => {
    const data = { generated: '2026-08-22T00:00:00Z', packages: [] }
    let fetchCalls = 0
    globalThis.fetch = vi.fn(() => {
      fetchCalls++
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
    }) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const first = useCatalog()
    await first.load()
    expect(fetchCalls).toBe(1)

    // Initial ref value on a second composable call already reads from
    // cache (`ref(cache ?? EMPTY_CATALOG)`), before load() is even called.
    const second = useCatalog()
    expect(second.catalog.value).toEqual(data)
    expect(second.loading.value).toBe(false)

    await second.load()
    expect(fetchCalls).toBe(1)
  })

  test('in-flight dedup: two concurrent loads share one fetch', async () => {
    const data = { generated: null, packages: [] }
    let fetchCalls = 0
    let resolveFetch: (v: unknown) => void = () => {}
    globalThis.fetch = vi.fn(() => {
      fetchCalls++
      return new Promise((resolve) => { resolveFetch = resolve })
    }) as unknown as typeof fetch

    const useCatalog = await freshUseCatalog()
    const a = useCatalog()
    const b = useCatalog()

    const p1 = a.load()
    const p2 = b.load()
    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve(data) })
    await Promise.all([p1, p2])

    expect(fetchCalls).toBe(1)
    expect(a.catalog.value).toEqual(data)
    expect(b.catalog.value).toEqual(data)
  })
})
