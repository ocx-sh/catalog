/**
 * BSD sysexits.h-derived process exit codes for the `ocx-catalog` CLI.
 * Subset actually used by this program — not the full sysexits.h enum.
 */
export const OK = 0;
export const FAIL = 1;
export const USAGE = 64;
/** Data problem — schema/drift mismatch in catalog source data. */
export const DATA = 65;
/** Required service/resource unavailable (e.g. dev server port, registry). */
export const UNAVAILABLE = 69;
