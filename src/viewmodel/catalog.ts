/**
 * `/data/catalog/catalog.json` view-model emitter — TS port surface of the
 * index bot's `core/render.py` catalog functions (`ocx-sh/index`,
 * `bot/src/indexbot/core/render.py` lines ~140-330). See that module's
 * docstrings for the full prose; JSDoc below restates the load-bearing
 * parts each function's future implementation needs.
 *
 * Python -> TS name mapping:
 *   - `_catalog_platforms`   -> `catalogPlatforms`
 *   - `_latest_activity`     -> `latestActivity`
 *   - `_catalog_entry`       -> `catalogEntry`
 *   - `_generated_timestamp` -> `generatedTimestamp`
 *   - `_catalog_index`       -> split into `catalogIndex` (builds the typed
 *     `Catalog` object) + `serializeCatalog` (the byte-exact write). Python
 *     fuses both into one `str`-returning function via
 *     `json.dumps(catalog, indent=2) + "\n"` at `core/render.py:320`.
 */

import { findLatestVersion, variantNames } from "./version_order.js";
import type {
  Catalog,
  CatalogEntry,
  CatalogPackageDetail,
  CatalogPackageRoot,
  CatalogSourcePackage,
} from "./types.js";

const textDecoder = new TextDecoder("utf-8");

/**
 * Ported from Python `_live_tag_content_digests` (`core/render.py:84-90`) —
 * one of the two callers the Python function serves (`_reachable_digests`,
 * the other, has no TS port surface here — the catalog emitter never prunes
 * CAS content). `catalogPlatforms` is this module's one TS caller. Order is
 * immaterial: only ever iterated as a set.
 */
function liveTagContentDigests(root: CatalogPackageRoot): ReadonlySet<string> {
  const digests = new Set<string>();
  for (const entry of Object.values(root.tags)) {
    if (entry.yanked === null) {
      digests.add(entry.content);
    }
  }
  return digests;
}

/**
 * Ported from Python `_split_content_key` (`core/render.py:112-115`):
 * `"sha256:<hex>.<ext>"` -> `["sha256:<hex>", "<ext>"]`, splitting on the
 * LAST `.` (`str.rpartition`). No `.` at all -> `["", key]`, mirroring
 * `rpartition`'s `("", "", key)` (digest="", ext=key) for that case.
 *
 * Branch-free on purpose, matching Python: `key.rpartition(".")` is one
 * unconditional call with no source-level `if`/`else` — the found/not-found
 * distinction lives inside the stdlib method, uninstrumented by branch
 * coverage. `Math.max(dotIndex, 0)` gets the same both-cases-at-once result
 * here: when `dotIndex` is `-1` (no `.` found), `slice(0, 0)` yields `""`
 * (matching rpartition's empty digest) and `slice(dotIndex + 1)` is
 * `slice(0)`, the whole key (matching rpartition's `ext = key`) — both for
 * free, no explicit conditional.
 */
function splitContentKey(key: string): readonly [digest: string, ext: string] {
  const dotIndex = key.lastIndexOf(".");
  return [key.slice(0, Math.max(dotIndex, 0)), key.slice(dotIndex + 1)];
}

/**
 * Ported from Python `_cas_ext_lookup` (`core/render.py:131-133`):
 * `digest -> ext`, from this package's actually-discovered CAS blob keys.
 * Later keys win on a digest collision, matching `dict()` construction over
 * an iterator (Python dict preserves insertion order; a later pair for the
 * same key overwrites the earlier one).
 */
function casExtLookup(contentByDigest: Readonly<Record<string, Uint8Array>>): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const key of Object.keys(contentByDigest)) {
    const [digest, ext] = splitContentKey(key);
    lookup.set(digest, ext);
  }
  return lookup;
}

