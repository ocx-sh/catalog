/**
 * Type surface for the catalog source-reading layer (C-003) and the
 * mirror/serve layer (C-006). `path.ts`/`walker.ts`/`git.ts` each read one
 * configured `SourceEntry` (`config/types.ts`) into a wire-path-keyed byte
 * map; `labels.ts` resolves that source's final display label; `mirror.ts`
 * copies the result byte-verbatim into the build's `dist/` tree and emits
 * the per-source `/data/catalog/catalog.json` + `_headers`.
 */

import type { CatalogPackageRoot, CatalogSourcePackage, TagEntry } from "../viewmodel/types.js";

/**
 * A wire-contract-relative path INSIDE one source's own tree: `"config.json"`,
 * `"c/index.json"`, or anything under `"p/"` — a package root
 * (`"p/<opaque path>.json"`) or one of its CAS/desc blobs
 * (`"p/<opaque path>/o/sha256/<hex>.<ext>"`), per `product-context.md`'s
 * four frozen URL shapes. No leading slash, forward slashes only, POSIX-
 * relative — this is a `Map` key, not a filesystem or URL path; each reader
 * translates its own on-disk/remote layout into this shape.
 *
 * `<opaque path>` is 1..N `/`-separated segments — NEVER assumed to be
 * exactly `<namespace>/<package>` anywhere in this package
 * ([ocx-sh/index#716](https://github.com/ocx-sh/index/issues/716)); only
 * `viewmodel/catalog.ts`'s `NAMESPACE_RE`/`PACKAGE_RE` (at CAS-path-build
 * time, on already-split segments) constrain segment shape, and only for
 * the current 2-segment schema this repo happens to publish today.
 */
export type WirePath = string;

/**
 * One source's complete wire tree, byte-verbatim as read from `path` | `url`
 * | `git`, plus its FINAL resolved label (see `labels.ts` — never `null`
 * here, unlike `config/types.ts` `ResolvedSource.label`). This is the C-003
 * contract's stated output: `mirror.ts` and the build engine (C-005/WP-06)
 * each consume one `SourceFiles` per configured `sources[]` entry.
 *
 * `files` NEVER includes derived artifacts — `catalog.json` is not a
 * member. It is produced separately, from `files`, by
 * `viewmodel/catalog.ts`'s `catalogIndex`/`serializeCatalog` (see
 * `extractPackages` below and `mirror.ts`'s per-source placement), and is
 * not part of any source's own wire tree.
 *
 * `files` is also already FILTERED to the wire-contract shape (`config.json`,
 * `c/index.json`, everything under `p/`) — a `path`/`git` source root is
 * very often a full repository checkout, not a hand-curated export, so a
 * reader that copied its ENTIRE directory tree indiscriminately would leak
 * `.git/` internals, `node_modules/`, unrelated docs, etc. into the public
 * `dist/index/<label>/` mirror (`mirror.ts` never re-filters — see
 * `path.ts`'s `readDirectoryTree`).
 */
export interface SourceFiles {
  readonly label: string;
  readonly files: ReadonlyMap<WirePath, Uint8Array>;
}

/**
 * `SourceFiles` plus whether its config entry set `root: true`
 * (`config/types.ts` `SourceEntryCommon.root`) — the one piece of config
 * context `mirror.ts` needs per source beyond the fetched bytes themselves,
 * so it can build the flat list `mirror.ts` consumes without the caller
 * having to zip two parallel arrays (`LoadedConfig.sources` and a
 * `SourceFiles[]`) by index. At most one entry in a `ResolvedSourceFiles[]`
 * may have `root: true` — already enforced by `loadConfig`'s
 * `MULTIPLE_ROOT` check; `mirror.ts` trusts that invariant rather than
 * re-checking it.
 */
export interface ResolvedSourceFiles extends SourceFiles {
  readonly root: boolean;
}

/**
 * Reports a non-fatal condition a source reader discovered but that must
 * never be silently swallowed — currently only `git.ts`'s `.gitmodules`
 * warning (submodules are a non-goal: the file is excluded from the
 * returned wire tree, per `SourceFiles`'s doc, but its presence still must
 * reach the caller by name rather than manifesting as silent empty data).
 * Callers decide how to surface it (CLI stderr, a collected list for `dev`
 * mode, ...) — this module never writes to `process.stderr` itself.
 */
