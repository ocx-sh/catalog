/**
 * One small detail view per `PackageRoute` (`/<route>/`). Identity comes from
 * the route's `namespace`/`package`, never the URL or `root.name`. Carries
 * no README body, wire root or image index (C-047): the README is read from
 * the mirrored CAS file at render time, and the only wire-derived data here
 * is the small, already-reduced `DetailWire` (owners, tag names, the latest
 * tag's licence/source/revision and platforms) the build derives from the
 * source package with `detailWire`.
 */
import { assertSafePackagePath, catalogPlatforms, readImageIndexAnnotations } from "../../viewmodel/catalog.js";
import type { PackageRoute } from "../../viewmodel/route.js";
import type { Catalog, CatalogEntry, CatalogSourcePackage, Status } from "../../viewmodel/types.js";
import { findLatestVersion } from "../../viewmodel/version_order.js";
import { joinBase, packageHref, wireHref } from "../../viewmodel/url.js";
import { rootHref } from "../lib/cas.js";
import { DEFAULT_INSTALL_FLAVORS, installCommand, type InstallIcon } from "../lib/installFlavors.js";
import { liveTagsNewestFirst } from "../lib/liveTags.js";
import { ownerProfileUrl } from "../lib/ownerUrl.js";

/** Tags rendered in the HTML; the rest load on interaction (C-016). */
export const SSR_TAG_LIMIT = 20;

export interface DetailOwner {
  readonly login: string;
  /** Profile link from the owning source's template; `null` renders plain text. */
  readonly href: string | null;
}

export interface DetailInstallRow {
  readonly label: string;
  readonly icon: InstallIcon;
  /** The command for the default target, the bare qualified name (`latest`). */
  readonly command: string;
}

export interface DetailView {
  /** Route key (`PackageRoute.segments.join("/")`). */
  readonly key: string;
  readonly namespace: string;
  readonly package: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Untrusted text; rendered as search links on the landing page. */
  readonly keywords: readonly string[];
  readonly status: Status;
  readonly deprecatedMessage: string | null;
  /** The raw `superseded_by` text, shown whether or not it links. */
  readonly supersededBy: string | null;
  /** `packageHref` of the superseding package, `null` when unset or unsafe. */
  readonly supersededByHref: string | null;
  readonly latestVersion: string | null;
  /** Newest `SSR_TAG_LIMIT` live tags; the rest load on interaction. */
  readonly tags: readonly string[];
  readonly tagCount: number;
  /** `os/arch` of the latest tag's image index. */
  readonly platforms: readonly string[];
  /** One row per install flavor; empty when the package has no live tag. */
  readonly install: readonly DetailInstallRow[];
  readonly license: string | null;
  /** `wireHref` of the build's source repository; `null` drops the row. */
  readonly sourceHref: string | null;
  readonly revision: string | null;
  readonly owners: readonly DetailOwner[];
  /** The source's mount prefix (`""` for the root source, `index/<label>`). */
  readonly wireBase: string;
  /** `base`-joined URL of the mirrored package root, for the versions island. */
  readonly rootUrl: string;
  /** `base`-joined logo URL, `null` when the package has none. */
  readonly logoUrl: string | null;
}

/**
 * The wire-derived facts a detail page needs beyond the catalog entry,
 * already reduced to display data. `detailWire` builds one per package.
 */
export interface DetailWire {
  readonly owners: readonly string[];
  /** Live (non-yanked) tags, newest first. */
  readonly tags: readonly string[];
  /** Root `source`, else the latest tag's source annotation. Untrusted text. */
  readonly source: string | null;
  readonly license: string | null;
  readonly revision: string | null;
  readonly platforms: readonly string[];
}

export interface DetailContext {
  readonly catalog: Catalog;
  readonly base: string;
  /** Top-level `ownerUrl`; a route's own `ownerUrl` overrides it. */
  readonly ownerUrl?: string | undefined;
  /** Absent: no wire facts were supplied, the view carries the entry's data only. */
  readonly wire?: DetailWire | undefined;
}

const textDecoder = new TextDecoder();

/**
 * Reduces one source package to the facts `detailView` renders. The latest
 * tag is the highest plain version (`findLatestVersion`), else `latest`; with
 * no live such tag the platforms fall back to the package-wide union and the
 * annotations are absent. Tags order newest observation first, ties by
 * descending version-aware tag name.
 */
export function detailWire(source: CatalogSourcePackage): DetailWire {
  const { root } = source;
  const tags = liveTagsNewestFirst(root.tags);

  const latestTag = findLatestVersion(root.tags) ?? "latest";
  const latest = root.tags[latestTag];
  if (latest === undefined || latest.yanked !== null) {
    return { owners: root.owners, tags, source: root.source, license: null, revision: null, platforms: catalogPlatforms(source) };
  }
  const bytes = source.contentByDigest[`${latest.content}.json`];
  if (bytes === undefined) {
    throw new Error(`latest tag digest ${latest.content} missing from contentByDigest`);
  }
  const annotations = readImageIndexAnnotations(JSON.parse(textDecoder.decode(bytes)) as object, latest.content);
  return {
    owners: root.owners,
    tags,
    source: root.source ?? annotations.sourceRepository ?? null,
    license: annotations.license ?? null,
    revision: annotations.revision ?? null,
    platforms: catalogPlatforms({ ...source, root: { ...root, tags: { [latestTag]: latest } } }),
  };
}

/** `supersededBy` is a bare `<ns>/<pkg>` in the same index as the package. */
function supersededByHref(entry: CatalogEntry, catalog: Catalog, base: string): string | null {
  if (entry.supersededBy === null) return null;
  const [namespace = "", ...rest] = entry.supersededBy.split("/");
  try {
    assertSafePackagePath(namespace, rest.join("/"));
  } catch {
    return null;
  }
  const index = entry.name.split("/")[0];
  return packageHref(`${index}/${entry.supersededBy}`, catalog.indexes, base);
}

export function detailView(route: PackageRoute, entry: CatalogEntry, context: DetailContext): DetailView {
  const { catalog, base } = context;
  assertSafePackagePath(route.namespace, route.package);
  const wire: DetailWire = context.wire ?? {
    owners: [],
    tags: [],
    source: null,
    license: null,
    revision: null,
    platforms: entry.platforms,
  };
  const template = route.ownerUrl ?? context.ownerUrl;
  return {
    key: route.segments.join("/"),
    namespace: route.namespace,
    package: route.package,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    keywords: entry.keywords,
    status: entry.status,
    deprecatedMessage: entry.deprecatedMessage,
    supersededBy: entry.supersededBy,
    supersededByHref: supersededByHref(entry, catalog, base),
    latestVersion: entry.latestVersion,
    tags: wire.tags.slice(0, SSR_TAG_LIMIT),
    tagCount: entry.tagCount,
    platforms: wire.platforms,
    install:
      entry.tagCount === 0
        ? []
        : DEFAULT_INSTALL_FLAVORS.map(({ label, icon, command }) => ({
            label,
            icon,
            command: installCommand(command, entry.name),
          })),
    license: wire.license,
    sourceHref: wireHref(wire.source),
    revision: wire.revision,
    owners: wire.owners.map((login) => ({ login, href: wireHref(ownerProfileUrl(template, login)) })),
    wireBase: route.wireBase,
    rootUrl: rootHref(base, `${route.namespace}/${route.package}`, route.wireBase),
    logoUrl: entry.logoUrl === null ? null : joinBase(base, entry.logoUrl),
  };
}
