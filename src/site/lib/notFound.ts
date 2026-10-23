/**
 * The package a static 404 URL names (D-130). A static host serves `404.html`
 * for every unknown URL, so the page reads its own path: a `<ns>/<pkg>` route
 * under `base` names a package and gets the old "Package not found" wording;
 * anything else names none. Presentation only: the name is shown as text and
 * never used to build a link. Every top-level name the build reserves (the
 * mounts, the wire and data trees, the static-site output; `staticReservedNames`
 * in `sources/labels.ts`, which a unit test pins this list to) holds no
 * packages, so a two-segment URL under one is not one. That module imports
 * `node:path`, so the list is restated here for the browser bundle.
 */
const RESERVED: ReadonlySet<string> = new Set([
  "p", "index", "data", "docs", "assets", "404", "public", "_astro", "robots.txt", "_headers", "config.json", "c", "pagefind",
]);
const RESERVED_PREFIXES = ["sitemap-", "favicon"] as const;

const isReserved = (segment: string): boolean => {
  const lower = segment.toLowerCase();
  return RESERVED.has(lower) || RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

export function packageNameFromPath(pathname: string, base: string): string | null {
  if (!pathname.startsWith(base)) return null;
  const segments = pathname.slice(base.length).split("/").filter((segment) => segment !== "");
  if (segments.length !== 2 || isReserved(segments[0])) return null;
  return segments.join("/");
}
