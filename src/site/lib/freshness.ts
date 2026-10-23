/**
 * The footer's freshness stamp (D-136): how long ago the catalog was generated,
 * in the words the old footer used. Pure, with the clock passed in, so it is
 * unit-tested; the bundled script in `Page.astro` calls it once on load, from
 * the `generated` timestamp the page carries, so nothing is fetched.
 */
export function freshnessLabel(generated: string, now: number): string | null {
  const then = new Date(generated).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes}m ago`;
  if (minutes < 60 * 24) return `updated ${Math.floor(minutes / 60)}h ago`;
  return `updated ${Math.floor(minutes / (60 * 24))}d ago`;
}
