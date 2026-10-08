import { packageRoutePath, type RouteIndex } from "../../viewmodel/route.js";

/**
 * The route key of a catalog entry (`PackageRoute.segments.join("/")`): its
 * route path without the leading slash. A key identifies a page in the
 * model; it is never a link (`packageHref` builds those, C-009).
 */
export const packageRouteKey = (name: string, indexes: readonly RouteIndex[] | undefined): string =>
  packageRoutePath(name, indexes).slice(1);