export type SourceWarning = (message: string) => void;

/** Stable failure modes the source-reading layer (`path.ts`/`walker.ts`/
 * `git.ts`/`labels.ts`) can raise. Distinct from `config/errors.ts`
 * `ConfigErrorCode`, which is documented as scoped to `loadConfig` only —
 * see `labels.ts`'s `checkLabelConflicts` doc for why `LABEL_CONFLICT`
 * exists in BOTH unions rather than this layer importing `ConfigError`. */
export type SourceErrorCode =
  /** `path.ts`: a file's realpath resolves outside its source root's
   * realpath — a symlink escape `loadConfig`'s LEXICAL-only containment
   * check cannot see (see that check's own doc comment in `config/load.ts`). */
  | "PATH_ESCAPE"
  /** `walker.ts`: a source URL stayed unreachable after exhausting the 3
   * retries with exponential backoff (S-002: the CLI maps this to exit 69,
   * naming the source + the last HTTP status or network error). */
  | "FETCH_FAILED"
  /** `walker.ts`: a fetched file's bytes don't hash to the digest the
   * caller verified it against (a root vs its `/c/index.json` entry, or a
   * CAS blob vs its own path hex) — names the file plus BOTH digests. */
  | "DIGEST_MISMATCH"
  /** `git.ts`: a commit-SHA `ref` was requested but the remote lacks the
   * `allow-tips-sha1-in-want`/SHA-in-want capability needed to fetch an
   * arbitrary commit directly. */
  | "GIT_SHA_UNSUPPORTED"
  /** `git.ts`: a sourced blob is a Git LFS pointer file (its content starts
   * `version https://git-lfs.github.com/spec`), not the real object — never
   * silently served as a broken logo/readme in production. */
  | "LFS_POINTER"
  /** `labels.ts`: a source declared no explicit `label` and its own package
   * roots yield no name to derive one from (an empty source — zero `p/**`
   * roots present in its `files`). */
  | "LABEL_DERIVATION_EMPTY"
  /** `labels.ts`: a source declared no explicit `label` and its own package
   * roots' `name` values disagree on their first `/`-segment — there is no
   * single prefix to derive. */
  | "LABEL_DERIVATION_CONFLICT"
  /** `labels.ts`: two sources — of any mix of explicit and derived origin —
   * resolve to the same final label. Re-checks, with strictly more
   * information, the same real-world mistake `config/errors.ts`
   * `ConfigError`'s `LABEL_CONFLICT` already guards pairwise-explicit-only
   * at `loadConfig` time. */
  | "LABEL_CONFLICT"
  /** `labels.ts`: a resolved label (explicit or derived) isn't safe to use
   * as exactly one filesystem path segment under `dist/index/<label>/`. */
  | "LABEL_PATH_UNSAFE";

/**
 * Raised by the source-reading layer for any failure listed in
 * `SourceErrorCode`. `message` always names the offending source (its
 * config index or url/path/git identifier), and — for `DIGEST_MISMATCH` —
 * the file plus both digests, so the CLI can print it directly without
 * further lookup, mirroring `config/errors.ts` `ConfigError`'s contract.
 */
export class SourceError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.name = "SourceError";
    this.code = code;
  }
}

