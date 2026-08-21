/**
 * Catalog view-model types — TS port surface of the fields the index bot's
 * `core/render.py` catalog functions (`_catalog_platforms`, `_latest_activity`,
 * `_catalog_entry`, `_generated_timestamp`, `_catalog_index`) read from
 * `indexbot.model` and produce for `/data/catalog/catalog.json`.
 *
 * These are catalog-scoped SUBSETS, not full ports of the bot's dataclasses:
 * fields the catalog emitter never reads (`repository`, `owners`, `upstream`,
 * `source`, the vestigial `variants` root field, `desc.digest`, `root_raw`)
 * are omitted. See `bot/src/indexbot/model.py` for the full wire-facing
 * shapes.
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
 * `/data/catalog/catalog.json`'s envelope. Ported from Python
 * `_catalog_index` (`core/render.py:312-320`).
 */
export interface Catalog {
  readonly generated: string | null;
  readonly packages: readonly CatalogEntry[];
}
