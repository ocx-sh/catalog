/**
 * The detail page's version table: a package's tags grouped as one row per
 * variant (default first), each with the alias chain of tags sharing the
 * primary tag's digest and a major/minor/patch breakdown (D-053, D-054,
 * D-057, D-059). Restored from 0.5.3's `src/theme/utils/version.ts`.
 *
 * The grammar here is the DISPLAY grammar (prerelease and build segments
 * included, as `Version::parse` in ocx reads them). It is deliberately not
 * `viewmodel/version_order.ts`'s `findLatestVersion` grammar, which feeds the
 * byte-stable `catalog.json` and stops at `major[.minor[.patch]]`.
 *
 * Digests decide the alias chains here and never leave this module: the
 * result carries tag names and yank records only, so a `DetailView` stays small.
 */
import type { Status, Yank } from "../../viewmodel/types.js";

export interface Version {
  readonly variant: string | null;
  readonly major: number;
  readonly minor: number | null;
  readonly patch: number | null;
  readonly prerelease: string | null;
  readonly build: string | null;
}

export type ParsedTag =
  | { readonly kind: "latest" }
  | { readonly kind: "version"; readonly version: Version; readonly raw: string }
  | { readonly kind: "other"; readonly raw: string };

/** A tag as the table renders it. `yanked` is the wire record, kept so a withdrawn tag stays visible. */
export interface RenderedTag {
  readonly tag: string;
  readonly yanked: Yank | null;
  readonly ephemeral: boolean;
}

/** A group header that is a real tag, or a label standing in for its children. */
interface GroupHead {
  /** What the header reads: the real tag name, or a synthesised `3` / `3.31`. */
  readonly label: string;
  /** A real tag to copy and preview: the header itself, else the newest release under it. */
  readonly tag: string;
  /** The header's own yank record; `null` for a synthesised header. */
  readonly yanked: Yank | null;
  readonly ephemeral: boolean;
  /** No such tag on the wire: the header exists only to group the tags below it. */
  readonly synthetic: boolean;
}

export interface MinorGroup extends GroupHead {
  /** Patch and build tags under this minor, newest first. */
  readonly patches: readonly RenderedTag[];
}

export interface MajorGroup extends GroupHead {
  readonly major: number;
  readonly minorGroups: readonly MinorGroup[];
}

export interface VariantRow {
  readonly variant: string | null;
  /** `default` for the unprefixed row. */
  readonly label: string;
  readonly isDefault: boolean;
  /** `latest` when live (never for a deprecated package), else the row's own rolling tag when live, else the most precise live version; `null` with no live tag. */
  readonly primaryTag: string | null;
  /** Only `primaryTag === "latest"`. */
  readonly showLatestHighlight: boolean;
  /** Live tags sharing `primaryTag`'s digest, rolling first, then least to most specific. */
  readonly aliasChain: readonly RenderedTag[];
  /** The most precise alias of a live `latest` (newest among ties), else `null`. */
  readonly preciseAliasTag: string | null;
  /** Yanked rolling tags: never primary, but yanking must stay visible beside the chain. */
  readonly yankedRolling: readonly RenderedTag[];
  readonly majorGroups: readonly MajorGroup[];
}

/**
 * One line of pre-releases and snapshot builds: the tags sharing a track key (the tag minus its trailing build
 * stamp: `mr11`, `canary`, `2.0.0-rc`). `tag` and `label` are the newest live build, `patches` the other builds,
 * newest first, so a track renders like a minor line.
 */
export interface TrackGroup extends MinorGroup {
  readonly key: string;
}

export interface VersionTable {
  readonly rows: readonly VariantRow[];
  /** Non-stable tags (a semver pre-release, or a non-version name with a build stamp), most recently active first. */
  readonly tracks: readonly TrackGroup[];
  /** Tags that are neither versions nor a known variant's rolling name. */
  readonly unknownTags: readonly RenderedTag[];
}

/** The slice of a wire tag entry the table reads. */
export interface TableTag {
  readonly content: string;
  readonly yanked: Yank | null;
  /** Absent is durable. */
  readonly ephemeral?: boolean;
  /** ISO time of the tag's last observation; orders the tracks. */
  readonly observed?: string;
}

