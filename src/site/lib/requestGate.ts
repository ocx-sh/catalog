/**
 * Monotonic request token. Each `begin()` supersedes every earlier one, and
 * the function it returns answers "is my request still the latest?" — a slow,
 * superseded response must check it before writing state, or it overwrites the
 * newer request's result (URL shows package B, page renders package A).
 */
export function createRequestGate(): { begin(): () => boolean } {
  let latest = 0
  return {
    begin() {
      const mine = ++latest
      return () => mine === latest
    },
  }
}
