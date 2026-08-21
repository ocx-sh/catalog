import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { ConfigError } from "./errors.js";
import type {
  Brand,
  CatalogConfig,
  CiConfig,
  LoadedConfig,
  NavEntry,
  ResolvedSource,
  SourceEntry,
} from "./types.js";

const TOP_LEVEL_KEYS = [
  "$schema",
  "configVersion",
  "sources",
  "brand",
  "nav",
  "docs",
  "css",
  "publicDir",
  "ci",
  "siteUrl",
  "description",
  "favicon",
] as const;

/** `typeof value`, but calls out `null` explicitly — `typeof null` is
 * confusingly "object". Shared by every INVALID_TYPE diagnostic below. */
function describeType(value: unknown): string {
  return value === null ? "null" : typeof value;
}

function expectString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be a string (got ${describeType(value)})`);
  }
  // Every string field in the schema carries minLength: 1 (label, title,
  // path/url/git, ref/dir, docs, css, wordmark, logo, nav text/link) — an
  // empty string is a shape violation, not a valid "unset" value (that's
  // what an absent/optional key is for).
  if (value.length === 0) {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be a non-empty string`);
  }
  return value;
}

function expectBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be a boolean (got ${describeType(value)})`);
  }
  return value;
}

function expectArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be an array (got ${describeType(value)})`);
  }
  return value;
}

function expectObject(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : describeType(value);
    throw new ConfigError("INVALID_TYPE", `"${key}" must be an object (got ${got})`);
  }
  return value as Record<string, unknown>;
}

/** Rejects any key in `obj` not listed in `allowed`, naming the key and
 * `keyPath` (the object's own location, e.g. "brand", "sources[0]"). Shared
 * by every closed-shape object — top level, each sources[] entry variant,
 * brand, nav[] entries. `ci` is the one open/forward-compat object and
 * deliberately never routed through this. */
function expectExactKeys(obj: Record<string, unknown>, allowed: readonly string[], keyPath: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new ConfigError("UNKNOWN_KEY", `unknown key "${key}" in ${keyPath}`);
    }
  }
}

const ALLOWED_FORGES = new Set(["github", "gitlab"]);
const ALLOWED_PACKAGE_MANAGERS = new Set(["npm", "bun"]);

const SOURCE_ENTRY_KEYS: Record<"path" | "url" | "git", readonly string[]> = {
  path: ["path", "label", "root"],
  url: ["url", "label", "root"],
  git: ["git", "ref", "dir", "label", "root"],
};

/** Shared by every optional string field (label, docs, css, publicDir, brand.logo,
 * $schema, git ref/dir): one reusable defined/undefined branch pair instead
 * of a separate, individually-untested ternary per field. */
function optionalString(value: unknown, key: string): string | undefined {
  return value === undefined ? undefined : expectString(value, key);
}

/** Protocol allowlists for `assertPlausibleUrl` below. `siteUrl` is a
 * cosmetic origin (it never gets FETCHED — it only feeds `sitemap.hostname`/
 * `og:url` text), so `http:` stays legal there for a local/plain-HTTP
 * deployment. A `sources[].url` IS fetched, and is https-only — see
 * `SOURCE_URL_PROTOCOLS`' own note. */
const SITE_URL_PROTOCOLS = ["http:", "https:"] as const;
const SOURCE_URL_PROTOCOLS = ["https:"] as const;

/** Both `siteUrl` and a `sources[].url` need a plausible absolute origin,
 * not just a non-empty string:
 *
 * - `siteUrl` feeds `sitemap.hostname`/`og:url` directly
 *   (`GeneratedConfigOptions.siteUrl`), so a typo'd value would silently
 *   bake a broken URL into every rendered page.
 * - `sources[].url` is the base of every wire fetch `walker.ts` performs,
 *   and TWO of the files it pulls — `/config.json` and `/c/index.json` —
 *   are the only fetched files that are never digest-verified (there is
 *   nothing to verify them against). Over plain `http:`, a network attacker
 *   rewrites the enumeration, and every downstream digest check then
 *   verifies package roots against the ATTACKER's digests and passes
 *   cleanly. Hence `https:` only, not "http or https" — transport integrity
 *   is the only integrity those two files have (CWE-319/CWE-345, security
 *   panel 2026-08-22).
 *
 * Reuses `INVALID_TYPE`, same as every other shape violation this loader
 * reports (no dedicated code for one field). */
