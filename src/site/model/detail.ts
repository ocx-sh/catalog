/**
 * One small detail view per `PackageRoute` (`/<route>/`). Identity comes from
 * the route's `namespace`/`package`, never the URL or `root.name`. The view
 * builds no path from them (D-152): a package directory with an unusual name
 * still gets its page, and only a CAS asset path (`viewmodel/catalog.ts`
 * `casRelpath`) or a link target (`supersededByHref`) is held to the safe-path
 * rule. Carries
 * no README body, wire root or image index (C-047): the README is read from
 * the mirrored CAS file at render time, and the only wire-derived data here
 * is the already-reduced `DetailWire` the build derives from the source
 * package with `detailWire`: owners, upstream, the version table (tag names
 * and yank records, no digests) and one `release` per distinct image index
 * (platforms, licence, source, revision), which the page swaps between when a
 * tag is hovered or picked. This view is build-only (`site.json` is read by
 * the Astro child and never shipped): the page renders a bounded part of it
 * (`lib/versionTable.ts`'s `prerender`) and the browser fetches the rest from
 * the mirrored package root (`client/versions.ts`).
 */
import { assertSafePackagePath } from "../../viewmodel/catalog.js";
import type { PackageRoute } from "../../viewmodel/route.js";
import type { Catalog, CatalogEntry, CatalogSourcePackage, CatalogUpstream, Status, Yank } from "../../viewmodel/types.js";
import { joinBase, packageHref, wireHref } from "../../viewmodel/url.js";
import { DEFAULT_INSTALL_FLAVORS, installCommand, type InstallIcon } from "../lib/installFlavors.js";
import { installTarget, pinOptions, type PinOption } from "../lib/installPin.js";
import { ownerProfileUrl } from "../lib/ownerUrl.js";
import { imageIndexFacts, NO_FACTS, type ReleaseFacts } from "../lib/releaseFacts.js";
import { buildVersionTable, type VersionTable } from "../lib/versionTable.js";

export interface DetailOwner {
  readonly login: string;
  /** Profile link from the owning source's template; `null` renders plain text. */
  readonly href: string | null;
}

export interface DetailInstallRow {
  readonly label: string;
  readonly icon: InstallIcon;
  /** The flavor's command template (`{name}` token), which the page fills in again when the pick changes. */
  readonly template: string;
  /** The command for the initial target. */
  readonly command: string;
}

/** One variant of the install card's selectors. */
export interface DetailInstallVariant {
  /** `null` for the default (unprefixed) variant. */
  readonly variant: string | null;
  readonly label: string;
  readonly primaryTag: string | null;
  /** The alias chain as version options; empty when the variant has no live tag. */
  readonly options: readonly PinOption[];
}

export interface DetailUpstream {
  readonly org: string;
  /** `wireHref` of the vendor repository; `null` renders plain text. */
  readonly href: string | null;
  /** The repository URL without its scheme, as shown; `null` when the wire has none. */
  readonly repository: string | null;
  /** The governance notice (ND-9); shown whenever present. */
  readonly disclaimer: string | null;
}

/** The physical OCI repository (D-052): shown as written, copied without the scheme. */
export interface DetailRegistry {
  /** The wire `repository` verbatim, `oci://` included. Untrusted text. */
  readonly display: string;
  /** `display` without the `oci://` scheme: what `ocx`, docker, oras and crane take. */
  readonly address: string;
}

/** What follows a tag: shown in the Platforms card and the metadata rows while the tag is hovered or picked. */
export interface DetailRelease {
  /** Index into `DetailView.platformSets`. */
  readonly platformSet: number;
  readonly license: string | null;
  /** `wireHref` of the repository whose CI built this release; `null` drops the row. */
  readonly sourceHref: string | null;
  readonly revision: string | null;
}

