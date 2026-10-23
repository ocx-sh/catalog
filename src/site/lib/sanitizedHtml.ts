// The type-level half of the README sink contract (C-014). `ReadmePane.astro`
// is the only place allowed to hand a string to `set:html`, and what it hands
// over must be a `SanitizedHtml` — a string only `readmeSanitizer.ts` can
// mint. The brand is erased at runtime; the grep test in
// `test/site/lib/readmeRender.test.ts` pins both `set:html` and
// `brandSanitized(` to their single legitimate sites.
import { readFile } from "node:fs/promises";

declare const sanitized: unique symbol;

/** HTML that went through `createReadmeSanitizer(...).sanitize`. */
export type SanitizedHtml = string & { readonly [sanitized]: true };

/**
 * Mints a `SanitizedHtml`. Called by `readmeSanitizer.ts` on DOMPurify's
 * output and by `readSanitizedHtml` below on a file of that output, nowhere
 * else — a further caller defeats the brand.
 */
export function brandSanitized(html: string): SanitizedHtml {
  return html as SanitizedHtml;
}

/**
 * Reads a file the CLI parent wrote from `createReadmeRenderer`'s output (the
 * build pre-renders and sanitises every README, `src/build/readmes.ts`) and
 * brands it. The Astro child cannot run jsdom, so this is the one hand-off
 * point: the file's whole content is sanitizer output, nothing else is ever
 * written to that directory. Used by `ReadmePane.astro` and nowhere else.
 */
export async function readSanitizedHtml(file: string): Promise<SanitizedHtml> {
  return brandSanitized(await readFile(file, "utf8"));
}