// Exported: `walker.ts` reuses this same shape allowlist to validate a
// digest string BEFORE it's used to build a cache/wire path — the wire
// contract's digest shape is one thing, shared by every layer that joins a
// digest into a path, not re-derived per caller.
export const DIGEST_RE = /^sha256:[a-z0-9]{64}$/;
const EXT_RE = /^[a-z0-9]{1,16}$/;
// Namespace: one opaque path segment, per schema/root.schema.json's `name`
// pattern split at its `/` (`^ocx\.sh/`'s first segment). Package: per the
// settled depth semantics (plan C-003, 2026-08-22 WP-07 panel), the
// REMAINDER of that split — 1..N `/`-joined segments at depth >=3 — each
// validated against this SAME per-segment pattern (see `casRelpath`'s own
// loop); plan #716: package paths are opaque, never baked in as exactly one
// segment.
const NAMESPACE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const PACKAGE_RE = /^[a-z0-9]+((\.|_|__|-+)[a-z0-9]+)*$/;

/**
 * Ported from Python `cas_relpath` (`indexbot.core.validate_entry`):
 * `p/<namespace>/<package>/o/sha256/<hex>.<ext>` — `digest` is the full
 * `sha256:<hex>` string; only the hex half appears in the path.
 *
 * `digest`/`ext` are join-point inputs, not free-form text — this function
 * is the one place their bytes become a filesystem/URL path segment, so it
 * `fullmatch`-validates both before touching either, same discipline as
 * `quality-indexbot-security.md`'s "digest `re.fullmatch` before any path
 * join" bar. A `digest` carrying `../` or an `ext` carrying `"/><script>`
 * throws by name rather than producing a traversal path or corrupt URL.
 * This guard is *why* the unconditional `slice("sha256:".length)` below is
 * sound — not an appeal to what upstream is assumed to have already
 * checked.
 *
 * Both patterns are shape-only allowlists (fixed length + safe character
 * set), not "is this a real cryptographic digest" checks — that
 * verification is a different job, done elsewhere by hashing actual bytes
 * (Python `check_digest_self_consistent`). `DIGEST_RE` is `[a-z0-9]{64}`,
 * not the tighter `[a-f0-9]{64}` a real sha256 hex digest always satisfies:
 * every golden fixture ports the bot's own `_digest(letter)` test helper
 * (`f"sha256:{letter * 64}"`, `bot/tests/core/test_render.py:23-24`) for
 * placeholder digests, and three of the nine committed goldens
 * (`nested_namespace`, `normal`, `png_only_logo`) use a letter outside
 * `a-f` (`q`, `w`, `r`, `l`, `p`) for a `desc.logo`/`desc.readme` digest
 * that reaches this function. `[a-z0-9]{64}` accepts those placeholders
 * while still rejecting every character a traversal or injection payload
 * needs (`.`, `/`, `<`, `>`, `"`) at this exact fixed length — the same
 * security property as hex-only, just not literally hex, matching `EXT_RE`
 * being a character-class allowlist rather than a fixed enum of real
 * extensions.
 */
/**
 * Fullmatch-validates `namespace` and each `/`-joined segment of `pkg`
 * against the same shape allowlists `casRelpath` builds a filesystem/URL
 * path from — extracted so any OTHER caller that needs to know "is this
 * namespace/package pair safe to use as path segments" uses the IDENTICAL
 * rule rather than a re-derived one. Security panel finding (2026-08-22):
 * `walker.ts` builds wire paths directly from a REMOTE `/c/index.json`'s
 * own keys, which were previously never validated at all before being
 * joined into a local cache/dist path — this is the shared choke point that
 * closes that hole (and `casRelpath`'s own, pre-existing use) in one place.
 * `PACKAGE_RE` already rejects an empty string, so a `..`, leading/trailing,
 * or doubled `/` (any split producing an empty or `.`/`..` segment) throws
 * here too, not just a whole-package traversal payload. Throws naming the
 * offending segment.
 */
export function assertSafePackagePath(namespace: string, pkg: string): void {
  if (!NAMESPACE_RE.test(namespace)) {
    throw new Error(`malformed namespace segment: ${namespace}`);
  }
  for (const segment of pkg.split("/")) {
    if (!PACKAGE_RE.test(segment)) {
      throw new Error(`malformed package segment: ${pkg}`);
    }
  }
}

