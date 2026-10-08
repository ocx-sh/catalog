/**
 * Closure test for the islands' browser bundle: `src/site/lib` is documented to
 * run in Node AND the browser, but `lib/readmeRender.ts` and
 * `lib/sanitizedHtml.ts` are Node-only (jsdom, `node:*`). Nothing but a
 * file-level discipline keeps an island from importing one of them, or a
 * module that does, so this walks the import graph from every
 * `src/site/client` module and fails on any `node:*` or `jsdom` specifier it
 * reaches. Type-only imports are erased and not followed.
 *
 * The walker takes a file reader so the red cases run against planted
 * in-memory trees, never the real one.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CLIENT = join(ROOT, "src/site/client");

type Read = (path: string) => string | undefined;

const FORBIDDEN = /^(?:node:|jsdom(?:\/|$))/;
// `import … from "x"`, `export … from "x"`, `import "x"`, `import("x")`; not `import type` / `export type`.
const SPECIFIER =
  /\b(?:import|export)\s+(?!type\b)(?:[^"';()]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every forbidden specifier reachable from `entries`, as `importer -> specifier`. */
function forbiddenImports(entries: readonly string[], read: Read): { reached: Set<string>; forbidden: string[] } {
  const reached = new Set<string>();
  const forbidden: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    const source = read(file);
    if (source === undefined) throw new Error(`closure: cannot read ${file}`);
    for (const match of code(source).matchAll(SPECIFIER)) {
      const specifier = (match[1] ?? match[2])!;
      if (FORBIDDEN.test(specifier)) forbidden.push(`${file} -> ${specifier}`);
      else if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  }
  return { reached, forbidden };
}

describe("planted violations are caught (red)", () => {
  const tree = (files: Record<string, string>): Read => (path) => files[path];

  it("a direct node: import", () => {
    const read = tree({ "/c/entry.ts": 'import { readFileSync } from "node:fs";' });
    expect(forbiddenImports(["/c/entry.ts"], read).forbidden).toEqual(['/c/entry.ts -> node:fs']);
  });

  it("jsdom, reached through a relative chain, a re-export and a dynamic import", () => {
    const read = tree({
      "/c/entry.ts": 'export { a } from "./a.js";\nconst b = await import("./b.js");',
      "/c/a.ts": 'import { JSDOM } from "jsdom";',
      "/c/b.ts": 'import "jsdom/lib/api.js";',
    });
    expect(forbiddenImports(["/c/entry.ts"], read).forbidden.sort()).toEqual([
      "/c/a.ts -> jsdom",
      "/c/b.ts -> jsdom/lib/api.js",
    ]);
  });

  it("a multi-line import", () => {
    const read = tree({ "/c/entry.ts": 'import {\n  a,\n  b,\n} from "node:path";' });
    expect(forbiddenImports(["/c/entry.ts"], read).forbidden).toEqual(["/c/entry.ts -> node:path"]);
  });

  it("a type-only import, a comment and a cycle are not violations", () => {
    const read = tree({
      "/c/entry.ts": 'import type { X } from "node:fs";\n// import "node:fs"\n/* import "jsdom" */\nimport "./a.js";',
      "/c/a.ts": 'import "./entry.js";\nexport type { Y } from "jsdom";',
    });
    const { reached, forbidden } = forbiddenImports(["/c/entry.ts"], read);
    expect(forbidden).toEqual([]);
    expect([...reached].sort()).toEqual(["/c/a.ts", "/c/entry.ts"]);
  });

  it("an import that resolves to no file is a failure, not a silent gap", () => {
    expect(() => forbiddenImports(["/c/entry.ts"], tree({ "/c/entry.ts": 'import "./gone.js";' }))).toThrow(
      "cannot read /c/gone.ts",
    );
  });
});

describe("src/site/client", () => {
  const entries = readdirSync(CLIENT)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(CLIENT, name));
  const { reached, forbidden } = forbiddenImports(entries, (path) =>
    existsSync(path) ? readFileSync(path, "utf8") : undefined,
  );
  const reachedRelative = [...reached].map((path) => relative(ROOT, path));

  it("walks the real graph (the scan is not vacuous)", () => {
    expect(reachedRelative).toEqual(
      expect.arrayContaining([
        "src/site/client/grid_session.ts",
        "src/site/client/palette_session.ts",
        "src/site/lib/catalogFetch.ts",
        "src/site/lib/filterPackages.ts",
        "src/viewmodel/url.ts",
      ]),
    );
  });

  it("never reaches the Node-only README renderer", () => {
    expect(reachedRelative).not.toContain("src/site/lib/readmeRender.ts");
    expect(reachedRelative).not.toContain("src/site/lib/sanitizedHtml.ts");
  });

  it("reaches no node:* or jsdom import", () => {
    expect(forbidden).toEqual([]);
  });
});