const VERSION_RE =
  /^(([a-z][a-z0-9.]*)-)?(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)(-([0-9a-zA-Z]+))?([_+]([0-9a-zA-Z]+))?)?)?$/;

export function parseVersion(tag: string): Version | null {
  const m = VERSION_RE.exec(tag);
  if (m === null || m[2] === "latest") return null;
  return {
    variant: m[2] ?? null,
    major: Number(m[3]),
    minor: m[5] === undefined ? null : Number(m[5]),
    patch: m[7] === undefined ? null : Number(m[7]),
    prerelease: m[9] ?? null,
    build: m[11] ?? null,
  };
}

/** A trailing build stamp: any run of `[_.+-]` plus digits, optionally a `T…Z` time (`_20261020T101500Z`, `.3`, `-2026-10-20`). */
const STAMP_RE = /^(.+?)(?:[_.+-][0-9]+(?:T[0-9]+Z?)?)+$/;

/** The key a non-stable tag's track is named by: `tag` minus its build stamp, or `tag` itself without one. */
export function trackKey(tag: string): string {
  const key = STAMP_RE.exec(tag)?.[1];
  // `1.3.0-20261020` is a build of a prerelease-less version: stripping it would name a stable tag.
  return key === undefined || parseVersion(key)?.prerelease === null ? tag : key;
}

export function parseTag(tag: string): ParsedTag {
  if (tag === "latest") return { kind: "latest" };
  const version = parseVersion(tag);
  return version === null ? { kind: "other", raw: tag } : { kind: "version", version, raw: tag };
}

/** Whether `tag` belongs to a track: a semver pre-release, or a non-version name carrying a build stamp. */
const isTrackTag = (parsed: ParsedTag): boolean =>
  parsed.kind === "version" ? parsed.version.prerelease !== null : parsed.kind === "other" && STAMP_RE.test(parsed.raw);

/** Negative when `a` < `b`; mirrors the ocx `Ord` for `Version`: a missing component sorts above a present one, a prerelease or build below none. */
export function compareVersions(a: Version, b: Version): number {
  if (a.variant === null && b.variant !== null) return 1;
  if (a.variant !== null && b.variant === null) return -1;
  if (a.variant !== null && b.variant !== null) {
    const byVariant = a.variant.localeCompare(b.variant);
    if (byVariant !== 0) return byVariant;
  }
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor === null && b.minor !== null) return 1;
  if (a.minor !== null && b.minor === null) return -1;
  if (a.minor !== null && b.minor !== null && a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch === null && b.patch !== null) return 1;
  if (a.patch !== null && b.patch !== null && a.patch !== b.patch) return a.patch - b.patch;
  if (a.patch !== null && b.patch === null) return -1;
  if (a.prerelease !== null && b.prerelease === null) return -1;
  if (a.prerelease === null && b.prerelease !== null) return 1;
  if (a.prerelease !== null && b.prerelease !== null) {
    const byPrerelease = a.prerelease.localeCompare(b.prerelease);
    if (byPrerelease !== 0) return byPrerelease;
  }
  if (a.build !== null && b.build === null) return -1;
  if (a.build === null && b.build !== null) return 1;
  if (a.build !== null && b.build !== null) return a.build.localeCompare(b.build);
  return 0;
}

/** 1 major, 2 minor, 3 patch, 4 a patch carrying a prerelease or build. */
export function versionDepth(v: Version): number {
  if (v.patch !== null) return v.build !== null || v.prerelease !== null ? 4 : 3;
  return v.minor !== null ? 2 : 1;
}

interface Entry {
  readonly tag: string;
  readonly version: Version | null;
  /** 0 for a rolling tag (`latest`, a bare variant name), else `versionDepth`. */
  readonly depth: number;
  readonly digest: string;
  readonly yanked: Yank | null;
  readonly ephemeral: boolean;
}

type VersionedEntry = Entry & { readonly version: Version };

const rendered = (entry: Entry): RenderedTag => ({ tag: entry.tag, yanked: entry.yanked, ephemeral: entry.ephemeral });
const newestFirst = (a: VersionedEntry, b: VersionedEntry): number => compareVersions(b.version, a.version);

