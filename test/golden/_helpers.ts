/**
 * Shared builders for `test/golden/<case>/input.ts` — TS transcription of
 * the helper functions `bot/tests/core/test_render.py` uses to build its
 * `_case_*()` Python literals (`_digest`, `_descriptor`, `_index_of`,
 * `_index_bytes`). Every `test/golden/<case>/input.ts` module is the TS
 * equivalent of one `_case_*()` function from that file, restricted to the
 * catalog-scoped `CatalogSourcePackage` fields (see
 * `src/viewmodel/types.ts`) — the bot's Python fixtures build a full
 * `SourcePackage` (including `root_raw`, `repository`, `owners`, ...) that
 * this package's catalog emitter never reads.
 *
 * Not itself a test file (no `describe`/`it`) — vitest's default include
 * glob only picks up `*.test.ts`/`*.spec.ts`, so this and every
 * `input.ts` are plain fixture data, collected by whichever
 * `*.test.ts` the testing phase writes to consume them.
 */

/** `sha256:<hex>` from a single repeated letter — ported from Python
 * `_digest` (`test_render.py:23-24`). */
export function digest(letter: string): string {
  return `sha256:${letter.repeat(64)}`;
}

const INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";

export const DEFAULT_PLATFORM: Readonly<Record<string, string>> = {
  architecture: "amd64",
  os: "linux",
};

/**
 * One `manifests[]` entry — ported from Python `_descriptor`
 * (`test_render.py:37-57`). `platform: null` emits a platform-less
 * descriptor (legal OCI, the field is optional). `digest` is a synthetic
 * placeholder, not a `sha256` hash of `label` like the Python fixture's —
 * unlike the golden `catalog.json` this input feeds, these bytes are never
 * byte-compared against anything, and `catalogPlatforms` never reads a
 * descriptor's `digest`, only its `platform`.
 */
export function descriptor(
  tagHint: string,
  platform: Readonly<Record<string, string>> | null,
): Record<string, unknown> {
  const label =
    platform === null
      ? `${tagHint}/attached`
      : `${tagHint}/${platform.os ?? "?"}/${platform.architecture ?? "?"}`;
  const entry: Record<string, unknown> = {
    mediaType: MANIFEST_MEDIA_TYPE,
    digest: `sha256:placeholder-${label}`,
    size: 512,
  };
  if (platform !== null) {
    entry.platform = platform;
  }
  return entry;
}

/** One tag's CAS bytes: the registry's OCI image index, as the catalog
 * emitter receives it — ported from Python `_index_of` (`test_render.py:60-67`). */
export function indexOf(...descriptors: readonly Record<string, unknown>[]): Uint8Array {
  const json = JSON.stringify({
    schemaVersion: 2,
    mediaType: INDEX_MEDIA_TYPE,
    manifests: descriptors,
  });
  return new TextEncoder().encode(json);
}

/** The common case: one runnable-image descriptor per platform — ported
 * from Python `_index_bytes` (`test_render.py:70-74`). */
export function indexBytes(
  tagHint: string,
  platforms: readonly (Readonly<Record<string, string>> | null)[] = [DEFAULT_PLATFORM],
): Uint8Array {
  return indexOf(...platforms.map((platform) => descriptor(tagHint, platform)));
}

/** UTF-8 bytes of a placeholder blob (readme/logo content) — the catalog
 * emitter never reads these bytes, only the digest+extension of the
 * `contentByDigest` key they're stored under, so the content itself is
 * arbitrary. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
