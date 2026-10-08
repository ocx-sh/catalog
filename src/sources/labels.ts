/**
 * Derived-label resolution (C-003/C-002's "Label resolution seam") — the
 * half `loadConfig` explicitly defers, per `config/types.ts`
 * `ResolvedSource`'s doc comment: "Turning a `null` into a derived string,
 * and re-checking `LABEL_CONFLICT` once derived labels are known too, is
 * the source-reading layer's job (downstream of this WP) — this loader
 * validates config SHAPE, not source CONTENT." That downstream job is this
 * file: `resolveLabel` per source, then `checkLabelConflicts` once every
 * source's final label is known.
 */

import { basename } from "node:path";
import type { CatalogConfig, ResolvedSource } from "../config/types.js";
import { SourceError } from "./types.js";
import type { CatalogSourcePackage } from "../viewmodel/types.js";

/**
 * The distinct first-`/`-segments of every package root's `root.name` in
 * one source — the source's own claim about which index its packages
 * belong to. Both `resolveLabel` branches read it: the derived branch to
 * BE the label, the explicit branch to check the label against.
 *
 * Takes ALREADY-EXTRACTED packages, not the raw file map. `extractPackages`
 * rescans the whole file map once per package root to collect that root's
 * CAS blobs, so it is O(roots x files) — measured at 1.6s for 5000 roots.
 * Reading the file map here meant every source paid that twice, since
 * `sources_pipeline.ts`'s `readOneSource` extracts them anyway; an
 * explicit-label source paid for a derivation it only used to check itself
 * against.
 */
function brandPrefixes(packages: readonly CatalogSourcePackage[]): ReadonlySet<string> {
  return new Set(packages.map((pkg) => pkg.root.name.split("/")[0]!));
}

/**
 * Resolves `resolved`'s FINAL display label:
 * - `resolved.label !== null` (an explicit `label` in config): used
 *   verbatim. `loadConfig` already checked explicit labels pairwise
 *   (`ConfigError` `LABEL_CONFLICT`) — this function does not re-derive
 *   anything for this case, only path-safety-checks the value (see below)
 *   and holds it against the source's own name prefix
 *   (`assertLabelMatchesPrefixes`, `LABEL_PREFIX_MISMATCH`): an explicit
 *   label may rename nothing, it may only state what the roots already say.
 * - `resolved.label === null`: derived from `packages` — collect the
 *   distinct first-`/`-segment prefixes of every package
 *   root's `root.name` found in `files`. Exactly one distinct prefix ⇒
 *   that prefix is the label. Zero package roots ⇒
 *   `SourceError("LABEL_DERIVATION_EMPTY", …)` naming the source (an empty
 *   source has nothing to derive an identity from). More than one distinct
 *   prefix ⇒ `SourceError("LABEL_DERIVATION_CONFLICT", …)` naming the
 *   source and every conflicting prefix found (a source's own roots
 *   disagreeing about which index they belong to is a data problem, not
 *   something this function can silently pick a winner for).
 *
 * `fallbackLabel` is for a caller that INVENTED the source rather than
 * reading it out of a config file — today only `dev_worker.ts`'s
 * `--source <dir>` sugar, which has no config to read a label from. It
 * applies to the derived branch alone, and only when there is nothing to
 * derive from, so `ocx-catalog dev` against an empty or mid-edit index still
 * boots instead of dying on `LABEL_DERIVATION_EMPTY`. It is deliberately NOT
 * the same thing as an explicit `label`: a real index derives its real name,
 * and a caller-supplied default never overrides what the roots say. (That
 * distinction is the whole bug this parameter fixes — the dev path used to
 * pass its default AS an explicit label, which quietly renamed every index
 * it was pointed at.)
 *
 * Both the explicit and the derived result are passed through
 * `assertLabelPathSafe` before being returned — an explicit label is
 * config-authored free text `loadConfig` never shape-checks beyond
 * non-empty, and a derived label is only as trustworthy as whatever a
 * source's own `root.name` values contain (this repo's schema makes that
 * always literally `"ocx.sh"` today, but a forked schema — a corporate
 * mirror's own deployment — is not this module's to trust).
 */