export interface DetailView {
  /** Route key (`PackageRoute.segments.join("/")`). */
  readonly key: string;
  readonly namespace: string;
  readonly package: string;
  /** Mount prefix of the source the package came from: `""` for the root source, else `index/<label>`. */
  readonly wireBase: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Untrusted text; rendered as search links on the landing page. */
  readonly keywords: readonly string[];
  readonly status: Status;
  /** `null` for a missing or empty message. */
  readonly deprecatedMessage: string | null;
  /** The raw `superseded_by` text, shown whether or not it links; `null` when missing or empty. */
  readonly supersededBy: string | null;
  /** `packageHref` of the superseding package, `null` when unset or unsafe. */
  readonly supersededByHref: string | null;
  /** The most precise alias of `latest`; `null` with no live `latest` (deprecated, or none). */
  readonly latestVersion: string | null;
  readonly upstream: DetailUpstream | null;
  /** `null` when the wire root names no repository. */
  readonly registry: DetailRegistry | null;
  /** Every tag, yanked included. */
  readonly versions: VersionTable;
  /** Count of every tag, yanked included. */
  readonly tagCount: number;
  /** Tag name to index into `releases`, for every wire tag (not only the prerendered ones). Build-only, like the whole view. */
  readonly tagReleases: readonly (readonly [string, number])[];
  /** Every ephemeral wire tag (snapshot builds that may be pruned). */
  readonly ephemeralTags: readonly string[];
  /** Every yanked wire tag with its record. */
  readonly yankedTags: readonly (readonly [string, Yank])[];
  readonly releases: readonly DetailRelease[];
  /** The distinct `os/arch` sets across `releases`. */
  readonly platformSets: readonly (readonly string[])[];
  /** The tag the page opens on: the primary tag of the first variant with a live tag. */
  readonly initialTag: string | null;
  /** Index into `releases` of `initialTag`; `null` without one. */
  readonly initialRelease: number | null;
  /** One entry per variant with a live tag, for the install card's selectors. */
  readonly installVariants: readonly DetailInstallVariant[];
  /** One row per install flavor for `initialTag`; empty when nothing is installable. */
  readonly install: readonly DetailInstallRow[];
  readonly owners: readonly DetailOwner[];
  /** `base`-joined logo URL, `null` when the package has none. */
  readonly logoUrl: string | null;
}

/**
 * The wire-derived facts a detail page needs beyond the catalog entry,
 * already reduced to display data. `detailWire` builds one per package.
 */
