/** Stable failure modes the `ci` module can raise (C-007). */
export type CiErrorCode =
  /** `catalog.config.json` has no `ci` block — nothing to render. */
  | "MISSING_CI_CONFIG"
  /** A discovered generated file's header names a version newer than this
   * tool supports — it was rendered by a newer `@ocx-sh/catalog`. */
  | "TOOL_TOO_OLD"
  /** `ci --check` found at least one rendered file that doesn't match a
   * fresh render, through `normalizeForDrift`. */
  | "DRIFT";

/**
 * Raised by the `ci` module. `message` always names the offending file(s) so
 * the CLI can print it directly without further lookup. Mirrors
 * `config/errors.ts`'s `ConfigError` shape — the CLI, not this module, maps
 * `code` to a process exit code.
 */
export class CiError extends Error {
  readonly code: CiErrorCode;

  constructor(code: CiErrorCode, message: string) {
    super(message);
    this.name = "CiError";
    this.code = code;
  }
}