export function resolveLabel(
  resolved: ResolvedSource,
  packages: readonly CatalogSourcePackage[],
  fallbackLabel?: string,
): string {
  const prefixes = brandPrefixes(packages);

  if (resolved.label !== null) {
    assertLabelPathSafe(resolved.label, "explicit label");
    assertLabelMatchesPrefixes(resolved.label, prefixes);
    return resolved.label;
  }

  if (prefixes.size === 0 && fallbackLabel !== undefined) {
    assertLabelPathSafe(fallbackLabel, "fallback label");
    return fallbackLabel;
  }

  if (prefixes.size === 0) {
    throw new SourceError("LABEL_DERIVATION_EMPTY", "source declares no label and has zero package roots to derive one from");
  }
  if (prefixes.size > 1) {
    throw new SourceError(
      "LABEL_DERIVATION_CONFLICT",
      `source's package roots disagree on their first name segment: ${[...prefixes].join(", ")}`,
    );
  }

  const derived = [...prefixes][0]!;
  assertLabelPathSafe(derived, "derived label");
  return derived;
}

/**
 * An EXPLICIT label must name the same index its own package roots do.
 *
 * The label is what the index-scope tab row shows; a package's qualified
 * name (`<prefix>/<ns>/<pkg>`, printed verbatim on every card and table
 * row) is what a reader compares it against. A config aliasing
 * `label: "acme-internal"` over roots named `acme/…` produces a tab and a
 * grid that disagree about what the index is called, so it is rejected
 * rather than silently reconciled — the name the index gives itself wins,
 * and a config that wants a different one has to say so upstream.
 *
 * Zero prefixes is NOT a mismatch: a source with an explicit label and no
 * package roots is legal (only the DERIVED branch needs roots to exist,
 * hence `LABEL_DERIVATION_EMPTY` there), and an empty index has nothing to
 * contradict its label with. More than one prefix always fails here — the
 * explicit-label counterpart of `LABEL_DERIVATION_CONFLICT`.
 */
function assertLabelMatchesPrefixes(label: string, prefixes: ReadonlySet<string>): void {
  if (prefixes.size === 0) return;
  if (prefixes.size === 1 && prefixes.has(label)) return;
  throw new SourceError(
    "LABEL_PREFIX_MISMATCH",
    `explicit label ${JSON.stringify(label)} does not match this source's package-name prefix: ${[...prefixes].join(", ")}`,
  );
}

/**
 * Rejects a non-root label that collides with a root-source NAMESPACE.
 *
 * Routes are index-qualified for every non-root source (`/<label>/<ns>/…`)
 * while the root source keeps the bare `/<ns>/…`, so a root package in
 * namespace `acme` and a non-root index labelled `acme` both claim
 * `/acme/**`. Whichever page synthesis wrote last would win silently, and
 * the loser's packages would 404 with no build output saying why.
 *
 * Cross-source and content-dependent, so — like `checkLabelConflicts` — it
 * can only run once every source has been read, never at `loadConfig` time.
 * `rootNamespaces` is empty when no source sets `root: true`; then no bare
 * routes exist at all and nothing can collide.
 */
export function checkIndexNamespaceCollisions(
  labels: readonly { readonly label: string; readonly root: boolean }[],
  rootNamespaces: ReadonlySet<string>,
): void {
  labels.forEach(({ label, root }, index) => {
    if (root || !rootNamespaces.has(label)) return;
    throw new SourceError(
      "INDEX_NAMESPACE_COLLISION",
      `sources[${index}]'s label ${JSON.stringify(label)} is also a namespace the root source publishes — both would claim /${label}/`,
    );
  });
}