/**
 * Parses every package-root wire file found in `files` into a
 * `CatalogSourcePackage` (`viewmodel/types.ts`) — the shape C-004's
 * `catalogIndex`/`catalogEntry` consume, and the shape `labels.ts` reads
 * `root.name` off for prefix derivation. Shared by both callers so the
 * "which wire paths are package roots, and which CAS blobs belong to which
 * package" parsing exists exactly once (quality-core.md DRY: 2 genuine
 * callers, non-trivial shared logic).
 *
 * A package-root wire file is any `files` key matching `p/<opaque>.json`
 * whose `<opaque>` segment sequence does NOT itself end in the CAS control
 * suffix `o/sha256/<hex>` — CAS image indices also end in `.json` and live
 * at exactly that suffix, so they must never be misidentified as roots.
 * `<opaque>` is `WirePath`'s 1..N `/`-separated segments after `p/`; this
 * function never assumes exactly two. `packageId.namespace` is
 * `<opaque>`'s first segment; `packageId.package` is everything after that
 * first segment's `/`, kept VERBATIM — itself possibly containing further
 * `/`s for an N-deep name, per [#716]. This function does not itself
 * validate either segment against `viewmodel/catalog.ts`'s
 * `NAMESPACE_RE`/`PACKAGE_RE` — a malformed segment surfaces there, at
 * CAS-path-build time, not here.
 *
 * Depth semantics (settled 2026-08-22, WP-07 panel): a depth-1 `<opaque>`
 * (no `/` at all — `p/name.json`) has no remainder to be `packageId.package`
 * and is NOT representable in the catalog view model's `{namespace,
 * package}` split; rejected with a named error identifying the path rather
 * than silently mis-splitting one. `root.name` must also agree with the
 * wire path it came from: everything AFTER `name`'s own first `/`-segment
 * (its brand token, `"ocx.sh"` on this repo's own schema, but never
 * hardcoded as that literal — see the S-008 check's own comment for why)
 * must equal `<namespace>/<package>` as derived from the path — mismatch is
 * rejected naming BOTH the offending name and the path (S-008: never a
 * half-rendered page from a root that claims a different identity than
 * where it was found).
 *
 * `contentByDigest` for a given root is built ONLY from `files` entries
 * under that root's OWN CAS subtree, `p/<same opaque>/o/sha256/**`, keyed
 * `` `${digest}.${ext}` `` exactly as `CatalogSourcePackage.contentByDigest`
 * documents (`digest` reconstructed as `sha256:<hex>` from the filename
 * stem, `ext` from the filename's own extension) — never the whole
 * source's `files` map, so two packages' same-named CAS files never
 * collide across packages.
 *
 * Wire field mapping (root JSON is snake_case per `schema/root.schema.json`;
 * `CatalogPackageRoot` is camelCase): `deprecated_message` -> always present
 * -> `deprecatedMessage` verbatim; `superseded_by` -> ABSENT when unset ->
 * `supersededBy: null`; `repository` -> ABSENT when unset -> `repository:
 * null` (C-501 — detail-page data only, `catalogEntry` never reads it, so it
 * never reaches `/data/catalog/catalog.json`, C-503); `desc` -> JSON `null`
 * -> `desc: null` (its own `readme`/`logo` are each ABSENT when unset ->
 * `null`); each `tags[*]`'s `yanked` -> ABSENT when unset -> `null`.
 *
 * Unparseable JSON propagates as a `JSON.parse` failure, wrapped naming the
 * file. A parseable-but-schema-invalid root (a field this function
 * dereferences is missing or the wrong type) is caught by
 * `validateRootShape` below and rejected naming the file AND the specific
 * field — never a raw property-access crash a few frames deeper. This is
 * still not a validator for `schema/root.schema.json` as a whole (full
 * shape validation is the announce/governance surface's job, not the
 * catalog layer's) — only the handful of fields this module actually reads
 * without a null/type check of its own.
 */
const textDecoder = new TextDecoder("utf-8");

/** `p/<opaque>.json` whose `<opaque>` itself ends in the CAS control suffix
 * `o/sha256/<hex>` — see this function's doc comment for why that shape must
 * never be misidentified as a package root. */
const CAS_SUFFIX_RE = /\/o\/sha256\/[^/]+$/;

interface RawTagEntry {
  content: string;
  observed: string;
  yanked?: { reason: string; at: string };
}

interface RawDesc {
  title: string;
  description: string;
  keywords: string[];
  readme?: string;
  logo?: string;
}

interface RawRoot {
  name: string;
  status: "active" | "deprecated" | "yanked";
  deprecated_message?: string | null;
  superseded_by?: string;
  /** Physical OCI repository this entry points to, `oci://<host>/<path>`
   * (`schema/root.schema.json`) — required on the wire, but kept optional
   * here like `superseded_by`: `mapRoot` copies it through with `??`, never
   * dereferences it unconditionally, so a root missing it (a hand-authored
   * fixture, a non-conformant source) degrades to `null` rather than
   * crashing (C-501: report, never invent). */
  repository?: string;
  created: string;
  desc: RawDesc | null;
  tags: Record<string, RawTagEntry>;
}

