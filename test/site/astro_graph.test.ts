/**
 * jsdom never enters the Astro graph. READMEs are rendered and sanitised in
 * the CLI parent (`src/build/readmes.ts`); the Astro child cannot run jsdom
 * (bundled it fails on `__dirname`, external it resolves from the staging
 * directory). So nothing reachable from a page, layout or component may import
 * `jsdom`, `dompurify` or the modules that do: `readmeRender`/`readmeSanitizer`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FORBIDDEN = /^(?:jsdom|dompurify)$|(?:^|\/)(?:readmeRender|readmeSanitizer)(?:\.js)?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

type Read = (file: string) => string | undefined;

/** Every forbidden import reachable from `entries`, as `file -> specifier`. `read` is `undefined` for a missing file. */
function reachableViolations(entries: readonly string[], read: Read): string[] {
  const seen = new Set<string>();
  const violations: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier = ""] of (read(file) ?? "").matchAll(SPECIFIER)) {
      if (FORBIDDEN.test(specifier)) violations.push(`${relative(ROOT, file)} -> ${specifier}`);
      else if (specifier.startsWith(".")) {
        // `.js` specifiers name the `.ts` sources; `.astro` resolves as written.
        const base = resolve(dirname(file), specifier);
        const local = [base, base.replace(/\.js$/, ".ts")].find((candidate) => read(candidate) !== undefined);
        if (local !== undefined) queue.push(local);
      }
    }
  }
  return violations.sort();
}

const readFile = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, "utf8") : undefined);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

describe("jsdom stays out of the Astro graph", () => {
  it("flags a direct and a transitive import (planted violation)", () => {
    const files = new Map([
      ["/p/pages/a.astro", 'import X from "../components/X.astro";\nimport { y } from "../lib/y.js";'],
      ["/p/components/X.astro", 'import { JSDOM } from "jsdom";'],
      ["/p/lib/y.ts", 'import { render } from "./readmeRender.js";'],
    ]);
    const violations = reachableViolations(["/p/pages/a.astro"], (file) => files.get(file));
    expect(violations.map((v) => v.replace(/^.*?(?=p\/)/, ""))).toEqual([
      "p/components/X.astro -> jsdom",
      "p/lib/y.ts -> ./readmeRender.js",
    ]);
  });

  it("follows relative imports across .astro and .ts files", () => {
    const entry = join(ROOT, "src/site/pages/package.astro");
    const reached: string[] = [];
    reachableViolations([entry], (file) => {
      const text = readFile(file);
      if (text !== undefined) reached.push(relative(ROOT, file));
      return text;
    });
    expect(reached).toEqual(expect.arrayContaining([
      "src/site/components/ReadmePane.astro",
      "src/site/lib/sanitizedHtml.ts",
      "src/site/lib/installFlavors.ts",
    ]));
  });

  it("no page reaches jsdom, dompurify, readmeRender or readmeSanitizer", () => {
    const pages = walk(join(ROOT, "src/site/pages")).filter((file) => file.endsWith(".astro"));
    expect(pages.length).toBeGreaterThan(0);
    expect(reachableViolations(pages, readFile)).toEqual([]);
  });
});