function groupBy<K, V>(items: readonly V[], key: (item: V) => K): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

function buildRow(variant: string | null, entries: readonly Entry[], status: Status): VariantRow {
  const isDefault = variant === null;
  const prefix = variant === null ? "" : `${variant}-`;
  // Every versioned entry, yanked included: a withdrawn release stays in its group.
  const versioned = entries.filter((e): e is VersionedEntry => e.version !== null).sort(newestFirst);
  // A deprecated package's stray `latest` is dropped from `live` entirely, not only from primary selection.
  const live = entries.filter((e) => e.yanked === null && !(isDefault && status === "deprecated" && e.tag === "latest"));
  // An ephemeral tag may be pruned, so it is never the primary the install card opens on.
  const liveRolling = live.filter((e) => e.depth === 0 && !e.ephemeral);
  const liveVersioned = live.filter((e): e is VersionedEntry => e.depth > 0 && !e.ephemeral).sort(newestFirst);
  const primary = liveRolling[0] ?? [4, 3, 2, 1].map((d) => liveVersioned.find((e) => e.depth === d)).find((e) => e !== undefined);

  let aliasChain: Entry[] = [];
  let preciseAliasTag: string | null = null;
  if (primary !== undefined) {
    const members = live.filter((e) => e.digest === primary.digest);
    aliasChain = [
      ...members.filter((e) => e.depth === 0),
      ...members.filter((e): e is VersionedEntry => e.depth > 0).sort((a, b) => a.depth - b.depth || newestFirst(a, b)),
    ];
    if (primary.tag === "latest") {
      // Deepest first, newest among ties: the first non-primary member of the maximum depth.
      const others = aliasChain.filter((e) => e.tag !== primary.tag && !e.ephemeral);
      const deepest = Math.max(0, ...others.map((e) => e.depth));
      preciseAliasTag = others.find((e) => e.depth === deepest)?.tag ?? null;
    }
  }

  const majors = new Map(versioned.filter((e) => e.depth === 1).map((e) => [e.version.major, e]));
  const minors = new Map(versioned.filter((e) => e.depth === 2).map((e) => [`${e.version.major}.${e.version.minor}`, e]));
  const patches = groupBy(
    versioned.filter((e) => e.depth >= 3),
    (e) => `${e.version.major}.${e.version.minor}`,
  );
  const minorKeys = new Set([...minors.keys(), ...patches.keys()]);

  const majorGroups: MajorGroup[] = [...new Set([...majors.keys(), ...[...minorKeys].map((k) => Number(k.split(".")[0]))])]
    .sort((a, b) => b - a)
    .map((major) => {
      const minorGroups: MinorGroup[] = [...minorKeys]
        .filter((key) => Number(key.split(".")[0]) === major)
        .sort((a, b) => Number(b.split(".")[1]) - Number(a.split(".")[1]))
        .map((key) => {
          const head = minors.get(key);
          const children = (patches.get(key) ?? []).map(rendered);
          return {
            label: head?.tag ?? `${prefix}${key}`,
            // A synthesised minor exists only because a patch does, so `children` is not empty then.
            tag: head?.tag ?? children[0].tag,
            yanked: head?.yanked ?? null,
            ephemeral: head?.ephemeral ?? false,
            synthetic: head === undefined,
            patches: children,
          };
        });
      const head = majors.get(major);
      return {
        major,
        label: head?.tag ?? `${prefix}${major}`,
        // Synthesised: the newest release under it, which has a minor group by construction.
        tag: head?.tag ?? minorGroups[0].patches[0]?.tag ?? minorGroups[0].tag,
        yanked: head?.yanked ?? null,
        ephemeral: head?.ephemeral ?? false,
        synthetic: head === undefined,
        minorGroups,
      };
    });

  return {
    variant,
    label: variant ?? "default",
    isDefault,
    primaryTag: primary?.tag ?? null,
    showLatestHighlight: primary?.tag === "latest",
    aliasChain: aliasChain.map(rendered),
    preciseAliasTag,
    yankedRolling: entries.filter((e) => e.depth === 0 && e.yanked !== null).map(rendered),
    majorGroups,
  };
}