/**
 * Rejects a non-root label that collides with a path the BUILD itself owns.
 *
 * Exact sibling of `checkIndexNamespaceCollisions` — same collision (two
 * things claiming `/<label>/`, last write wins silently), other side. That
 * check only knew about a root source's namespaces; a source whose roots are
 * named `docs/…` derives the label `docs`, and its package pages are then
 * written into the same directory `pages.ts` copies the docs mount into,
 * with no hostile intent required.
 *
 * `isReserved` is the per-build predicate from `reservedNames` (C-027): the
 * static list plus whatever this build writes at the output root. A ROOT
 * source is exempt here — its packages keep bare routes, so its LABEL never
 * becomes a top-level path segment (it still mirrors to `index/<label>/`,
 * which is nested and cannot collide); its NAMESPACES do, and
 * `checkReservedRootNamespaces` covers them.
 *
 * Runs beside the other cross-source checks purely for locality — unlike
 * them it needs no fetched data, since a derived label is already resolved
 * by the time any of these run.
 */
export function checkReservedIndexLabels(
  labels: readonly { readonly label: string; readonly root: boolean }[],
  isReserved: ReservedNames,
): void {
  labels.forEach(({ label, root }, index) => {
    if (root || !isReserved(label)) return;
    throw new SourceError(
      "INDEX_LABEL_RESERVED",
      `sources[${index}]'s label ${JSON.stringify(label)} is a path this build already owns — both would claim /${label}/`,
    );
  });
}

/**
 * The root source's side of the same collision (C-027): its packages keep
 * bare routes, so each of its namespaces is a top-level path segment, and a
 * namespace named `docs`, `_astro`, or `Favicon.svg` would be written into —
 * or over — something the build owns. The namespace comes from the source's
 * own package names, so no hostile intent is needed either.
 */
export function checkReservedRootNamespaces(namespaces: Iterable<string>, isReserved: ReservedNames): void {
  for (const namespace of namespaces) {
    if (!isReserved(namespace)) continue;
    throw new SourceError(
      "INDEX_LABEL_RESERVED",
      `the root source publishes namespace ${JSON.stringify(namespace)}, a path this build already owns — both would claim /${namespace}/`,
    );
  }
}

/**
 * Re-checks label uniqueness across ALL resolved sources, in `sources[]`
 * order. Explicit labels were already checked pairwise by `loadConfig`
 * (`config/errors.ts` `ConfigError`'s `LABEL_CONFLICT`), but that check
 * only ever compares two EXPLICIT labels — it cannot see a derived one,
 * since deriving one needs fetched source data `loadConfig` never touches.
 * This function is that deferred second pass, run after every source's
 * `resolveLabel` result (explicit or derived) is known.
 *
 * Throws `SourceError("LABEL_CONFLICT", …)` naming both conflicting
 * indices the moment two sources — of ANY mix of explicit/derived origin —
 * share one final label. Deliberately reuses the "LABEL_CONFLICT" code
 * NAME `config/errors.ts` already established for the same real-world
 * mistake ("two sources want the same identity"), but as THIS module's own
 * `SourceError` rather than importing `ConfigError` — `ConfigError`'s code
 * union is documented as scoped to `loadConfig` only (see that file's own
 * doc comment), and this check runs strictly later, with strictly more
 * information, outside `loadConfig` entirely.
 */
export function checkLabelConflicts(labels: readonly string[]): void {
  const seenAt = new Map<string, number>();
  labels.forEach((label, index) => {
    const firstIndex = seenAt.get(label);
    if (firstIndex !== undefined) {
      throw new SourceError(
        "LABEL_CONFLICT",
        `sources[${firstIndex}] and sources[${index}] both resolve to label "${label}"`,
      );
    }
    seenAt.set(label, index);
  });
}

