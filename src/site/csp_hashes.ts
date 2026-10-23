import { createHash } from "node:crypto";
import { INLINE_SCRIPT_HASHES } from "@ocx-sh/theme/csp";
import { VIEW_SCRIPT } from "./lib/viewScript.js";

/** `sha256-<base64>` source expression of one inline script's text. */
const hash = (text: string): string => `sha256-${createHash("sha256").update(text).digest("base64")}`;

/**
 * The `script-src` SHA-256 sources for the inline scripts the site emits (C-043). Astro's `security.csp` hashes only
 * its own bundled scripts, not `is:inline` ones. The theme `Shell`'s come from the theme: it derives them from the
 * very constants the chrome renders, so they cannot drift. Ours is the catalog's one head-side script
 * (`lib/viewScript.ts`), hashed from the constant its template is pinned equal to. Never derive any of them from the
 * scripts found in our own output, that would allow-list whatever appears there.
 */
export function cspHashes(): string[] {
  return [...INLINE_SCRIPT_HASHES, hash(VIEW_SCRIPT)];
}
