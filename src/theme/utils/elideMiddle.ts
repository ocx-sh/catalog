/**
 * Shortens a qualified package name — `<index>/<namespace>/<package…>` — by
 * replacing its MIDDLE segments with an ellipsis, never its ends.
 *
 * Both ends carry identity and neither is expendable: the first segment is
 * the index the package came from (the whole reason an aggregating catalog
 * prints the qualified name at all), and the last is what the package is
 * actually called. Plain CSS `text-overflow: ellipsis` can only eat the tail,
 * so on `ocx.sh/hashicorp/terraform-provider-aws` it drops precisely the half
 * a reader is looking for. There is no CSS for middle elision.
 *
 * Returns the name unchanged when it fits, and when there is no middle to
 * drop (fewer than three segments) — a two-segment name that is still too
 * long falls through to whatever `text-overflow` the caller has set, which
 * degrades but never lies about which index the package belongs to.
 *
 * `maxLength` is a CHARACTER budget, not a pixel one. That is sound here
 * because every surface rendering a package name uses `--ocx-font-mono`, so
 * characters and width are proportional; a caller passes the count that fits
 * its own column.
 */
export function elideMiddle(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;

  const segments = name.split("/");
  if (segments.length < 3) return name;

  return `${segments[0]!}/…/${segments[segments.length - 1]!}`;
}
