/**
 * Grep test for the island sinks (C-041, C-040): no module under
 * `src/site/client` writes markup (`innerHTML`, `outerHTML`,
 * `insertAdjacentHTML`) or touches web storage (`localStorage`,
 * `sessionStorage`). Wire data reaches the DOM only through `textContent`,
 * `setAttribute` and template clones; state lives in the URL.
 *
 * The detector runs against planted violations first, which must come out red,
 * then against the real tree.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CLIENT = join(ROOT, "src/site/client");

const HTML_SINK = /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/;
const WEB_STORAGE = /\b(localStorage|sessionStorage)\b/;

/** Source without comments, so a docblock may say what a module does not do. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function violations(source: string, pattern: RegExp): boolean {
  return pattern.test(code(source));
}

/** Every `.ts` file under `dir`, subdirectories included. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tsFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
  );
}

function clientSources(): Map<string, string> {
  return new Map(tsFiles(CLIENT).map((path) => [relative(ROOT, path), readFileSync(path, "utf8")]));
}

describe("planted violations are caught (red)", () => {
  it.each([
    "el.innerHTML = value;",
    "el.outerHTML = value;",
    'el.insertAdjacentHTML("beforeend", value);',
    "const { innerHTML } = el;",
  ])("html sink: %s", (line) => {
    expect(violations(line, HTML_SINK)).toBe(true);
  });

  it.each(["localStorage.setItem('k', v);", "window.sessionStorage.getItem('k');"])("web storage: %s", (line) => {
    expect(violations(line, WEB_STORAGE)).toBe(true);
  });

  it("a mention inside a comment is not a violation", () => {
    expect(violations("/** never innerHTML */\n// nor localStorage\nconst x = 1;", HTML_SINK)).toBe(false);
    expect(violations("/** never innerHTML */\n// nor localStorage\nconst x = 1;", WEB_STORAGE)).toBe(false);
  });
});

describe("src/site/client", () => {
  const sources = clientSources();

  it("covers the island modules (the scan is not vacuous)", () => {
    expect([...sources.keys()]).toEqual(expect.arrayContaining(["src/site/client/grid.ts", "src/site/client/palette.ts"]));
  });

  it("scans every .ts file in the directory tree, nested ones included", () => {
    // A second, independent listing: `recursive: true` instead of the scan's own recursion.
    const listed = readdirSync(CLIENT, { recursive: true, encoding: "utf8" }).filter(
      (name) => name.endsWith(".ts") && statSync(join(CLIENT, name)).isFile(),
    );
    expect(sources.size).toBe(listed.length);
  });

  it("writes no markup", () => {
    expect([...sources].filter(([, source]) => violations(source, HTML_SINK)).map(([path]) => path)).toEqual([]);
  });

  it("touches no web storage", () => {
    expect([...sources].filter(([, source]) => violations(source, WEB_STORAGE)).map(([path]) => path)).toEqual([]);
  });
});
