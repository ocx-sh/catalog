import { describe, expect, test } from 'vitest'
import { nextTick, ref } from 'vue'
import { useImageFallback } from '../../../src/theme/composables/useImageFallback.js'

describe('useImageFallback', () => {
  test('starts at the first candidate', () => {
    const { src } = useImageFallback(ref(['/a.svg', '/a.png']))
    expect(src.value).toBe('/a.svg')
  })

  test('onError advances to the next candidate, then null once exhausted', () => {
    const { src, onError } = useImageFallback(ref(['/a.svg', '/a.png']))

    onError()
    expect(src.value).toBe('/a.png')

    onError()
    expect(src.value).toBe(null)
  })

  test('an empty candidate list starts at null (caller falls back to monogram)', () => {
    const { src } = useImageFallback(ref([]))
    expect(src.value).toBe(null)
  })

  test('a candidate-list change (route nav to a different package) resets the attempt index', async () => {
    const candidates = ref<(string | null)[]>(['/a.svg', '/a.png'])
    const { src, onError } = useImageFallback(candidates)

    onError()
    expect(src.value).toBe('/a.png')

    candidates.value = ['/b.svg']
    await nextTick()

    expect(src.value).toBe('/b.svg')
  })
})
