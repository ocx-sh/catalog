/**
 * `siteModel()`: the pure, deterministic composition of every page's view
 * (C-031), serialized to `<scratch>/site.json` and served to the pages as
 * `virtual:ocx-catalog/site`. Keyed by `PackageRoute` key.
 *
 * Carries route keys, the landing view, one small `DetailView` per route, the
 * docs list, chrome props and each route's README CAS path — never README
 * bodies, wire roots or image indexes (C-047).
 */
import type { LoadedConfig } from "../../config/types.js";
import type { PackageRoute } from "../../viewmodel/route.js";
import type { Catalog, CatalogEntry } from "../../viewmodel/types.js";
import { chromeView, type ChromeView } from "./chrome.js";
import { detailView, type DetailView, type DetailWire } from "./detail.js";
import { docsView, type DocsSource, type DocsView } from "./docs.js";
import { landingView, type LandingView } from "./landing.js";
import { packageRouteKey } from "./route_key.js";

export type { ChromeView, DetailView, DetailWire, DocsView, LandingView };

export interface SiteModel {
  /** Canonical config `base`. */
  readonly base: string;
  /** Route keys in catalog order. */
  readonly routes: readonly string[];
  readonly landing: LandingView;
  /** One view per route key. */
  readonly details: Readonly<Record<string, DetailView>>;
  /**
   * `siteModel()` returns each route's catalog-root-relative CAS README path,
   * `null` when it has none; the build then swaps in the absolute path of the
   * rendered, sanitised HTML (`src/build/readmes.ts`), `null` when there is no
   * README or it could not be rendered (C-037).
   */
  readonly readme: Readonly<Record<string, string | null>>;
  readonly docs: DocsView;
  readonly chrome: ChromeView;
}

/** The identity of a route: its URL path segments joined, as `descLookup` keys them. */
export function routeKey(route: PackageRoute): string {
  return route.segments.join("/");
}

/**
 * @param docs pre-scanned docs pages (the scan is the build's, not this
 *   function's — it must stay pure); empty when `docs` is unset.
 * @param wire per-route wire facts, keyed by route key and derived by the
 *   build with `detailWire` (the model never reads wire files); a route
 *   without an entry renders the catalog entry's data only.
 */
export function siteModel(
  catalog: Catalog,
  packages: readonly PackageRoute[],
  loaded: LoadedConfig,
  docs: readonly DocsSource[] = [],
  wire: Readonly<Record<string, DetailWire>> = {},
): SiteModel {
  const base = loaded.config.base ?? "/";
  // A catalog entry's qualified name is its route path (route.ts), so the
  // key is the one place an entry and a route meet.
  const entries = new Map<string, CatalogEntry>(
    catalog.packages.map((entry) => [packageRouteKey(entry.name, catalog.indexes), entry]),
  );
  const details: Record<string, DetailView> = {};
  const readme: Record<string, string | null> = {};
  for (const route of packages) {
    const key = routeKey(route);
    const entry = entries.get(key);
    if (entry === undefined) {
      throw new Error(`siteModel: route ${key} has no catalog entry`);
    }
    details[key] = detailView(route, entry, { catalog, base, ownerUrl: loaded.config.ownerUrl, wire: wire[key] });
    readme[key] = entry.readmeUrl;
  }
  return {
    base,
    routes: packages.map(routeKey),
    landing: landingView(catalog, base),
    details,
    readme,
    docs: docsView(docs, base),
    chrome: chromeView(loaded.config, base),
  };
}