/**
 * Groups `tags` by variant. A bare name (`slim`) is a variant's rolling tag
 * only when some `slim-<version>` tag proves `slim` is a variant; every other
 * tag that is not a version lands in `unknownTags`.
 */
export function buildVersionTable(tags: Readonly<Record<string, TableTag>>, status: Status): VersionTable {
  const parsed = Object.entries(tags).map(([tag, wire]) => ({ wire, parsedTag: parseTag(tag), tag }));
  const variants = new Set(
    parsed.flatMap(({ parsedTag }) => (parsedTag.kind === "version" && parsedTag.version.variant !== null ? [parsedTag.version.variant] : [])),
  );
  const unknownTags: RenderedTag[] = [];
  const trackTags: typeof parsed = [];
  const entries: { readonly variant: string | null; readonly entry: Entry }[] = [];
  for (const { wire, parsedTag, tag } of parsed) {
    const base = { tag, digest: wire.content, yanked: wire.yanked, ephemeral: wire.ephemeral === true };
    if (isTrackTag(parsedTag) && !variants.has(tag)) trackTags.push({ wire, parsedTag, tag });
    else if (parsedTag.kind === "latest") entries.push({ variant: null, entry: { ...base, version: null, depth: 0 } });
    else if (parsedTag.kind === "version") {
      entries.push({ variant: parsedTag.version.variant, entry: { ...base, version: parsedTag.version, depth: versionDepth(parsedTag.version) } });
    } else if (variants.has(tag)) entries.push({ variant: tag, entry: { ...base, version: null, depth: 0 } });
    else unknownTags.push({ tag, yanked: wire.yanked, ephemeral: wire.ephemeral === true });
  }
  const byVariant = groupBy(entries, ({ variant }) => variant);
  const rows = [...byVariant]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([variant, items]) => buildRow(variant, items.map(({ entry }) => entry), status));
  return { rows, tracks: buildTracks(trackTags), unknownTags };
}

const byBuild = new Intl.Collator("en", { numeric: true });

/** Groups track tags by key. A build number sorts numerically (`rc.10` above `rc.9`), a timestamp lexically. */
function buildTracks(tags: readonly { readonly tag: string; readonly wire: TableTag }[]): TrackGroup[] {
  const tracks = [...groupBy(tags, ({ tag }) => trackKey(tag))].map(([key, members]) => {
    const builds = members.sort((a, b) => byBuild.compare(b.tag, a.tag));
    // The headline build is the newest one that is not withdrawn; a withdrawn newer build stays in the list.
    const head = builds[Math.max(0, builds.findIndex(({ wire }) => wire.yanked === null))];
    const asRendered = ({ tag, wire }: (typeof builds)[number]): RenderedTag => ({ tag, yanked: wire.yanked, ephemeral: wire.ephemeral === true });
    const activity = members.reduce((max, { wire }) => (wire.observed !== undefined && wire.observed > max ? wire.observed : max), "");
    const track: TrackGroup = {
      key,
      label: head.tag,
      tag: head.tag,
      yanked: head.wire.yanked,
      ephemeral: head.wire.ephemeral === true,
      synthetic: false,
      patches: builds.filter((build) => build !== head).map(asRendered),
    };
    return { activity, track };
  });
  return tracks.sort((a, b) => (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : a.track.key.localeCompare(b.track.key))).map(({ track }) => track);
}

/** True when `minor`'s own tag or any of its patches is yanked. */
export function minorGroupHasYanked(minor: MinorGroup): boolean {
  return minor.yanked !== null || minor.patches.some((p) => p.yanked !== null);
}

/**
 * True when the collapsed breakdown of `row` hides a yanked tag. Rolling yanked
 * tags are excluded: they render beside the alias chain and are never collapsed.
 */
export function rowHasHiddenYanked(row: VariantRow): boolean {
  return row.majorGroups.some((major) => major.yanked !== null || major.minorGroups.some(minorGroupHasYanked));
}

