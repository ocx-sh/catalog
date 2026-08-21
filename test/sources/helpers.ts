/**
 * Shared builders for `test/sources/*.test.ts` — every file in this
 * directory needs a schema-shaped `p/<ns>/<pkg>.json` root (snake_case, per
 * `/home/mherwig/dev/index/schema/root.schema.json`) and a byte-equality
 * check; extracted here because path/extract/labels/mirror/walker all need
 * both (quality-core.md DRY: 5 genuine callers).
 */
import { createHash } from "node:crypto";

/** UTF-8 bytes of `text`. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** True iff `a` and `b` hold the exact same bytes — never a semantic/JSON
 * comparison, so a re-serialization bug (whitespace/key-order change) still
 * fails the assertion. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** `sha256:<hex>` of `bytes`, for walker digest-verification fixtures. */
export function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export interface RootTag {
  content: string;
  observed: string;
  yanked?: { reason: string; at: string };
}

export interface RootDesc {
  title: string;
  description: string;
  keywords: string[];
  readme?: string;
  logo?: string;
}

export interface RootFields {
  name: string;
  status?: "active" | "deprecated" | "yanked";
  deprecatedMessage?: string | null;
  /** Absent by default (schema: omitted when unset) — pass a string to set,
   * or explicit `null` to force the key present-but-null. */
  supersededBy?: string | null;
  created?: string;
  /** `null` (default) for "no __ocx.desc ever published"; an object for a
   * populated desc block. */
  desc?: RootDesc | null;
  tags?: Record<string, RootTag>;
}

/**
 * Builds one `p/<ns>/<pkg>.json` root's raw JSON text, matching every field
 * `schema/root.schema.json` requires — `name`/`status`/`tags`/`desc` etc.
 * are the caller's concern; the rest (`repository`, `owners`) are filled
 * with a fixed placeholder since the catalog emitter never reads them
 * (`CatalogPackageRoot` omits both — `viewmodel/types.ts`).
 *
 * Deliberately NOT `JSON.stringify(obj, null, 2)` — a compact, oddly-spaced
 * literal proves the reader under test returns bytes verbatim rather than
 * parsing and re-serializing (`path.ts`/`mirror.ts`'s byte-verbatim
 * contract would still "pass" a pretty-printed round-trip that silently
 * lost the original bytes).
 */
export function rootJsonText(fields: RootFields): string {
  const {
    name,
    status = "active",
    deprecatedMessage = null,
    supersededBy,
    created = "2026-01-01",
    desc = null,
    tags = {},
  } = fields;

  const descObj =
    desc === null
      ? null
      : {
          digest: `sha256:${"a".repeat(64)}`,
          title: desc.title,
          description: desc.description,
          keywords: desc.keywords,
          ...(desc.readme !== undefined ? { readme: desc.readme } : {}),
          ...(desc.logo !== undefined ? { logo: desc.logo } : {}),
        };

  const tagsObj = Object.fromEntries(
    Object.entries(tags).map(([tag, entry]) => [
      tag,
      {
        content: entry.content,
        observed: entry.observed,
        ...(entry.yanked !== undefined ? { yanked: entry.yanked } : {}),
      },
    ]),
  );

  const obj: Record<string, unknown> = {
    name,
    repository: "oci://ghcr.io/ocx-contrib/placeholder",
    owners: [{ github: "octocat", github_id: 1 }],
    status,
    deprecated_message: deprecatedMessage,
    ...(supersededBy !== undefined ? { superseded_by: supersededBy } : {}),
    created,
    desc: descObj,
    tags: tagsObj,
  };

  // Odd inline spacing on purpose — see doc comment above.
  return JSON.stringify(obj).replace(/,/g, ", ");
}

export function rootJsonBytes(fields: RootFields): Uint8Array {
  return utf8(rootJsonText(fields));
}