function casRelpath(namespace: string, pkg: string, digest: string, ext: string): string {
  assertSafePackagePath(namespace, pkg);
  if (!DIGEST_RE.test(digest)) {
    throw new Error(`malformed CAS digest: ${digest}`);
  }
  if (!EXT_RE.test(ext)) {
    throw new Error(`malformed CAS extension: ${ext}`);
  }
  const hexDigest = digest.slice("sha256:".length);
  return `p/${namespace}/${pkg}/o/sha256/${hexDigest}.${ext}`;
}

/**
 * Ported from Python `_cas_url` (`core/render.py:136-149`). `null` when no
 * digest is configured. A configured digest missing from `extLookup` is a
 * dangling reference — trusted away upstream (`check_no_dangling_references`,
 * G-15); this throws rather than silently degrading the entry, matching the
 * Python `KeyError` propagation this function's doc comment describes.
 */
function casUrl(
  namespace: string,
  pkg: string,
  digest: string | null,
  extLookup: ReadonlyMap<string, string>,
): string | null {
  if (digest === null) {
    return null;
  }
  const ext = extLookup.get(digest);
  if (ext === undefined) {
    throw new Error(`dangling CAS reference: digest ${digest} missing from contentByDigest`);
  }
  return "/" + casRelpath(namespace, pkg, digest, ext);
}

/**
 * Ported from Python `_catalog_platforms` (`core/render.py:152-193`).
 * `` `${os}/${architecture}` `` union across every LIVE (non-yanked) tag's
 * image index (`source.root.tags`), deduped + sorted.
 *
 * Each live tag's CAS bytes (`source.contentByDigest[\`${digest}.json\`]`)
 * are the registry's OCI image index verbatim — read `manifests[]` directly.
 * A descriptor contributes a platform only when it names one: `platform.os`
 * and `platform.architecture` both present as strings, `os !== "unknown"`
 * (ADR R4). Everything else is skipped: no `platform` key at all, a
 * `platform` that is not an object, one missing or mistyping either field,
 * and the `"os": "unknown"` attestation shape — these are the
 * referrer/attestation descriptors a real registry serves alongside the
 * runnable images (see the `attestation_descriptor` golden case).
 *
 * Untrusted-input posture, ported verbatim: `platform` is unvalidated
 * publisher-supplied JSON all the way to here — the upstream image-index
 * shape gate stops at each descriptor's `digest`. A malformed CAS blob, an
 * index with no `manifests` key, a live-tag digest missing from
 * `contentByDigest`, or a `manifests[]` entry that is not itself an object
 * should propagate as a parse/lookup failure, not be silently swallowed —
 * matching Python's `descriptor.get("platform")`, which raises
 * `AttributeError` on a non-dict descriptor rather than skipping it. Only
 * `platform` — one field *inside* an already-object descriptor — gets the
 * lenient "skip, don't throw" treatment described above.
 */
export function catalogPlatforms(source: CatalogSourcePackage): readonly string[] {
  const platforms = new Set<string>();
  for (const digest of liveTagContentDigests(source.root)) {
    const bytes = source.contentByDigest[`${digest}.json`];
    if (bytes === undefined) {
      throw new Error(`live tag digest ${digest} missing from contentByDigest`);
    }
    const index = JSON.parse(textDecoder.decode(bytes)) as { manifests?: unknown };
    if (!Array.isArray(index.manifests)) {
      throw new Error(`image index for digest ${digest} has no manifests array`);
    }
    for (const descriptor of index.manifests as readonly unknown[]) {
      if (typeof descriptor !== "object" || descriptor === null || Array.isArray(descriptor)) {
        throw new Error(`manifest descriptor for digest ${digest} is not an object`);
      }
      const platform = (descriptor as { platform?: unknown }).platform;
      if (typeof platform !== "object" || platform === null || Array.isArray(platform)) {
        continue;
      }
      const fields = platform as Record<string, unknown>;
      const osName = fields["os"];
      const arch = fields["architecture"];
      if (typeof osName !== "string" || typeof arch !== "string" || osName === "unknown") {
        continue;
      }
      platforms.add(`${osName}/${arch}`);
    }
  }
  return Array.from(platforms).sort();
}