/** Tags a row's breakdown holds: what the collapsed toggle counts. */
export function breakdownCount(row: VariantRow): number {
  return row.majorGroups.reduce(
    (count, major) =>
      count + (major.synthetic ? 0 : 1) + major.minorGroups.reduce((n, minor) => n + 1 + minor.patches.length, 0),
    0,
  );
}

/** Prerender bounds: per variant row, the newest `SSR_LINES` major and minor lines and `SSR_PATCHES` patch tags under them. */
export const SSR_LINES = 24;
export const SSR_PATCHES = 12;
/** Tags of the "other" row shown before its `+N` toggle. */
export const SSR_OTHER = 5;
/** Tracks prerendered before the rest are fetched. */
export const SSR_TRACKS = 8;

/**
 * What the detail page prerenders of a table, so a package with hundreds of tags stays a small page (DOM and
 * gzip budgets). Everything else is fetched on first interaction and rendered by the browser (`client/versions.ts`).
 */
export interface Prerender {
  /** The groups and patch tags that are prerendered, by identity. Rolling and alias chips are not in it: they always are. */
  readonly shown: ReadonlySet<object>;
  /** Every tag name the page prerenders a chip for. */
  readonly tags: ReadonlySet<string>;
  /** Something is left to fetch. */
  readonly cut: boolean;
}

export function prerender(table: VersionTable): Prerender {
  const shown = new Set<object>();
  const tags = new Set<string>(table.unknownTags.slice(0, SSR_OTHER).map(({ tag }) => tag));
  for (const row of table.rows) {
    for (const { tag } of [...row.aliasChain, ...row.yankedRolling]) tags.add(tag);
    let lines = SSR_LINES;
    let patches = SSR_PATCHES;
    for (const major of row.majorGroups) {
      if (lines === 0) break;
      lines--;
      shown.add(major);
      tags.add(major.tag);
      for (const minor of major.minorGroups) {
        if (lines === 0) break;
        lines--;
        shown.add(minor);
        tags.add(minor.tag);
        for (const patch of minor.patches.slice(0, patches)) {
          shown.add(patch);
          tags.add(patch.tag);
        }
        patches -= Math.min(patches, minor.patches.length);
      }
    }
  }
  for (const track of table.tracks.slice(0, SSR_TRACKS)) {
    shown.add(track);
    tags.add(track.tag);
    for (const patch of track.patches.slice(0, SSR_PATCHES)) {
      shown.add(patch);
      tags.add(patch.tag);
    }
  }
  const cut =
    table.unknownTags.length > SSR_OTHER ||
    table.rows.some((row) => rowIsCut(row, shown)) ||
    table.tracks.some((track) => !shown.has(track) || minorIsCut(track, shown));
  return { shown, tags, cut };
}

/** True when `minor` has patch tags the page does not prerender. */
export function minorIsCut(minor: MinorGroup, shown: ReadonlySet<object>): boolean {
  return minor.patches.some((patch) => !shown.has(patch));
}

/** True when the breakdown of `row` has a line or patch tag the page does not prerender. */
export function rowIsCut(row: VariantRow, shown: ReadonlySet<object>): boolean {
  return row.majorGroups.some(
    (major) => !shown.has(major) || major.minorGroups.some((minor) => !shown.has(minor) || minorIsCut(minor, shown)),
  );
}

/** Why an ephemeral tag is marked. */
export const EPHEMERAL_REASON = "Ephemeral: may be pruned from the registry";
/** Why a track tag is marked. */
export const PRERELEASE_REASON = "Pre-release: not a stable version";

const GESTURES = "to copy identifier · right-click for more";

/** A chip's tooltip: which gestures copy (D-082), led by the reason and date of a withdrawn tag (D-054). */
export function tagTitle(yanked: Yank | null, ephemeral = false, prerelease = false): string {
  if (yanked !== null) return `Yanked — ${yanked.reason} · ${yanked.at.slice(0, 10)} — click ${GESTURES}`;
  const marks = [...(prerelease ? [PRERELEASE_REASON] : []), ...(ephemeral ? [EPHEMERAL_REASON] : [])];
  return marks.length > 0 ? `${marks.join(" · ")} — click ${GESTURES}` : `Click ${GESTURES}`;
}
