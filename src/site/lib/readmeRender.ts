// README render with fault isolation (C-014, C-037, C-047). Turns a mirrored
// CAS README into `SanitizedHtml` for the one `set:html` sink, or into
// "unavailable" — never into an exception. One bad README (oversize, missing,
// a markdown/sanitizer fault, a sanitizer that does not reach a fixed point)
// must cost its own pane and one stderr line, not the whole build.
//
// The bytes are read from the mirrored file under the scratch `public/` rather
// than carried in `site.json` (C-047), so the model stays small at 10k
// packages. The size cap is the mirror's own, applied BEFORE the file is read.
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { JSDOM } from "jsdom";
import { MAX_CAS_ASSET_BYTES } from "../../sources/mirror.js";
import { createReadmeMarkdown } from "./readmeMarkdown.js";
import { createReadmeSanitizer, type ReadmeSanitizer } from "./readmeSanitizer.js";
import type { SanitizedHtml } from "./sanitizedHtml.js";

export type ReadmeResult = { readonly kind: "ok"; readonly html: SanitizedHtml } | { readonly kind: "unavailable" };

export interface ReadmeRendererOptions {
  /** Absolute path of the scratch `public/` the CAS files were mirrored into. */
  readonly publicDir: string;
  /** Defaults to a jsdom-backed sanitizer, created on the first README. */
  readonly sanitizer?: ReadmeSanitizer;
  /** Defaults to one `ocx-catalog: …` line on stderr. */
  readonly warn?: (message: string) => void;
}

export interface ReadmeRenderer {
  /**
   * @param name the package's qualified name (named in the warning)
   * @param readmeUrl catalog-root-relative CAS path (`/p/<ns>/<pkg>/o/sha256/<hex>.md`),
   *   `null` for a package that publishes no README (not a fault: no warning)
   */
  render(name: string, readmeUrl: string | null): Promise<ReadmeResult>;
  /** Releases the sanitizer's jsdom window, if one was ever created. Terminal. */
  close(): void;
}

const UNAVAILABLE: ReadmeResult = { kind: "unavailable" };

function warnToStderr(message: string): void {
  process.stderr.write(`ocx-catalog: ${message}\n`);
}

/** Reads the mirrored file, refusing anything outside `publicDir` or over the cap. */
async function readMirrored(publicDir: string, readmeUrl: string): Promise<string> {
  const file = await realpath(join(publicDir, readmeUrl));
  const rel = relative(await realpath(publicDir), file);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes the mirrored public directory");
  const { size } = await stat(file);
  if (size > MAX_CAS_ASSET_BYTES) throw new Error(`${size} bytes exceeds the ${MAX_CAS_ASSET_BYTES}-byte cap`);
  return readFile(file, "utf8");
}

export function createReadmeRenderer({ publicDir, sanitizer, warn = warnToStderr }: ReadmeRendererOptions): ReadmeRenderer {
  const markdown = createReadmeMarkdown();
  let sanitizing = sanitizer;
  return {
    async render(name, readmeUrl) {
      if (readmeUrl === null) return UNAVAILABLE;
      try {
        const source = await readMirrored(publicDir, readmeUrl);
        sanitizing ??= createReadmeSanitizer(() => new JSDOM("").window);
        const html = sanitizing.sanitize(markdown.render(source));
        // Tripwire: a sanitizer whose output changes when sanitized again is
        // not a fixed point, i.e. its output re-parses to something else.
        if (sanitizing.sanitize(html) !== html) throw new Error("sanitizer output is not idempotent");
        return { kind: "ok", html };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warn(`README for ${JSON.stringify(name)} unavailable: ${reason}`);
        return UNAVAILABLE;
      }
    },
    close() {
      sanitizing?.close();
    },
  };
}
