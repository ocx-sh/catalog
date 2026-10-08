/** Stable failure modes `loadConfig` can raise. */
export type ConfigErrorCode =
  /** Config file does not exist at the given path. CLI maps this to exit 65. */
  | "MISSING_FILE"
  /** Config path exists but couldn't be read (e.g. it's a directory, or a
   * permission error) — distinct from MISSING_FILE, which is ENOENT only. */
  | "READ_ERROR"
  /** Config file exists but is not valid JSON. */
  | "INVALID_JSON"
  /** A field's JSON type doesn't match its schema type. */
  | "INVALID_TYPE"
  /** An unrecognized key at the top level (fail-loud; `ci`'s own keys are exempt). */
  | "UNKNOWN_KEY"
  /** `configVersion` names a version this loader doesn't support. */
  | "UNSUPPORTED_VERSION"
  /** A `sources[]` entry has zero, or more than one, of `path`/`url`/`git`. */
  | "SOURCE_DISCRIMINANT"
  /** `sources` is present but empty. */
  | "EMPTY_SOURCES"
  /** More than one `sources[]` entry sets `root: true`. */
  | "MULTIPLE_ROOT"
  /** More than one `sources[]` entry sets `default: true`. */
  | "MULTIPLE_DEFAULT"
  /** Two `sources[]` entries declare the same explicit `label`. */
  | "LABEL_CONFLICT"
  /** A `css`/`docs`/`path` value resolves outside the config file's directory. */
  | "PATH_ESCAPE"
  /** `base` (or the path of `siteUrl`, its default) is not a canonical URL path
   * prefix (C-003): leading and trailing `/`, no dot segment. */
  | "BASE_INVALID"
  /** `base` and `siteUrl`'s path both carry a path and differ (C-003). */
  | "BASE_SITEURL_MISMATCH"
  /** `chrome: "ocx"` conflicts with `brand`, `nav`, `footer` or `docsNav` (C-003). */
  | "CHROME_OCX_CONFLICT"
  /** The output directory overlaps a configured input directory. Declared
   * here with the other config codes; raised by `cli/out_dir.ts`. */
  | "OUT_DIR_OVERLAPS_INPUT";

/**
 * Raised by `loadConfig` for any validation failure. `message` always names
 * the offending entry (index into `sources[]`, top-level/`ci` key, or
 * resolved path) so the CLI can print it directly without further lookup.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}
