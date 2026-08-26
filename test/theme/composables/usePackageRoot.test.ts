// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { ownerLogin, usePackageRoot } from '../../../src/theme/composables/usePackageRoot.js'

// WP-03 coverage-gap closure: usePackageRoot had no ported test (source repo
// didn't carry one either). It fetches from `onMounted`/`watch`, both no-ops
// outside an active component instance — mounted via a host component
// (@vue/test-utils) rather than called directly, per useCommandPalette's own
// docblock on the same constraint.

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mountHost(ns: string, pkg: string) {
  const nsRef = ref(ns)
  const pkgRef = ref(pkg)
  let result!: ReturnType<typeof usePackageRoot>
  const Host = defineComponent({
    setup() {
      result = usePackageRoot(nsRef, pkgRef)
      return () => null
    },
  })
  const wrapper = mount(Host)
  return { wrapper, nsRef, pkgRef, get: () => result }
}

describe('usePackageRoot', () => {
  test('fetches on mount and populates root', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: 'ocx.sh/kitware/cmake' }) }),
    ) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(globalThis.fetch).toHaveBeenCalledWith('/p/kitware/cmake/_root.json')
    expect(get().root.value).toEqual({ name: 'ocx.sh/kitware/cmake' })
    expect(get().notFound.value).toBe(false)
    expect(get().error.value).toBeNull()
    wrapper.unmount()
  })

  test('fetches the ad-blocker-safe alias, never the canonical <pkg>.json url', async () => {
    // The canonical url is what EasyList/EasyPrivacy's unanchored
    // `/<word>.js` rules match (`/hawkeye.js` inside `/hawkeye.json`), so a
    // regression here silently breaks the detail page for every uBlock user
    // whose package name collides. Assert the alias positively AND the
    // canonical path's absence — a fallback that fires on a 200 would still
    // pass the first assertion alone.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: 'ocx.sh/hawkeye/hawkeye' }) }),
    ) as unknown as typeof fetch

    const { get, wrapper } = mountHost('hawkeye', 'hawkeye')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(globalThis.fetch).toHaveBeenCalledWith('/p/hawkeye/hawkeye/_root.json')
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/p/hawkeye/hawkeye.json')
    wrapper.unmount()
  })

  test('a 404 on the alias falls back to the canonical root url', async () => {
    // A wire tree mirrored by an older build of this package has no alias;
    // the canonical copy is always there, so the page must still load.
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/_root.json')
          ? { ok: false, status: 404 }
          : { ok: true, status: 200, json: () => Promise.resolve({ name: 'ocx.sh/kitware/cmake' }) },
      ),
    ) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(globalThis.fetch).toHaveBeenCalledWith('/p/kitware/cmake/_root.json')
    expect(globalThis.fetch).toHaveBeenCalledWith('/p/kitware/cmake.json')
    expect(get().root.value).toEqual({ name: 'ocx.sh/kitware/cmake' })
    expect(get().notFound.value).toBe(false)
    expect(get().error.value).toBeNull()
    wrapper.unmount()
  })

  test('a 404 sets notFound and clears root, without setting error', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 })) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'missing')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().notFound.value).toBe(true)
    expect(get().root.value).toBeNull()
    expect(get().error.value).toBeNull()
    wrapper.unmount()
  })

  test('a non-404 non-ok response sets error and clears root', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 })) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().error.value).toBe('HTTP 500')
    expect(get().root.value).toBeNull()
    expect(get().notFound.value).toBe(false)
    wrapper.unmount()
  })

  test('a thrown Error sets error.value to its message', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().error.value).toBe('network down')
    wrapper.unmount()
  })

  test('a thrown non-Error value falls back to a generic error message', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject('boom')) as unknown as typeof fetch

    const { get, wrapper } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().error.value).toBe('Failed to load package')
    wrapper.unmount()
  })

  test('a route change re-fetches for the new ns/pkg', async () => {
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: url }) }),
    ) as unknown as typeof fetch

    const { get, wrapper, nsRef, pkgRef } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    nsRef.value = 'ocx-contrib'
    pkgRef.value = 'shellcheck'
    await vi.waitFor(() => expect(get().root.value).toEqual({ name: '/p/ocx-contrib/shellcheck/_root.json' }))

    expect(globalThis.fetch).toHaveBeenCalledWith('/p/ocx-contrib/shellcheck/_root.json')
    wrapper.unmount()
  })

  test('a stale in-flight response (slow nav A, fast nav B) is discarded', async () => {
    const resolvers = new Map<string, (v: unknown) => void>()
    globalThis.fetch = vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          resolvers.set(url, resolve)
        }),
    ) as unknown as typeof fetch

    const { get, wrapper, nsRef, pkgRef } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(resolvers.has('/p/kitware/cmake/_root.json')).toBe(true))

    // Navigate to a second package before the first request resolves.
    nsRef.value = 'ocx-contrib'
    pkgRef.value = 'shellcheck'
    await vi.waitFor(() => expect(resolvers.has('/p/ocx-contrib/shellcheck/_root.json')).toBe(true))

    // Resolve the STALE (first) request after the newer one is in flight.
    resolvers.get('/p/kitware/cmake/_root.json')!({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'stale' }),
    })
    resolvers.get('/p/ocx-contrib/shellcheck/_root.json')!({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'fresh' }),
    })
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().root.value).toEqual({ name: 'fresh' })
    wrapper.unmount()
  })

  test('a nav race that lands between fetch() and resp.json() also discards the stale write', async () => {
    // Distinct from the "stale in-flight" case above: there, staleness is
    // detected right after `fetch()` resolves (before `resp.json()` is even
    // called). Here `fetch()` resolves immediately (passing that first
    // token check) but `resp.json()` itself is the slow step — the nav
    // happens during that gap, so the SECOND token check (right after
    // `resp.json()` resolves) is the one that must catch it.
    const jsonResolvers = new Map<string, (v: unknown) => void>()
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((resolve) => jsonResolvers.set(url, resolve)),
      }),
    ) as unknown as typeof fetch

    const { get, wrapper, nsRef, pkgRef } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(jsonResolvers.has('/p/kitware/cmake/_root.json')).toBe(true))

    nsRef.value = 'ocx-contrib'
    pkgRef.value = 'shellcheck'
    await vi.waitFor(() => expect(jsonResolvers.has('/p/ocx-contrib/shellcheck/_root.json')).toBe(true))

    jsonResolvers.get('/p/ocx-contrib/shellcheck/_root.json')!({ name: 'fresh' })
    jsonResolvers.get('/p/kitware/cmake/_root.json')!({ name: 'stale' })
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().root.value).toEqual({ name: 'fresh' })
    wrapper.unmount()
  })

  test('a nav race during a slow rejection also discards the stale error write', async () => {
    // Third distinct staleness point: this one is the token guard INSIDE
    // the catch block (fires only when the fetch itself is still pending —
    // i.e. rejecting, not resolving — while a newer nav starts).
    const rejecters = new Map<string, (e: unknown) => void>()
    globalThis.fetch = vi.fn(
      (url: string) => new Promise((_resolve, reject) => rejecters.set(url, reject)),
    ) as unknown as typeof fetch

    const { get, wrapper, nsRef, pkgRef } = mountHost('kitware', 'cmake')
    await vi.waitFor(() => expect(rejecters.has('/p/kitware/cmake/_root.json')).toBe(true))

    nsRef.value = 'ocx-contrib'
    pkgRef.value = 'shellcheck'
    await vi.waitFor(() => expect(rejecters.has('/p/ocx-contrib/shellcheck/_root.json')).toBe(true))

    // Reject the now-stale first request — its catch block's own token
    // guard must discard this before writing error.value.
    rejecters.get('/p/kitware/cmake/_root.json')!(new Error('stale network error'))
    rejecters.get('/p/ocx-contrib/shellcheck/_root.json')!(new Error('fresh network error'))
    await vi.waitFor(() => expect(get().loading.value).toBe(false))

    expect(get().error.value).toBe('fresh network error')
    wrapper.unmount()
  })
})

describe('ownerLogin', () => {
  // ocx-indexbot 0.5.0 renamed `owners[].github` to `login` because the old
  // name claimed a forge the index may not be hosted on (see that project's
  // adr_forge_neutral_owners.md). Both spellings reach this renderer: a root
  // published before 0.5.0 carries only the legacy one, and one written since
  // carries both, derived and therefore always equal.
  test('prefers the canonical login', () => {
    expect(ownerLogin({ login: "alice", id: 1, github: "alice", github_id: 1 })).toBe("alice")
  })

  test('falls back to the pre-0.5.0 spelling', () => {
    expect(ownerLogin({ github: "alice", github_id: 1 })).toBe("alice")
  })

  test('is undefined when the root names neither', () => {
    expect(ownerLogin({})).toBeUndefined()
  })
})
