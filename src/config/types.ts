/**
 * Type surface for `catalog.config.json` (C-002). See `load.ts` for the
 * validation contract that turns a raw JSON file into these types, and
 * `errors.ts` for the failure modes.
 */

/** Fields shared by every `SourceEntry` variant. */
interface SourceEntryCommon {
  /**
   * Explicit human label for this source. When absent, the source-reading
   * layer derives one from the source's own data — see `ResolvedSource`.
   */
  label?: string;
  /**
   * Marks this source as the catalog's self-mirror / primary index (the
   * `index.ocx.sh`-style deployment). At most one entry across `sources[]`
   * may set this — `loadConfig` rejects a second one (`MULTIPLE_ROOT`).
   */
  root?: boolean;
}

/** A source read from a local directory, relative to the config file. */
export interface PathSourceEntry extends SourceEntryCommon {
  path: string;
  url?: never;
  git?: never;
}

/** A source fetched from a plain HTTP(S) index endpoint. */
export interface UrlSourceEntry extends SourceEntryCommon {
  url: string;
  path?: never;
  git?: never;
}

/** A source cloned (shallow) from a git repository. */
export interface GitSourceEntry extends SourceEntryCommon {
  git: string;
  /** Branch, tag, or commit to check out. Defaults to the remote's HEAD. */
  ref?: string;
  /** Subdirectory within the checkout that holds the index root. */
  dir?: string;
  path?: never;
  url?: never;
}

/**
 * One catalog data source. Discriminated by exactly one of `path` | `url` |
 * `git` being present — the `?: never` siblings make that shape hold at the
 * type level for hand-constructed values, but `loadConfig` still runtime-
 * checks it (`SOURCE_DISCRIMINANT`) since JSON parsed from disk is `unknown`,
 * not this narrowed union.
 */
export type SourceEntry = PathSourceEntry | UrlSourceEntry | GitSourceEntry;

export interface Brand {
  title: string;
  /**
   * Header wordmark — the text beside the logo in the site header. Absent
   * means the header shows `title`. It exists because the two are
   * legitimately different strings: a deployment's `<title>`/`og:site_name`
   * reads as prose ("OCX Index") while its header wordmark is usually the
   * host it is served from (`index.ocx.sh`).
   */
  wordmark?: string;
  /** Path to a logo asset — path-only (no URLs), PATH_ESCAPE-checked like
   * `docs`/`css`. The build copies the file into the site's public root and
   * the header renders it in place of the theme's built-in mark; absent
   * keeps the built-in mark. */
  logo?: string;
}

export interface NavEntry {
  text: string;
  link: string;
}

/**
 * The one "open" object in this config shape — `loadConfig` accepts (and
 * forward-compat preserves) any key beyond `forge`/`verifyCi`, unlike every
 * other object here, which is closed (`expectExactKeys` in `load.ts`). A
 * literal `__proto__` key therefore survives as an ordinary own data
 * property here — harmless as parsed (`JSON.parse` never invokes the
 * `Object.prototype` setter), but a hazard if a future consumer deep-merges
 * a `CiConfig` value rather than reading its known fields directly.
 */
export interface CiConfig {
  forge: "github" | "gitlab";
  /**
   * Package manager the rendered workflow's install/exec steps use. Exactly
   * `"npm"` (default) | `"bun"` — deliberately not a fully open enum. A repo
   * on the other manager needs its own install/exec commands (`bun install
   * --frozen-lockfile` vs `npm ci`; a bun repo has no `package-lock.json` for
   * `npm ci` to read), so a wrong or unsupported value here would otherwise
   * render CI that silently fails at its own install step. pnpm/yarn are
   * unsupported until an actual consumer needs them — `loadConfig` rejects
   * anything outside the two rather than accepting a plausible-looking value
   * this renderer can't actually produce commands for.
   */
  packageManager?: "npm" | "bun";
  /**
   * When `false`, skips CI verification of rendered output against source
   * data. Unknown keys inside `ci` are ignored (forward-compat) rather than
   * rejected like unknown top-level keys.
   */
  verifyCi?: boolean;
}

export interface CatalogConfig {
  /**
   * Editor/tooling pointer at the published JSON Schema
   * (`schema/catalog.config.schema.json`). Never read at runtime.
   */
  $schema?: string;
  /**
   * Forward-compat discriminator. Absent means version 1. `loadConfig`
   * rejects any value it doesn't support (`UNSUPPORTED_VERSION`).
   */
  configVersion?: 1;
  sources: SourceEntry[];
  brand: Brand;
  nav?: NavEntry[];
  /** Single docs directory, resolved relative to the config file. */
  docs?: string;
  /** Custom stylesheet, resolved relative to the config file. */
  css?: string;
  /** Static assets directory, resolved relative to the config file — copied
   * verbatim into the synthesized site's VitePress `publicDir`, so its
   * contents are served at the site root (e.g. `favicon.svg` ->
   * `/favicon.svg`). Absent means no public assets are copied. */
  publicDir?: string;
  ci?: CiConfig;
  /** Deployment origin (e.g. `https://index.ocx.sh`) — feeds
   * `sitemap.hostname` and per-page `og:url` (`GeneratedConfigOptions.siteUrl`,
   * `src/build/config_gen.ts`). Absent degrades to no sitemap + no `og:url`
   * meta, never a build failure. Must be an absolute `http(s)` URL —
   * `loadConfig` validates this, not just non-empty. */
  siteUrl?: string;
  /** Site-wide tagline/meta description (VitePress's own `description`
   * field) — distinct from `brand.title`. Free text, no shape check beyond
   * non-empty. */
  description?: string;
  /** Site-root-relative href for the browser-tab icon, e.g. `/favicon.svg`
   * for a `favicon.svg` inside `publicDir`. Emitted as a
   * `<link rel="icon">` on every page, with `type` derived from the
   * extension (`.svg`/`.png`/`.ico`; anything else emits no `type`). Not a
   * filesystem path — this package never reads it, it only bakes it into
   * the rendered HTML, so shipping the asset is the consumer's job
   * (`publicDir`). Absent means no icon link at all. */
  favicon?: string;
}

/**
 * A validated `SourceEntry` paired with its label, as far as `loadConfig`
 * alone can resolve it. See `load.ts`'s doc comment for why full resolution
 * is a two-stage process.
 */
export interface ResolvedSource {
  entry: SourceEntry;
  /**
   * `entry.label` verbatim, or `null` when the source declared none.
   * `loadConfig` never invents a label here — see `load.ts`.
   */
  label: string | null;
}

/** Result of `loadConfig`: a validated config plus resolution context. */
export interface LoadedConfig {
  config: CatalogConfig;
  /** Absolute directory containing the config file. */
  configDir: string;
  sources: ResolvedSource[];
}