/**
 * Field mapping only — this is where `RawRoot`'s snake_case wire shape
 * becomes `CatalogPackageRoot`'s camelCase shape (see this file's own doc
 * comment for the exact field-by-field rules). Deliberately no manual
 * presence checks beyond what's written here: a field this function reads
 * off `parsed` that's missing on the wire (e.g. `tags` absent entirely)
 * fails via a natural property-access/iteration error (`Object.entries`
 * on `undefined` throws) rather than a hand-rolled validation branch —
 * `extractPackages`'s own doc comment is explicit that shape validation is
 * NOT this layer's job.
 */
/**
 * Guards exactly the `RawRoot` fields `mapRoot` (and, for `name`, the S-008
 * check right after it in `extractPackages`) dereference WITHOUT a null/type
 * check of their own: `desc.title`/`.description`/`.keywords` need `desc`
 * present and an object; `Object.entries(tags)` and each `entry.content`/
 * `.observed`/`.yanked` need `tags` an object of objects; `name.indexOf`
 * needs `name` a string. Every other field mapRoot reads (`status`,
 * `deprecated_message`, `superseded_by`, `created`) is copied through with
 * `??`/direct assignment and never crashes on a wrong type, so it is
 * deliberately NOT checked here — this is the crash class, not a schema
 * validator (see this file's own doc comment above).
 *
 * Throws a plain `Error` (not `SourceError`) to match this module's existing
 * split: `SourceErrorCode` is documented as scoped to `path.ts`/`walker.ts`/
 * `git.ts`/`labels.ts`, and `build/sources_pipeline.ts`'s error-mapping doc
 * already calls a malformed root a "plain parse failure" — this keeps that
 * one failure mode, one error type.
 */
function validateRootShape(path: WirePath, parsed: unknown): asserts parsed is RawRoot {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`malformed root at ${path}: expected a JSON object at the top level`);
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.name !== "string") {
    throw new Error(`malformed root at ${path}: "name" is required and must be a string`);
  }

  if (obj.desc !== null) {
    // `obj.desc === null` is already excluded by the guard above — checking
    // it again here would be a dead, never-true branch (100% branch
    // coverage gate would fail on it).
    if (typeof obj.desc !== "object" || Array.isArray(obj.desc)) {
      throw new Error(`malformed root at ${path}: "desc" is required and must be null or an object`);
    }
    const desc = obj.desc as Record<string, unknown>;
    if (typeof desc.title !== "string") {
      throw new Error(`malformed root at ${path}: "desc.title" is required and must be a string`);
    }
    if (typeof desc.description !== "string") {
      throw new Error(`malformed root at ${path}: "desc.description" is required and must be a string`);
    }
    if (!Array.isArray(desc.keywords)) {
      throw new Error(`malformed root at ${path}: "desc.keywords" is required and must be an array`);
    }
  }

  if (typeof obj.tags !== "object" || obj.tags === null || Array.isArray(obj.tags)) {
    throw new Error(`malformed root at ${path}: "tags" is required and must be an object`);
  }
  for (const [tag, entry] of Object.entries(obj.tags as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`malformed root at ${path}: tags["${tag}"] is required and must be an object`);
    }
  }
}

