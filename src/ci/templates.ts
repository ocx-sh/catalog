// The CI renderer's tiny template engine — `{{key}}` substitution, single
// pass. A composed block (e.g. the verify-job fragment) must already be
// fully rendered before it's handed in as a value, since a placeholder
// inside a substituted value is never re-scanned.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Ships beside `dist/` (see `package.json` `files`), so this resolves the
 * same from `src/ci/templates.ts` (vitest) and `dist/ci/templates.js`
 * (built) — both two directories below the package root. */
const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

/** `{{name}}`, but never GitHub Actions' `${{ ... }}` — hence the `$` lookbehind. */
const PLACEHOLDER = /(?<!\$)\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;

/** Substitutes every `{{key}}` in `template` from `vars`. Throws (rather
 * than silently leaving `{{key}}` in rendered output) when a template
 * references a key `vars` doesn't supply — a template/caller mismatch,
 * always a bug in this package. */
export function renderString(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`ci template references unknown placeholder {{${key}}}`);
    }
    return vars[key] as string;
  });
}

/** Reads `<TEMPLATE_DIR>/<rel>` and substitutes through `renderString`. */
export function renderTemplate(rel: string, vars: Readonly<Record<string, string>>): string {
  const file = path.join(TEMPLATE_DIR, rel);
  let template: string;
  try {
    template = readFileSync(file, "utf8");
  } catch {
    throw new Error(`ci template "${rel}" is missing from ${TEMPLATE_DIR} — the installed package is incomplete`);
  }
  return renderString(template, vars);
}