function assertPlausibleUrl(value: string, key: string, protocols: readonly string[], expected: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be an absolute URL (got "${value}")`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigError("INVALID_TYPE", `"${key}" must be ${expected} (got "${value}")`);
  }
}

/**
 * Path-SEGMENT containment: `value` (resolved against `configDir`) must be
 * `configDir` itself or a descendant of it. Reuses `src/cli/out_dir.ts`
 * `assertOutDirSafe`'s `relative()`-then-split-on-`sep` technique, not the
 * function itself — that helper asserts the opposite relation (unrelated).
 *
 * Security caveat: this check is LEXICAL only (`resolve`/`relative` on the
 * path string), never `realpath` — it does not follow symlinks. A symlink
 * living inside `configDir` whose target resolves outside it passes this
 * containment check despite the eventual read landing outside `configDir`.
 * This loader never reads `docs`/`css`/`publicDir`/`brand.logo`/`path` off disk, so it's
 * out of scope here; any FUTURE code that does read those values MUST
 * independently `realpath`-verify containment before opening the file —
 * don't assume `loadConfig` having accepted the config already proves that.
 */
function assertPathContained(configDir: string, value: string, key: string): void {
  const resolved = resolve(configDir, value);
  const rel = relative(configDir, resolved);
  // `rel.split(sep)` on `rel === ""` (value resolves to configDir itself)
  // yields `[""]`, which — like every genuine descendant — contains no
  // ".." segment, so no separate same-directory special case is needed.
  const segments = rel.split(sep);
  const isContained = !segments.includes("..");
  if (!isContained) {
    throw new ConfigError(
      "PATH_ESCAPE",
      `"${key}" escapes the config directory: "${value}" (resolved "${resolved}")`,
    );
  }
}

function buildSourceEntry(rawEntry: unknown, index: number): SourceEntry {
  const raw = expectObject(rawEntry, `sources[${index}]`);
  const discriminants = (["path", "url", "git"] as const).filter((k) => raw[k] !== undefined);
  if (discriminants.length !== 1) {
    throw new ConfigError(
      "SOURCE_DISCRIMINANT",
      `sources[${index}] must set exactly one of path, url, git (found ${discriminants.length})`,
    );
  }
  const kind = discriminants[0];
  expectExactKeys(raw, SOURCE_ENTRY_KEYS[kind], `sources[${index}]`);

  const label = optionalString(raw.label, `sources[${index}].label`);
  const root = raw.root === undefined ? undefined : expectBoolean(raw.root, `sources[${index}].root`);

  if (kind === "path") {
    return { path: expectString(raw.path, `sources[${index}].path`), label, root };
  }
  if (kind === "url") {
    const url = expectString(raw.url, `sources[${index}].url`);
    assertPlausibleUrl(url, `sources[${index}].url`, SOURCE_URL_PROTOCOLS, "an https URL");
    return { url, label, root };
  }
  const ref = optionalString(raw.ref, `sources[${index}].ref`);
  const dir = optionalString(raw.dir, `sources[${index}].dir`);
  return { git: expectString(raw.git, `sources[${index}].git`), ref, dir, label, root };
}

function buildNavEntry(item: unknown, index: number): NavEntry {
  const raw = expectObject(item, `nav[${index}]`);
  expectExactKeys(raw, ["text", "link"], `nav[${index}]`);
  return {
    text: expectString(raw.text, `nav[${index}].text`),
    link: expectString(raw.link, `nav[${index}].link`),
  };
}

function buildCi(value: unknown): CiConfig {
  const raw = expectObject(value, "ci");
  const forge = expectString(raw.forge, "ci.forge");
  if (!ALLOWED_FORGES.has(forge)) {
    throw new ConfigError(
      "INVALID_TYPE",
      `"ci.forge" must be one of "github", "gitlab" (got "${forge}")`,
    );
  }
  if (raw.packageManager !== undefined) {
    const packageManager = expectString(raw.packageManager, "ci.packageManager");
    if (!ALLOWED_PACKAGE_MANAGERS.has(packageManager)) {
      throw new ConfigError(
        "INVALID_TYPE",
        `"ci.packageManager" must be one of "npm", "bun" (got "${packageManager}")`,
      );
    }
  }
  if (raw.verifyCi !== undefined) {
    expectBoolean(raw.verifyCi, "ci.verifyCi");
  }
  // Unknown keys inside `ci` are forward-compat — pass the object through
  // verbatim rather than reconstructing only the known fields.
  return raw as unknown as CiConfig;
}

/**
 * Reads and validates `catalog.config.json` at `configPath`.
 *
 * Validation contract (hand-rolled — no ajv or other schema-validator
 * dependency at runtime; `schema/catalog.config.schema.json` is a published
 * sibling artifact for editor tooling and test-suite schema-validity
 * checks, never loaded here):
 *
 * - Missing file (ENOENT) -> `MISSING_FILE`, naming `configPath`. The CLI
 *   maps this to exit 65 (`src/cli/exit.ts` `DATA`). Any OTHER read failure
 *   (e.g. `configPath` names a directory, or a permission error) ->
 *   `READ_ERROR` instead, naming the real `errno` code — never reported as
 *   MISSING_FILE, which would misdescribe a path that does exist.
 * - Unparseable JSON -> `INVALID_JSON`.
 * - Parsed JSON that isn't a plain object (`null`, an array, a primitive) ->
 *   `INVALID_TYPE`, checked before anything below reads a key off it.
 * - `configVersion` that isn't a number -> `INVALID_TYPE` (a type problem,
 *   not a version problem). A well-typed number greater than this loader's
 *   supported version -> `UNSUPPORTED_VERSION`. Absent means version 1, and
 *   the returned `LoadedConfig.config.configVersion` is always normalized to
 *   `1`. Both checks run BEFORE the unknown-key scan below, so a config from
 *   a newer, unsupported version reports the version mismatch rather than a
 *   confusing UNKNOWN_KEY about a field this loader doesn't know yet.
 * - Unknown TOP-LEVEL keys are rejected (`UNKNOWN_KEY`) — fail-loud, no
 *   silent typo-tolerance. The same closed-shape check applies to each
 *   `sources[]` entry (against its discriminant variant's own key set),
 *   `brand`, and each `nav[]` entry. `ci` is the
 *   ONE exception: unknown keys INSIDE `ci` are ignored (forward-compat;
 *   see `CiConfig`'s doc comment) — never conflate the two with one
 *   field-list constant.
 * - Every `sources[]` entry must carry exactly one of `path` | `url` | `git`
 *   -> `SOURCE_DISCRIMINANT` otherwise, naming the entry's index.
 * - `sources` must be non-empty -> `EMPTY_SOURCES`.
 * - At most one `sources[]` entry may set `root: true` -> `MULTIPLE_ROOT`
 *   otherwise, naming both conflicting indices.
 * - At most one `sources[]` entry may declare a given explicit `label` ->
 *   `LABEL_CONFLICT` otherwise. This is the ONLY label check `loadConfig`
 *   performs — see "Label resolution seam" below.
 * - `css`, `docs`, `publicDir`, `brand.logo`, and every `path` source value must resolve to a location
 *   inside the config file's own directory (no `..` escape) ->
 *   `PATH_ESCAPE` otherwise, naming the offending key and resolved path.
 *   This is path-SEGMENT containment (`node:path` `relative()` + splitting
 *   on `sep`), never a string-prefix check — same bug class
 *   `src/cli/out_dir.ts`'s `assertOutDirSafe` guards against. That helper
 *   itself doesn't fit here as-is: it asserts two paths are UNRELATED
 *   (rejects same/ancestor/descendant, for a self-sweeping scratch root),
 *   while this check wants the opposite relation — the value must be the
 *   config dir itself or a descendant of it. Reuse its `relative()`-then-
 *   split-on-`sep` technique for the descendant check, not the function.
 * - Any other type mismatch (e.g. `sources` not an array, `brand.title` not
 *   a string) -> `INVALID_TYPE`, naming the offending key/path. Every string
 *   field mirrors the schema's `minLength: 1`: an EMPTY string is also
 *   `INVALID_TYPE`, not a valid value — use an absent/optional key for
 *   "unset", never `""`.
 * - Every `sources[].url` must be a plausible absolute **`https:`** URL ->
 *   `INVALID_TYPE` otherwise. Not "http or https": `/config.json` and
 *   `/c/index.json` are the only files `walker.ts` fetches that are never
 *   digest-verified, so transport integrity is the only integrity they
 *   have — see `assertPlausibleUrl`'s own doc comment.
 * - `siteUrl`, when given, must additionally be a plausible absolute
 *   `http(s)` URL (`new URL()` parses it AND its protocol is `http:`/
 *   `https:`) -> `INVALID_TYPE` otherwise — it feeds `sitemap.hostname`/
 *   `og:url` verbatim (`src/build/config_gen.ts`), so a typo'd value would
 *   silently bake a broken URL into every rendered page. `brand.wordmark`,
 *   `description` and `favicon` are free text — same non-empty-string check
 *   as every other optional string field, nothing more. `favicon` in
 *   particular is a site-root-relative HREF, never a path this package
 *   reads, so it gets no `PATH_ESCAPE` containment check (the asset itself
 *   ships via `publicDir`, which does).
 *
 * Label resolution seam: a source's display label can come from two places
 * — an explicit `label` in config, or (when absent) derivation from the
 * source's own root data (first `/`-segment of a root `name`). Derivation
 * needs the fetched source data, which a config loader never touches.
 * `loadConfig` therefore only resolves the explicit half: each
 * `ResolvedSource.label` is `entry.label ?? null`, and `LABEL_CONFLICT`
 * only compares entries that both set an explicit label. Turning a `null`
 * into a derived string, and re-checking `LABEL_CONFLICT` once derived
 * labels are known too, is the source-reading layer's job (downstream of
 * this WP) — this loader validates config SHAPE, not source CONTENT.
 */
export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConfigError("MISSING_FILE", `config file not found: ${configPath}`);
    }
    throw new ConfigError("READ_ERROR", `could not read config file ${configPath}: ${code}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("INVALID_JSON", `invalid JSON in ${configPath}`);
  }

  const data = expectObject(parsed, "config");

  // Version mismatch is checked before the unknown-key scan: a newer config
  // read by an older loader would otherwise surface as a confusing
  // UNKNOWN_KEY about a field this version doesn't know yet, instead of the
  // actual cross-version diagnostic.
  if (data.configVersion !== undefined) {
    if (typeof data.configVersion !== "number") {
      throw new ConfigError(
        "INVALID_TYPE",
        `"configVersion" must be a number (got ${describeType(data.configVersion)})`,
      );
    }
    if (data.configVersion !== 1) {
      throw new ConfigError(
        "UNSUPPORTED_VERSION",
        `unsupported configVersion ${JSON.stringify(data.configVersion)}`,
      );
    }
  }

  expectExactKeys(data, TOP_LEVEL_KEYS, "config");

  const sourcesRaw = expectArray(data.sources, "sources");
  if (sourcesRaw.length === 0) {
    throw new ConfigError("EMPTY_SOURCES", `"sources" must not be empty`);
  }

  const brandRaw = expectObject(data.brand, "brand");
  expectExactKeys(brandRaw, ["title", "wordmark", "logo"], "brand");
  const title = expectString(brandRaw.title, "brand.title");
  const wordmark = optionalString(brandRaw.wordmark, "brand.wordmark");
  const logo = optionalString(brandRaw.logo, "brand.logo");
  const brand: Brand = { title, wordmark, logo };

  const entries: SourceEntry[] = sourcesRaw.map((rawEntry, index) => buildSourceEntry(rawEntry, index));

  const rootIndices = entries.reduce<number[]>(
    (acc, entry, i) => (entry.root ? [...acc, i] : acc),
    [],
  );
  if (rootIndices.length > 1) {
    throw new ConfigError(
      "MULTIPLE_ROOT",
      `multiple sources set root: true (indices ${rootIndices.join(", ")})`,
    );
  }

  const seenLabels = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (entry.label === undefined) {
      return;
    }
    const seenAt = seenLabels.get(entry.label);
    if (seenAt !== undefined) {
      throw new ConfigError(
        "LABEL_CONFLICT",
        `sources[${seenAt}] and sources[${i}] both declare label "${entry.label}"`,
      );
    }
    seenLabels.set(entry.label, i);
  });

  const configDir = dirname(resolve(configPath));

  entries.forEach((entry, i) => {
    if (typeof entry.path === "string") {
      assertPathContained(configDir, entry.path, `sources[${i}].path`);
    }
  });

  const schemaField = optionalString(data.$schema, "$schema");
  const nav =
    data.nav === undefined
      ? undefined
      : expectArray(data.nav, "nav").map((item, i) => buildNavEntry(item, i));
  const docs = optionalString(data.docs, "docs");
  const css = optionalString(data.css, "css");
  const publicDir = optionalString(data.publicDir, "publicDir");
  const ci = data.ci === undefined ? undefined : buildCi(data.ci);
  const siteUrl = optionalString(data.siteUrl, "siteUrl");
  const description = optionalString(data.description, "description");
  const favicon = optionalString(data.favicon, "favicon");
  if (siteUrl !== undefined) {
    assertPlausibleUrl(siteUrl, "siteUrl", SITE_URL_PROTOCOLS, "an http(s) URL");
  }

  if (docs !== undefined) {
    assertPathContained(configDir, docs, "docs");
  }
  if (css !== undefined) {
    assertPathContained(configDir, css, "css");
  }
  if (publicDir !== undefined) {
    assertPathContained(configDir, publicDir, "publicDir");
  }
  if (brand.logo !== undefined) {
    assertPathContained(configDir, brand.logo, "brand.logo");
  }

  const config: CatalogConfig = {
    $schema: schemaField,
    configVersion: 1,
    sources: entries,
    brand,
    nav,
    docs,
    css,
    publicDir,
    ci,
    siteUrl,
    description,
    favicon,
  };

  const sources: ResolvedSource[] = entries.map((entry) => ({ entry, label: entry.label ?? null }));

  return { config, configDir, sources };
}
