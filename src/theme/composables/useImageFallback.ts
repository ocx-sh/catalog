import { type MaybeRefOrGetter, computed, ref, toValue, watch } from 'vue'

/**
 * Shared `<img>` retry chain — given an ordered list of candidate URLs
 * (`null` entries just get skipped), tries the first, advances to the next
 * on `@error`, and lands on `null` once the list is exhausted (the
 * caller's template falls back to a non-`<img>` placeholder, e.g. a
 * monogram tile, at that point). Unifies `PackageCard`'s and
 * `IdentityBlock`'s logo fallback chains, which each built their own
 * ad-hoc attempt-counter before this extraction.
 *
 * Resets to the first candidate whenever the candidate list itself changes
 * (e.g. a route navigation to a different package).
 */
export function useImageFallback(candidates: MaybeRefOrGetter<(string | null)[]>) {
  const attempt = ref(0)

  watch(() => toValue(candidates), () => { attempt.value = 0 })

  const src = computed(() => toValue(candidates)[attempt.value] ?? null)

  function onError() {
    attempt.value += 1
  }

  return { src, onError }
}
