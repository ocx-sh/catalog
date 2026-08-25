/**
 * Catalog view-model types — TS port surface of the fields the index bot's
 * `core/render.py` catalog functions (`_catalog_platforms`, `_latest_activity`,
 * `_catalog_entry`, `_generated_timestamp`, `_catalog_index`) read from
 * `indexbot.model` and produce for `/data/catalog/catalog.json`.
 *
 * These are catalog-scoped SUBSETS, not full ports of the bot's dataclasses:
 * fields the catalog emitter never reads (`owners`, `upstream`, `source`, the
 * vestigial `variants` root field, `desc.digest`, `root_raw`) are omitted.
 * See `bot/src/indexbot/model.py` for the full wire-facing shapes.
 *
 * `repository` (C-501, 2026-08-22 WP5) is the one exception: it IS carried
 * on `CatalogPackageRoot`, faithfully, for package DETAIL pages — but
 * `catalogEntry` (`catalog.ts`) never copies it onto `CatalogEntry`, so it
 * still never reaches `/data/catalog/catalog.json` (C-503, byte-stable).
 * `CatalogPackageDetail` below is the other detail-only addition (C-600) —
 * neither is a "catalog" field despite living in this catalog-scoped file,
 * which is the existing home for every `CatalogSourcePackage`-adjacent type.
 */

/** Ported from Python `Status` (`model.py:17`). */
export type Status = "active" | "deprecated" | "yanked";

/** Catalog-scoped subset of Python `Yank` (`model.py:91-96`). */
export interface Yank {
  readonly reason: string;
  readonly at: string;
}

/**
 * Catalog-scoped subset of Python `TagEntry` (`model.py:99-111`). `yanked`
 * is always-present-but-possibly-`null` (mirrors dataclass attribute access
 * — `entry.yanked is not None` — rather than an optional property), not
 * TS-optional.
 */
export interface TagEntry {
  readonly content: string;
  readonly observed: string;
  readonly yanked: Yank | null;
}

/** Catalog-scoped subset of Python `PackageId` (`model.py:114-128`). */
export interface PackageId {
  readonly namespace: string;
  readonly package: string;
}

/**
 * Catalog-scoped subset of Python `Desc` (`model.py:77-88`) — `digest` is
 * omitted; the catalog emitter never reads it.
 */
export interface CatalogDesc {
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly readme: string | null;
  readonly logo: string | null;
}

/**
 * Catalog-scoped subset of Python `PackageRoot` (`model.py:165-213`) — only
 * the fields `core/render.py`'s catalog functions read.
 */
export interface CatalogPackageRoot {
  readonly name: string;
  readonly status: Status;
  readonly deprecatedMessage: string | null;
  readonly supersededBy: string | null;
  /** Physical OCI repository this entry points to, `oci://<host>/<path>`
   * (C-501). Detail-page data only — `catalogEntry` never copies this onto
   * `CatalogEntry`, so it never reaches `/data/catalog/catalog.json`
   * (C-503). `null` when the wire root omits it; never fabricated. */
  readonly repository: string | null;
  readonly created: string;
  readonly desc: CatalogDesc | null;
  readonly tags: Readonly<Record<string, TagEntry>>;
}

/**
 * Catalog-scoped subset of Python `SourcePackage` (`core/render.py:59-73`).
 * `root_raw` is omitted — the catalog emitter never reads committed root
 * bytes, only the parsed `root`.
 *
 * `contentByDigest` mirrors `content_by_digest: dict[str, bytes]` exactly:
 * key = `` `${digest}.${ext}` `` (e.g. `"sha256:<hex>.json"`, `.md`, `.svg`,
 * `.png`) — a digest alone does not carry its extension, only the key a
 * `FilePort` directory listing discovers does. Unfiltered: unlike
 * `build_render_plan`, the catalog emitter never applies the reachability
 * filter itself — it only ever looks up specific digests (a live tag's
 * content, `desc.readme`, `desc.logo`) it already knows are live.
 */
export interface CatalogSourcePackage {
  readonly packageId: PackageId;
  readonly root: CatalogPackageRoot;
  readonly contentByDigest: Readonly<Record<string, Uint8Array>>;
  /** Mount prefix of the mirrored wire tree this package's own source was
   * written to (`build/sources_pipeline.ts`'s `wireBase`): `""` for the
   * `root: true` source, `index/<label>` for every other configured source.
   * `catalogEntry` builds `logoUrl`/`readmeUrl` through it, so a non-root
   * source's assets point at `/index/<label>/p/...` — the tree `mirror.ts`
   * actually wrote — rather than at the site root, where only the root
   * source's copy exists.
   *
   * Optional, defaulting to `""`: `extractPackages` reads one source's wire
   * tree and has no idea where that tree will be mounted, so it never sets
   * this. The two callers that DO know the placement (`sources_pipeline.ts`
   * for the merged catalog, `mirror.ts` for the per-source one) attach it
   * afterwards. */
  readonly wireBase?: string;
}