/**
 * Ported from Python `_latest_activity` (`core/render.py:196-208`).
 * Lexicographic max over `root.tags`' `observed` values plus every yanked
 * tag's `yanked.at` — relies on the Z-anchored, fixed-width UTC timestamp
 * invariant (`schema/root.schema.json`) making lexicographic order equal
 * chronological order; never itself validates that shape (enforced
 * upstream). `null` when `root.tags` is empty.
 */
export function latestActivity(root: CatalogPackageRoot): string | null {
  const timestamps: string[] = [];
  for (const entry of Object.values(root.tags)) {
    timestamps.push(entry.observed);
    if (entry.yanked !== null) {
      timestamps.push(entry.yanked.at);
    }
  }
  return lexicographicMax(timestamps);
}

/** Ported from Python's `max(strings, default=None)` — lexicographic string max, `null` for an empty list. */
function lexicographicMax(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((max, value) => (value > max ? value : max));
}

/**
 * Ported from Python `_catalog_entry` (`core/render.py:211-265`). One
 * `/data/catalog/catalog.json` `packages[]` row — see `CatalogEntry`'s doc
 * comment for the exact field list/order.
 *
 * `variants` is DERIVED here from `source.root.tags` via `variantNames`
 * (`version_order.ts`) — computed over ALL tags, yanked included (matching
 * the upstream PR-gate's own derivation), and set on the returned object
 * only when non-empty (`CatalogEntry.variants` is optional for exactly this
 * reason — omitted, never `[]`). `latestVersion` (`findLatestVersion`)
 * deliberately skips variant-prefixed tags, which is why `variants` exists
 * as a separate key: without it the grid could not tell a package that
 * ships variants from one that does not.
 *
 * `logoUrl`/`readmeUrl`: `null` when `source.root.desc` is `null` or the
 * respective digest is unset; otherwise
 * `` `/p/${namespace}/${package}/o/sha256/${hex}.${ext}` `` where `hex` is
 * the digest with its `sha256:` prefix stripped and `ext` is looked up from
 * `source.contentByDigest`'s own keys (format `` `${digest}.${ext}` `` —
 * see `CatalogSourcePackage.contentByDigest`'s doc). A configured digest
 * missing from `contentByDigest` is a dangling reference the bot's upstream
 * validation gate (`check_no_dangling_references`) rejects before render
 * ever runs — trust that invariant rather than degrading the entry.
 */
export function catalogEntry(source: CatalogSourcePackage): CatalogEntry {
  const { namespace, package: pkg } = source.packageId;
  const root = source.root;
  const desc = root.desc;
  const liveTagCount = Object.values(root.tags).filter((entry) => entry.yanked === null).length;
  const extLookup = casExtLookup(source.contentByDigest);
  const logoDigest = desc !== null ? desc.logo : null;
  const readmeDigest = desc !== null ? desc.readme : null;
  const derivedVariants = variantNames(Object.keys(root.tags));

  return {
    namespace,
    package: pkg,
    name: root.name,
    status: root.status,
    deprecatedMessage: root.deprecatedMessage,
    supersededBy: root.supersededBy,
    created: root.created,
    updated: latestActivity(root),
    title: desc !== null ? desc.title : root.name,
    description: desc !== null ? desc.description : "",
    keywords: desc !== null ? desc.keywords : [],
    latestVersion: findLatestVersion(root.tags),
    ...(derivedVariants.length > 0 ? { variants: derivedVariants } : {}),
    tagCount: liveTagCount,
    platforms: catalogPlatforms(source),
    logoUrl: casUrl(namespace, pkg, logoDigest, extLookup),
    readmeUrl: casUrl(namespace, pkg, readmeDigest, extLookup),
  };
}

/**
 * Ported from Python `_generated_timestamp` (`core/render.py:268-290`).
 * `/data/catalog/catalog.json`'s `generated` field: the lexicographic
 * string max of `latestActivity(source.root)` across every `source` in
 * `ordered`, skipping packages with no activity. `null` when no package has
 * ever carried a tag. Relies on the same Z-anchored fixed-width timestamp
 * invariant as `latestActivity` — no date parsing anywhere in this module,
 * so a render stays idempotent regardless of wall clock.
 */