function mapRoot(parsed: RawRoot): CatalogPackageRoot {
  const descRaw = parsed.desc;
  const desc =
    descRaw === null
      ? null
      : {
          title: descRaw.title,
          description: descRaw.description,
          keywords: descRaw.keywords,
          readme: descRaw.readme ?? null,
          logo: descRaw.logo ?? null,
        };

  // Security panel (2026-08-22, S2): `Object.create(null)`, not `{}`. Tag
  // names are REMOTE data, and `JSON.parse` makes `__proto__` a real own
  // property — so `tags["__proto__"] = entry` on an ordinary object literal
  // routes through `Object.prototype`'s `__proto__` setter, silently
  // swapping the prototype instead of adding a key. The tag then vanishes
  // from the catalog rather than rendering; a YANKED tag disappearing is the
  // case that matters. A null-prototype object has no such setter, and every
  // consumer of `tags` reads it via `Object.entries`/`Object.keys`/
  // `Object.values`/index access, none of which need the prototype.
  const tags: Record<string, TagEntry> = Object.create(null) as Record<string, TagEntry>;
  for (const [tag, entry] of Object.entries(parsed.tags)) {
    tags[tag] = {
      content: entry.content,
      observed: entry.observed,
      yanked: entry.yanked ?? null,
    };
  }

  return {
    name: parsed.name,
    status: parsed.status,
    deprecatedMessage: parsed.deprecated_message ?? null,
    supersededBy: parsed.superseded_by ?? null,
    repository: parsed.repository ?? null,
    created: parsed.created,
    desc,
    tags,
  };
}

export function extractPackages(files: ReadonlyMap<WirePath, Uint8Array>): readonly CatalogSourcePackage[] {
  const packages: CatalogSourcePackage[] = [];

  for (const [path, bytes] of files) {
    if (!path.startsWith("p/") || !path.endsWith(".json")) continue;
    const opaque = path.slice("p/".length, -".json".length);
    if (CAS_SUFFIX_RE.test(opaque)) continue; // a CAS image index, not a root

    // namespace = FIRST segment, package = the REMAINDER (itself possibly
    // `/`-joined at depth >=3) — the settled depth semantics (plan C-003,
    // 2026-08-22 WP-07 panel). A depth-1 path (`indexOf` finds no `/`) has
    // no remainder to be a package: the catalog view model's `PackageId`
    // carries separate namespace/package fields and cannot represent one,
    // so this is rejected by name rather than silently garbled (previously:
    // an unchecked `slice(0, -1)` dropped the namespace's last character).
    const slashIndex = opaque.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(
        `depth-1 package path is not representable in the catalog view model (needs namespace/package, got one segment): ${path}`,
      );
    }
    const namespace = opaque.slice(0, slashIndex);
    const pkg = opaque.slice(slashIndex + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(bytes));
    } catch (err) {
      throw new Error(`malformed root at ${path}: ${(err as Error).message}`);
    }
    validateRootShape(path, parsed);
    const root: CatalogPackageRoot = mapRoot(parsed);

    // S-008: the root's own `name` must agree with the wire path it was
    // read from — everything AFTER `name`'s own first `/`-segment (its
    // brand token, `"ocx.sh"` on this repo's own schema) must equal
    // `<namespace>/<package>` as derived from the path. Deliberately
    // brand-AGNOSTIC, not a hardcoded `ocx.sh/` prefix: `labels.ts`'s own
    // derivation reads this same field for a forked/corporate schema whose
    // brand token is anything else (its own doc comment: "a forked schema
    // ... is not this module's to trust") — S-008 only cares that the
    // namespace/package PORTION matches where the root was actually found,
    // never what the brand token itself says. Never render half a page off
    // a name that doesn't match where it was actually found.
    const nameSlashIndex = root.name.indexOf("/");
    const nameRemainder = nameSlashIndex === -1 ? "" : root.name.slice(nameSlashIndex + 1);
    const expectedRemainder = `${namespace}/${pkg}`;
    if (nameRemainder !== expectedRemainder) {
      throw new Error(
        `root name "${root.name}" does not match its wire path "${path}" (expected "<brand>/${expectedRemainder}")`,
      );
    }

    const contentByDigest: Record<string, Uint8Array> = {};
    const casPrefix = `p/${opaque}/o/sha256/`;
    for (const [casPath, casBytes] of files) {
      if (!casPath.startsWith(casPrefix)) continue;
      const filename = casPath.slice(casPrefix.length);
      const dotIndex = filename.lastIndexOf(".");
      const hex = filename.slice(0, Math.max(dotIndex, 0));
      const ext = filename.slice(dotIndex + 1);
      contentByDigest[`sha256:${hex}.${ext}`] = casBytes;
    }

    packages.push({ packageId: { namespace, package: pkg }, root, contentByDigest });
  }

  return packages;
}
