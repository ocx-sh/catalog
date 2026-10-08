/**
 * The catalog landing view (`/`): the first cards of the default scope in
 * their final state, plus the scope tabs. A function of the catalog and
 * `base` only (C-031).
 */
import type { Catalog, Status } from "../../viewmodel/types.js";
import { packageHref } from "../../viewmodel/url.js";
import { excludedIndexNames, hasIndexScope, resolveIndexScope, sortPackages } from "../lib/catalogState.js";
import { filterPackages } from "../lib/filterPackages.js";
import { cardKeywords, keywordFrequency } from "../lib/keywordRail.js";
import type { CatalogPackage } from "../lib/wireTypes.js";
import { packageRouteKey } from "./route_key.js";

/** Cards server-rendered into the landing HTML (C-010). */
export const LANDING_CARD_LIMIT = 24;

export interface LandingCard {
  /** Route key (`PackageRoute.segments.join("/")`). */
  readonly key: string;
  /** Detail link, `base`-joined (`packageHref`). */
  readonly href: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly status: Status;
  readonly latestVersion: string | null;
  readonly platforms: readonly string[];
  /** At most three, the catalog's most common first (`cardKeywords`). */
  readonly keywords: readonly string[];
  readonly tagCount: number;
  /** Catalog-root-relative (C-008); the page joins `base` (`wireHref`/`joinBase`). */
  readonly logoUrl: string | null;
}

export interface ScopeTab {
  /** The index this tab selects; `null` is the "all" tab. */
  readonly index: string | null;
  /** Packages the tab shows: "all" honours `excludeFromAll`, an index tab does not. */
  readonly count: number;
  /** Badged "default". */
  readonly default: boolean;
  /** The scope the page opens on. */
  readonly active: boolean;
}

export interface LandingView {
  /** The scope the page opens on: the default index's name, `null` for "all".
   * `null` also for a single-index catalog: there is no scope to choose. */
  readonly scope: string | null;
  /** Packages in that scope (the toolbar's "N packages"). */
  readonly total: number;
  /** "all" first, then each index in catalog order; empty when there is no scope to choose. */
  readonly scopes: readonly ScopeTab[];
  /** First `min(24, total)` cards of the scope, sorted by name. */
  readonly cards: readonly LandingCard[];
}

export const landingView: (catalog: Catalog, base: string) => LandingView = (catalog, base) => {
  // ponytail: the lib filters mutable wire arrays but never writes to them.
  const packages = catalog.packages as unknown as CatalogPackage[];
  // Routes read `catalog.indexes` itself: `undefined` (no envelope) means bare routes, `[]` would qualify.
  const indexes = catalog.indexes ?? [];
  const excluded = excludedIndexNames(indexes);
  const hasScope = hasIndexScope(indexes);
  const scope = hasScope ? resolveIndexScope(null, indexes) : null;
  const inScope = sortPackages(
    filterPackages(packages, { index: scope ?? undefined, excludeIndexes: scope === null ? excluded : [] }),
    "name",
    false,
  );
  // The island ranks keywords over the same population (the scope's own "all" exclusion), so a card never reorders.
  const frequency = keywordFrequency(filterPackages(packages, { excludeIndexes: scope === null ? excluded : [] }));
  const scopes: ScopeTab[] = hasScope
    ? [
        { index: null, count: filterPackages(packages, { excludeIndexes: excluded }).length, default: false, active: scope === null },
        ...indexes.map((entry) => ({
          index: entry.name,
          count: filterPackages(packages, { index: entry.name }).length,
          default: entry.default,
          active: entry.name === scope,
        })),
      ]
    : [];
  return {
    scope,
    total: inScope.length,
    scopes,
    cards: inScope.slice(0, LANDING_CARD_LIMIT).map((pkg) => ({
      key: packageRouteKey(pkg.name, catalog.indexes),
      href: packageHref(pkg.name, catalog.indexes, base),
      name: pkg.name,
      title: pkg.title,
      description: pkg.description,
      status: pkg.status,
      latestVersion: pkg.latestVersion,
      platforms: [...pkg.platforms],
      keywords: cardKeywords(pkg.keywords, frequency),
      tagCount: pkg.tagCount,
      logoUrl: pkg.logoUrl,
    })),
  };
};
