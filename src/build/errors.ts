/**
 * Stable failure modes the build engine (`buildCatalog`/`devServer`) can
 * raise for a reason OTHER than a config-shape problem (those stay
 * `ConfigError`, see `config/errors.ts`) — mirrors that file's shape so the
 * CLI (`cli/build.ts`/`cli/dev.ts`) maps both through one small, uniform
 * `instanceof` dispatch instead of learning every module's own error type.
 *
 * Deliberately a two-value union, not a per-cause enum: it exists to answer
 * exactly one question the CLI needs answered — "sysexits 65 (DATA) or 69
 * (UNAVAILABLE)?" (`cli/exit.ts`) — not to classify every possible failure.
 * A future WP whose module needs a distinct message shape can still throw a
 * `BuildError` with either code; it doesn't need a new code unless the CLI
 * itself needs to branch differently, which today it doesn't.
 */
export type BuildErrorCode =
  /** Malformed/inconsistent source or output data — e.g. a root whose
   * `name` prefix mismatches its path (S-008), a double-`root:true`d
   * package set, or any other data problem discovered while building.
   * CLI maps this to exit 65. */
  | "DATA"
  /** A required external resource could not be reached — e.g. an
   * unreachable `url` source (S-002), a `dev` port already bound (S-003).
   * CLI maps this to exit 69. */
  | "UNAVAILABLE";

/** Raised by the build engine for a `BuildErrorCode` failure. `message`
 * always names the offending resource so the CLI can print it directly. */
export class BuildError extends Error {
  readonly code: BuildErrorCode;

  constructor(code: BuildErrorCode, message: string) {
    super(message);
    this.name = "BuildError";
    this.code = code;
  }
}