export function generatedTimestamp(ordered: readonly CatalogSourcePackage[]): string | null {
  const timestamps: string[] = [];
  for (const source of ordered) {
    const activity = latestActivity(source.root);
    if (activity !== null) {
      timestamps.push(activity);
    }
  }
  return lexicographicMax(timestamps);
}

/**
 * Ported from Python `_catalog_index` (`core/render.py:312-320`,
 * object-building half only — see `serializeCatalog` for the byte-exact
 * write half). Builds the typed `Catalog` envelope: `generated` +
 * `packages[]`, packages in the same order as `ordered`. `build_render_plan`
 * upstream sorts `ordered` by package id before calling this — this
 * function does not itself sort.
 */
export function catalogIndex(ordered: readonly CatalogSourcePackage[]): Catalog {
  return {
    generated: generatedTimestamp(ordered),
    packages: ordered.map((source) => catalogEntry(source)),
  };
}

/**
 * The byte-exact write half of Python's `_catalog_index`
 * (`core/render.py:320`: `` json.dumps(catalog, indent=2) + "\n" ``) — NOT
 * wire contract (`CONTRACTS.md` §8, `product-context.md`), but this
 * function's OUTPUT MUST still be byte-identical to the Python bot's for the
 * same `Catalog` value, since this package's render output is compared
 * against (and may eventually replace) the bot's.
 *
 * Three things `JSON.stringify(catalog, null, 2) + "\n"` gets right for free
 * and one it gets WRONG:
 *   - 2-space indent: matches `indent=2`.
 *   - Insertion-order keys, never alphabetized: matches Python's
 *     `sort_keys=False` default — PROVIDED the `Catalog`/`CatalogEntry`
 *     object passed in was built with fields in the exact order
 *     `CatalogEntry`'s doc comment lists (`catalogEntry`'s responsibility,
 *     not this function's).
 *   - Trailing newline: this function must append it itself — Python's
 *     `+ "\n"` is explicit, `json.dumps` does not add one on its own either.
 *   - WRONG: `ensure_ascii`. Python's `json.dumps` defaults to
 *     `ensure_ascii=True` — every non-ASCII UTF-16 code unit (codepoint
 *     >= 0x80; an astral character as its two surrogate units individually)
 *     serializes as a lowercase `\uXXXX` escape. Plain `JSON.stringify`
 *     passes non-ASCII straight through as raw UTF-8 bytes instead. A
 *     `title`/`description`/`keywords` entry containing non-ASCII text (a
 *     package description in Cyrillic, an emoji keyword, ...) will
 *     byte-diverge from the Python bot's output unless this function
 *     escapes those code units itself before returning.
 */
export function serializeCatalog(catalog: Catalog): string {
  return ensureAsciiEscape(JSON.stringify(catalog, null, 2)) + "\n";
}

/**
 * Post-processes `JSON.stringify`'s output to match Python's
 * `json.dumps(..., ensure_ascii=True)` (the default) escaping.
 *
 * Why walking the WHOLE output string is safe, not just "inside strings":
 * every JSON structural character (`{}[]:,` and the quote/whitespace/indent
 * around them) is itself printable ASCII, and `JSON.stringify` has already
 * turned every control character and every `"`/`\` inside string content
 * into an ASCII-only escape sequence (`\n`, `\t`, `\"`, ``, ...)
 * *before* this function ever sees the text. So the only code units left
 * above the ASCII range are non-ASCII characters that were themselves part
 * of a string's actual content — there is no JSON syntax position a
 * non-ASCII code unit could occupy. Escaping every code unit outside
 * printable ASCII, wherever it appears in the string, therefore can never
 * mangle structure or double-escape something `JSON.stringify` already
 * escaped (those are already ASCII and pass through untouched).
 *
 * Python's ASCII-safe range is `\x20`-`\x7e` (its `ESCAPE_ASCII` regex:
 * `[^\ -~]` in addition to `"`/`\`, which `JSON.stringify` already
 * escapes) — one wider than "just codepoints >= 0x80": `\x7f` (DEL) is
 * escaped too. This function additionally exempts the raw `\x0a` newline
 * that `JSON.stringify(x, null, 2)` inserts between elements — that byte
 * never occurs inside string content (see above), only as indent
 * formatting, so it must pass through unescaped for the multi-line shape
 * to survive at all. Escaping happens per UTF-16 code unit, not per
 * codepoint, so an astral character's two surrogate halves are escaped
 * independently — matching Python's own per-code-unit walk (`json.dumps`
 * treats the string as UTF-16 code units under `ensure_ascii`, same as the
 * two-`\u` output a surrogate pair produces here).
 */