/**
 * One `/data/catalog/catalog.json` `packages[]` row. Ported from Python
 * `_catalog_entry`'s return shape (`core/render.py:211-265`) — field order
 * here IS the wire key order; `catalogIndex`/`serializeCatalog` must
 * preserve it (see `serializeCatalog`'s doc for why order matters).
 *
 * `variants` is TS-optional (not `T | null`) because it is OMITTED from the
 * JSON entirely when empty, never serialized as `[]` — an optional property
 * left `undefined` is exactly what `JSON.stringify` drops on its own. Every
 * other nullable field here serializes as an explicit JSON `null` and so is
 * typed `T | null`, never optional.
 */
export interface CatalogEntry {
  readonly namespace: string;
  readonly package: string;
  readonly name: string;
  readonly status: Status;
  readonly deprecatedMessage: string | null;
  readonly supersededBy: string | null;
  readonly created: string;
  readonly updated: string | null;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly latestVersion: string | null;
  readonly variants?: readonly string[];
  readonly tagCount: number;
  readonly platforms: readonly string[];
  readonly logoUrl: string | null;
  readonly readmeUrl: string | null;
}

/**
 * One configured index, as the catalog's own index-scope control sees it.
 * This package's own extension — no Python counterpart, see `catalogIndex`.
 */
export interface CatalogIndexInfo {
  /** The index's name: the single first `/`-segment its package names
   * carry, which `sources/labels.ts` also enforces its config label equals
   * (`LABEL_PREFIX_MISMATCH`). One name for one index, so the scope tab and
   * the qualified name printed on every card cannot disagree. */
  readonly name: string;
  /** This is the `root: true` source — the deployment's default index,
   * preselected on arrival, and the only one whose packages keep bare
   * `/<ns>/<pkg>` routes. At most one entry has it; a config with no root
   * source has none, and then the catalog opens on "all". */
  readonly root: boolean;
  /** Packages this index contributes to the MERGED catalog. */
  readonly count: number;
}

/**
 * `/data/catalog/catalog.json`'s envelope. Ported from Python
 * `_catalog_index` (`core/render.py:312-320`), plus this package's own
 * `indexes` extension.
 *
 * Field order IS the wire key order (see `serializeCatalog`): `generated`,
 * `indexes`, `packages`.
 *
 * `indexes` is optional-not-nullable, the same convention as
 * `CatalogEntry.variants` and for the same mechanical reason — an
 * `undefined` property is what `JSON.stringify` drops on its own. Optional
 * because a caller may have no indexes to state (the golden fixtures and
 * `mirror.ts` build a catalog straight off one reader), NOT because a
 * particular source count suppresses it: `sources_pipeline.ts` emits the
 * envelope for every catalog it resolves, one source included, since route
 * qualification depends on it.
 */
export interface Catalog {
  readonly generated: string | null;
  readonly indexes?: readonly CatalogIndexInfo[];
  readonly packages: readonly CatalogEntry[];
}

/**
 * Package DETAIL-page-only data (C-502, ADR Decision 4, 2026-08-22) — read
 * from `org.opencontainers.image.{licenses,source,revision}` on a live tag's
 * OCI image-index manifest `annotations`, when present. NOT ported from the
 * Python bot: `core/render.py` fetches these same image-index bytes for
 * `_catalog_platforms` but never reads `annotations` at all — a pure
 * renderer-side addition, no new wire field, no index write.
 *
 * Every field is TS-optional and OMITTED (never `null`/fabricated) when its
 * source annotation is absent — matches `CatalogEntry.variants`'s existing
 * "optional, not nullable" convention for exactly the same reason: an absent
 * annotation is not a knowable "no license", it is simply unreported.
 *
 * Deliberately no provenance/attestation boolean here (ADR Decision 4:
 * signature-verification provenance stays deferred) — this is a faithful
 * read-through of existing annotation text, nothing more. Never entered into
 * `/data/catalog/catalog.json` (C-503) — no `catalogIndex`/`catalogEntry`
 * caller reads this type.
 */
export interface CatalogPackageDetail {
  /** `org.opencontainers.image.licenses` verbatim (e.g. `"MIT OR Apache-2.0"`
   * — an SPDX expression string, not parsed/validated as one here). */
  readonly license?: string;
  /** `org.opencontainers.image.source` verbatim — the repository whose CI
   * produced this build. Publisher-controlled, untrusted text: a renderer
   * consuming this MUST run it through an href allowlist (`safeHref.ts`)
   * before rendering it as a link, same as any other wire-sourced URL. */
  readonly sourceRepository?: string;
  /** `org.opencontainers.image.revision` verbatim (e.g. a commit SHA). */
  readonly revision?: string;
}