export interface DetailWire {
  readonly owners: readonly string[];
  /** The wire `desc.title`; `null` without a `desc`. */
  readonly descTitle: string | null;
  /** Root `source`. Untrusted text. */
  readonly source: string | null;
  readonly upstream: CatalogUpstream | null;
  /** Root `repository`: the physical `oci://` address. Untrusted text. */
  readonly repository: string | null;
  readonly versions: VersionTable;
  readonly tagTotal: number;
  /** Distinct image-index facts. */
  readonly releases: readonly ReleaseFacts[];
  readonly tagReleases: readonly (readonly [string, number])[];
  readonly ephemeralTags: readonly string[];
  readonly yankedTags: readonly (readonly [string, Yank])[];
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

/** The facts of one tag's image index in the source package; a missing or unparseable one has none. */
function releaseFacts(source: CatalogSourcePackage, digest: string): ReleaseFacts {
  const bytes = source.contentByDigest[`${digest}.json`];
  if (bytes === undefined) return NO_FACTS;
  let index: unknown;
  try {
    index = JSON.parse(textDecoder.decode(bytes));
  } catch {
    return NO_FACTS;
  }
  return imageIndexFacts(index, digest);
}

/**
 * Reduces one source package to the facts `detailView` renders: the version
 * table over every tag, yanked included, and the facts of each distinct image
 * index the tags point at.
 */
export function detailWire(source: CatalogSourcePackage): DetailWire {
  const { root } = source;
  const releases: ReleaseFacts[] = [];
  const indexOf = new Map<string, number>();
  const tagReleases: [string, number][] = [];
  for (const [tag, entry] of Object.entries(root.tags)) {
    const facts = releaseFacts(source, entry.content);
    const key = JSON.stringify(facts);
    const known = indexOf.get(key);
    const index = known ?? releases.push(facts) - 1;
    indexOf.set(key, index);
    tagReleases.push([tag, index]);
  }
  return {
    owners: root.owners,
    descTitle: root.desc === null ? null : root.desc.title,
    source: root.source,
    upstream: root.upstream,
    repository: root.repository,
    versions: buildVersionTable(root.tags, root.status),
    tagTotal: tagReleases.length,
    releases,
    tagReleases,
    ephemeralTags: Object.entries(root.tags).filter(([, entry]) => entry.ephemeral).map(([tag]) => tag),
    yankedTags: Object.entries(root.tags).flatMap(([tag, entry]) => (entry.yanked === null ? [] : [[tag, entry.yanked] as const])),
  };
}

/** `supersededBy` is a bare `<ns>/<pkg>` in the same index as the package. */
function supersededByHref(supersededBy: string | null, name: string, catalog: Catalog, base: string): string | null {
  if (supersededBy === null) return null;
  const [namespace = "", ...rest] = supersededBy.split("/");
  try {
    assertSafePackagePath(namespace, rest.join("/"));
  } catch {
    return null;
  }
  const index = name.split("/")[0];
  return packageHref(`${index}/${supersededBy}`, catalog.indexes, base);
}

function installRows(name: string, tag: string | null): readonly DetailInstallRow[] {
  const target = installTarget(name, tag);
  if (target === null) return [];
  return DEFAULT_INSTALL_FLAVORS.map(({ label, icon, command }) => ({
    label,
    icon,
    template: command,
    command: installCommand(command, target),
  }));
}

/** Empty text is as absent as `null`. */
const text = (value: string | null): string | null => (value === null || value === "" ? null : value);

function upstreamView(upstream: CatalogUpstream | null): DetailUpstream | null {
  if (upstream === null) return null;
  const url = text(upstream.repositoryUrl);
  return {
    org: upstream.org,
    href: wireHref(url),
    repository: url === null ? null : url.replace(/^https?:\/\//, ""),
    disclaimer: text(upstream.disclaimer),
  };
}

function registryView(repository: string | null): DetailRegistry | null {
  const display = text(repository);
  return display === null ? null : { display, address: display.replace(/^oci:\/\//, "") };
}

export function detailView(route: PackageRoute, entry: CatalogEntry, context: DetailContext): DetailView {
  const { catalog, base } = context;
  const wire = context.wire;
  const template = route.ownerUrl ?? context.ownerUrl;
  const versions = wire?.versions ?? { rows: [], tracks: [], unknownTags: [] };
  const facts = wire?.releases ?? [];
  const platformKeys = facts.map(({ platforms }) => JSON.stringify(platforms));
  const platformSets = [...new Set(platformKeys)].map((key) => JSON.parse(key) as string[]);
  const rootSource = wire?.source ?? null;
  // A variant with no live tag has nothing to install: it neither opens the page nor offers a pick.
  const rows = versions.rows.filter((row) => row.primaryTag !== null);
  const initialTag = rows[0]?.primaryTag ?? null;
  const supersededBy = text(entry.supersededBy);
  return {
    key: route.segments.join("/"),
    namespace: route.namespace,
    package: route.package,
    wireBase: route.wireBase,
    name: entry.name,
    // Without a `desc` the title is the leaf of the name, not the qualified name the entry falls back to.
    title: wire === undefined ? entry.title : (wire.descTitle ?? route.package.slice(route.package.lastIndexOf("/") + 1)),
    description: entry.description,
    keywords: entry.keywords,
    status: entry.status,
    deprecatedMessage: text(entry.deprecatedMessage),
    supersededBy,
    supersededByHref: supersededByHref(supersededBy, entry.name, catalog, base),
    latestVersion: versions.rows.find((row) => row.isDefault)?.preciseAliasTag ?? null,
    upstream: upstreamView(wire?.upstream ?? null),
    registry: registryView(wire?.repository ?? null),
    versions,
    tagCount: wire?.tagTotal ?? entry.tagCount,
    tagReleases: wire?.tagReleases ?? [],
    ephemeralTags: wire?.ephemeralTags ?? [],
    yankedTags: wire?.yankedTags ?? [],
    releases: facts.map((fact, i) => ({
      platformSet: platformSets.findIndex((set) => JSON.stringify(set) === platformKeys[i]),
      license: fact.license,
      sourceHref: wireHref(rootSource ?? fact.source),
      revision: fact.revision,
    })),
    platformSets,
    initialTag,
    initialRelease: initialTag === null ? null : (wire?.tagReleases.find(([tag]) => tag === initialTag)?.[1] ?? null),
    installVariants: rows.map((row) => ({
      variant: row.variant,
      label: row.label,
      primaryTag: row.primaryTag,
      options: pinOptions(row.aliasChain.filter((member) => !member.ephemeral)),
    })),
    install: installRows(entry.name, initialTag),
    owners: (wire?.owners ?? []).map((login) => ({ login, href: wireHref(ownerProfileUrl(template, login)) })),
    logoUrl: entry.logoUrl === null ? null : joinBase(base, entry.logoUrl),
  };
}