function ensureAsciiEscape(jsonText: string): string {
  let out = "";
  for (let i = 0; i < jsonText.length; i++) {
    const code = jsonText.charCodeAt(i);
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) {
      out += jsonText[i];
    } else {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detail-page-only additions (C-501/C-502/C-503, ADR Decision 4, 2026-08-22
// WP5). Everything below is new renderer capability, not a Python port, and
// is DELIBERATELY never called by `catalogEntry`/`catalogIndex` above — the
// boundary that keeps `/data/catalog/catalog.json` byte-stable (C-503).
// ---------------------------------------------------------------------------

const LICENSE_ANNOTATION = "org.opencontainers.image.licenses";
const SOURCE_ANNOTATION = "org.opencontainers.image.source";
const REVISION_ANNOTATION = "org.opencontainers.image.revision";

/**
 * Reads one OCI annotation key off an already-parsed `annotations` object.
 * Absent key -> `undefined`: a real, spec-legal case (OCI `annotations` is
 * an open, optional string map — not every build embeds every key). Present
 * but not a string -> throws naming the digest and key: the OCI image-spec
 * defines `annotations` as `map[string]string`, so a non-string value there
 * is a wire-contract violation to REPORT, never silently coerce or drop
 * (contrast `catalogPlatforms`'s lenient treatment of a missing/malformed
 * `platform` object, which the image-index schema documents as a legitimate,
 * expected shape for an attestation/referrer descriptor — an annotation
 * value of the wrong type has no such documented meaning).
 */
function readAnnotation(annotations: Readonly<Record<string, unknown>>, key: string, digest: string): string | undefined {
  const value = annotations[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`annotation "${key}" for digest ${digest} is present but not a string`);
  }
  return value;
}

/**
 * Reads `org.opencontainers.image.{licenses,source,revision}` off ONE
 * already-parsed image-index object's `annotations` (C-600).
 *
 * Its one shipped caller is the theme's client-side `useImageIndex.ts`
 * composable, which fetches exactly one image index at a time (whichever tag
 * is currently active/hovered) over HTTP and wraps this in a
 * malformed-degrades-to-`{}` guard — a decoration field must never take the
 * detail page down. It lives here, in the viewmodel, rather than in the
 * composable so the wire-shape validation rules below stay in the module
 * that owns every other wire read; a second hand-rolled annotation parser in
 * the theme is exactly the drift class `subsystem-theme.md` warns about.
 *
 * An index carrying no `annotations` key at all returns `{}` (spec-legal:
 * `annotations` itself is optional) — this is NOT the same as "malformed";
 * only a PRESENT `annotations` that isn't an object at all is rejected as
 * malformed (throws naming `digest`), mirroring `validateRootShape`'s
 * "guard exactly what's dereferenced" discipline. A missing/non-string
 * individual annotation value likewise throws naming `digest` and the key
 * (via `readAnnotation`).
 */
export function readImageIndexAnnotations(index: { annotations?: unknown }, digest: string): CatalogPackageDetail {
  const annotations = index.annotations;
  if (annotations === undefined) {
    return {};
  }
  if (typeof annotations !== "object" || annotations === null || Array.isArray(annotations)) {
    throw new Error(`image index for digest ${digest} has a malformed "annotations" value`);
  }
  const fields = annotations as Record<string, unknown>;
  const license = readAnnotation(fields, LICENSE_ANNOTATION, digest);
  const sourceRepository = readAnnotation(fields, SOURCE_ANNOTATION, digest);
  const revision = readAnnotation(fields, REVISION_ANNOTATION, digest);
  return {
    ...(license !== undefined ? { license } : {}),
    ...(sourceRepository !== undefined ? { sourceRepository } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