// Allowlist, not a blocklist: a derived label comes straight from a
// hostile source's own `root.name` (`resolveLabel` splits it on "/") — a
// blocklist naming only `/`, `\`, `.`, `..` (the pre-panel version) still
// let every control character through. Security panel BLOCK (2026-08-22):
// `name: "abc\n  Access-Control-Allow-Origin: *"` derives a label that
// injects a real header LINE into the shared `_headers` (`mirror.ts`
// writes one file covering every source); an explicit label carrying
// `\n\n` injects a whole new BLOCK for an unrelated path pattern. Every
// legitimate label (an explicit config value, or a derived `name` prefix)
// is printable ASCII with no path/header-structural characters — this
// allowlist is exactly that shape, nothing narrower.
const SAFE_LABEL_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Decides whether a top-level site name is one this build owns (C-027).
 * Compared case-INSENSITIVELY: `SAFE_LABEL_RE` admits `Docs`, and macOS and
 * Windows both resolve that to the same directory as `docs`, so a
 * case-sensitive check would pass CI and collide on a contributor's laptop.
 */
export type ReservedNames = (name: string) => boolean;

/**
 * The static part of the reserved set, every entry a path something in this
 * build already writes: `p` and `index` are `mirror.ts`'s wire trees; `data`
 * carries `data/catalog/catalog.json`; `docs` is the docs mount; `assets`,
 * `404`, `public` and `_astro` are the static-site output's own;
 * `sitemap-*` and `favicon*` are wildcard families (the sitemap integration's
 * `sitemap-index.xml`/`sitemap-0.xml`, a favicon in any format); `robots.txt`,
 * `_headers` and `config.json` are files written at the root; `c` is the wire
 * `c/index.json` tree and `pagefind` the search bundle.
 */
const STATIC_RESERVED: ReadonlySet<string> = new Set([
  "p",
  "index",
  "data",
  "docs",
  "assets",
  "404",
  "public",
  "_astro",
  "robots.txt",
  "_headers",
  "config.json",
  "c",
  "pagefind",
]);
const RESERVED_PREFIXES = ["sitemap-", "favicon"] as const;

export const staticReservedNames: ReservedNames = (name) => {
  const lower = name.toLowerCase();
  return STATIC_RESERVED.has(lower) || RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 * The per-build predicate: the static set, plus the `brand.logo` and `css`
 * file names (the build copies each to the output root under its own basename) and every name in
 * `writtenNames` — the top-level `publicDir` entries and anything else the
 * build writes at the output root. `brand` itself is not reserved: no
 * `brand/` directory is written.
 */
export function reservedNames(config: CatalogConfig, writtenNames: readonly string[]): ReservedNames {
  // The build copies `brand.logo` and `css` to the output root under their basenames.
  const copied = [config.brand?.logo, config.css].filter((file) => file !== undefined).map((file) => basename(file));
  const written = new Set([...writtenNames, ...copied].map((name) => name.toLowerCase()));
  return (name) => written.has(name.toLowerCase()) || staticReservedNames(name);
}

/**
 * Validates that `label` is safe to use as exactly ONE filesystem path
 * segment under `dist/index/<label>/` (`mirror.ts`) AND as one line of the
 * shared `_headers` file — non-empty, no path separators, no control
 * characters (that includes `\n`/`\r`, which `_headers` — a line-oriented
 * format — would otherwise let a label inject as new lines/blocks into),
 * and not `.` or `..` (which collide with "current/parent directory" on
 * every filesystem `mirror.ts` writes to). Applies to both `resolveLabel`
 * branches — see that function's doc comment for why neither an explicit
 * nor a derived label can be trusted without this check.
 *
 * Throws `SourceError("LABEL_PATH_UNSAFE", …)` naming `label` and
 * `context` (which source, and whether the label was explicit or derived)
 * on failure.
 */
function assertLabelPathSafe(label: string, context: string): void {
  const unsafe = label === "." || label === ".." || !SAFE_LABEL_RE.test(label);
  if (unsafe) {
    throw new SourceError(
      "LABEL_PATH_UNSAFE",
      `label ${JSON.stringify(label)} (${context}) is not safe as one path segment`,
    );
  }
}
