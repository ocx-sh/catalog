/**
 * URL contracts for a site served under a `base` prefix (C-009, C-039, C-042).
 *
 * `base` is the validated, canonical config value: `/` or `/seg/…/` (leading
 * and trailing slash, no dot segments — `config/load.ts`, C-003).
 */
import { safeHref } from "../site/lib/safeHref.js";
import { packageRoutePath, type RouteIndex } from "./route.js";

const CATALOG_ROOT_PATH = /^\/(?!\/)/;
const CONTROL_CHARACTER = /\p{Cc}/u;
// `.`, `..` and their percent-encoded spellings (`%2e`, `.%2E`, `%2e%2e`): the
// browser decodes and normalises them, so `/%2e%2e/admin` under `/catalog/`
// navigates to `/admin`.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Joins `path` onto `base` as `base + path.slice(1)`. `path` is catalog-root
 * relative and must match `^/(?!/)`; it throws for a `\`, a control character
 * or a `.`/`..` segment (percent-encoded spellings included), so `joinBase("/", "//evil.example")` can never yield a
 * protocol-relative URL (C-039).
 */
export function joinBase(base: string, path: string): string {
  if (
    !CATALOG_ROOT_PATH.test(path) ||
    path.includes("\\") ||
    CONTROL_CHARACTER.test(path) ||
    // The path part only: `/..#x` and `/a/..?q` resolve outside `base` too, while a `?`/`#` tail is data.
    path.replace(/[?#].*/s, "").split("/").some((segment) => DOT_SEGMENT.test(segment))
  ) {
    throw new Error(`joinBase: not a catalog-root-relative path: ${JSON.stringify(path)}`);
  }
  return base + path.slice(1);
}

/**
 * The only producer of a package detail link (C-009): the route path
 * (`route.ts`'s `packageRoutePath`) plus a trailing `/`, joined onto `base`.
 */
export function packageHref(
  name: string,
  indexes: readonly RouteIndex[] | undefined,
  base: string,
): string {
  return joinBase(base, `${packageRoutePath(name, indexes)}/`);
}

/**
 * The single sink for wire-derived `href`/`src` values (C-042): the canonical
 * `URL#href` of an absolute `http(s)` URL string, `null` for anything else
 * (non-string, empty, relative, other scheme, unparseable). `safeHref` decides
 * the scheme; the returned value is the parser's own serialisation, so what
 * reaches a DOM sink is exactly what was validated.
 */
export function wireHref(value: unknown): string | null {
  const allowed = typeof value === "string" ? safeHref(value) : null;
  return allowed === null ? null : new URL(allowed).href;
}
