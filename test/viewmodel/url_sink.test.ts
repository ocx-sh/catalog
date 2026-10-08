/**
 * Grep tests for the two URL choke points (plan B.2):
 *
 * - C-009: a package detail link is built by `packageHref` and nowhere else.
 *   The route primitives (`packageRoutePath`, `packageRouteSegments`,
 *   `isRootIndex`) may only be referenced by the modules that define, re-export
 *   or consume them as a page-route key, never by a module that could assemble
 *   a link from them by hand.
 * - C-042: every dynamic `href={…}` / `src={…}` (and `href="${…}"` inside a
 *   template string) under `src/site/**` goes through one of the sanctioned
 *   producers, so wire data (`repository_url`, `homepage`, `logoUrl`, owner
 *   links, …) cannot reach a DOM sink without `wireHref`.
 *
 * Each detector runs against synthetic source first, planted violations that
 * must come out red, then against the real tree. P-landing and P-detail rerun
 * this file: a new component with a raw `href={x}` fails here, and the fix is
 * to route `x` through `wireHref`/`packageHref`/`joinBase`, or, for a value
 * that is provably not wire data, to add it to `NON_WIRE_EXPRESSIONS` with the
 * reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_FILE = /\.(astro|ts|tsx|mts)$/;

/** Modules that may name the route primitives, each for a stated reason. */
const ROUTE_PRIMITIVE_MODULES: ReadonlyMap<string, string> = new Map([
  ["src/viewmodel/route.ts", "defines the route rule"],
  ["src/viewmodel/url.ts", "packageHref is the one producer of a detail link"],
  ["src/site/model/route_key.ts", "route key, not a link"],
]);
const ROUTE_PRIMITIVES = /\b(packageRoutePath|packageRouteSegments|isRootIndex)\b/;

/** Dynamic attribute expressions that are provably not wire data. */
const NON_WIRE_EXPRESSIONS: ReadonlyMap<string, string> = new Map([
  ["canonical.toString()", "a URL assembled from config siteUrl and base in the page model"],
  ["favicon", "Page: ChromeView.favicon is consumer config, loadConfig-validated and joinLink-ed in chrome.ts; no wire data"],
  ["card.href", "LandingCard.href is packageHref's output, built in the landing model (landing.ts)"],
  ["page.href", "DocsSidebar: docsView joins base onto a slug docs_scan validated as URL-safe; no wire data"],
]);
const SANCTIONED_PRODUCER = /\b(wireHref|packageHref|joinBase)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sourcesUnder(...dirs: string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of dirs) {
    for (const path of walk(join(ROOT, dir)).filter((p) => SOURCE_FILE.test(p) && !p.endsWith(".d.ts"))) {
      files.set(relative(ROOT, path), readFileSync(path, "utf8"));
    }
  }
  return files;
}

function findDetailHrefViolations(files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .filter(([path, text]) => !ROUTE_PRIMITIVE_MODULES.has(path) && ROUTE_PRIMITIVES.test(text))
    .map(([path]) => `${path}: names a route primitive; build the link with packageHref`);
}

/** The text of the brace-balanced expression opening at `open` (the `{`). */
function braceExpression(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function findWireSinkViolations(files: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [path, text] of files) {
    for (const match of text.matchAll(/\b(href|src)=\{/g)) {
      const expression = braceExpression(text, match.index + match[0].length - 1).trim();
      if (!SANCTIONED_PRODUCER.test(expression) && !NON_WIRE_EXPRESSIONS.has(expression)) {
        violations.push(`${path}: ${match[1]}={${expression}} bypasses wireHref`);
      }
    }
    for (const match of text.matchAll(/\b(href|src)=["']?\$\{([^}]*)\}/g)) {
      if (!SANCTIONED_PRODUCER.test(match[2] ?? "")) {
        violations.push(`${path}: ${match[1]}="\${${match[2]}}" bypasses wireHref`);
      }
    }
  }
  return violations;
}

describe("C-009 detail links come from packageHref only", () => {
  it("flags a module that names a route primitive (planted violation)", () => {
    const planted = new Map([
      ["src/site/components/Card.astro", "---\nimport { packageRoutePath } from '../lib/packageRoute.js';\n---"],
      ["src/site/lib/links.ts", "export const href = (n: string) => `/${n.split('/').slice(1).join('/')}/`;"],
    ]);
    expect(findDetailHrefViolations(planted)).toEqual([
      "src/site/components/Card.astro: names a route primitive; build the link with packageHref",
    ]);
  });

  it("accepts a module that goes through packageHref", () => {
    const clean = new Map([["src/site/components/Card.astro", "const href = packageHref(name, indexes, base);"]]);
    expect(findDetailHrefViolations(clean)).toEqual([]);
  });

  it("finds no violation in src/site or src/viewmodel", () => {
    const files = sourcesUnder("src/site", "src/viewmodel");
    expect(files.size).toBeGreaterThan(0);
    expect(findDetailHrefViolations(files)).toEqual([]);
  });

  it("only allow-lists modules that exist", () => {
    for (const path of ROUTE_PRIMITIVE_MODULES.keys()) {
      expect(() => readFileSync(join(ROOT, path), "utf8"), path).not.toThrow();
    }
  });
});

describe("C-042 wire-derived href/src go through wireHref", () => {
  it("flags a raw href={…} fed from wire data (planted violation)", () => {
    const planted = new Map([
      ["src/site/components/Meta.astro", "<a href={pkg.upstream.repository_url}>repo</a>"],
      ["src/site/components/Logo.astro", "<img src={logoUrl} />"],
    ]);
    expect(findWireSinkViolations(planted)).toEqual([
      "src/site/components/Meta.astro: href={pkg.upstream.repository_url} bypasses wireHref",
      "src/site/components/Logo.astro: src={logoUrl} bypasses wireHref",
    ]);
  });

  it("flags a raw interpolation into an attribute of a template string (planted violation)", () => {
    const planted = new Map([["src/site/lib/card.ts", "return `<a href=\"${homepage}\">site</a>`;"]]);
    expect(findWireSinkViolations(planted)).toEqual([
      'src/site/lib/card.ts: href="${homepage}" bypasses wireHref',
    ]);
  });

  it("reads a nested brace expression to its end", () => {
    const planted = new Map([["src/site/components/A.astro", "<a href={cond ? { a: 1 }.a : other}>x</a>"]]);
    expect(findWireSinkViolations(planted)).toEqual([
      "src/site/components/A.astro: href={cond ? { a: 1 }.a : other} bypasses wireHref",
    ]);
  });

  it("reads an unterminated expression to the end of the file", () => {
    const planted = new Map([["src/site/components/B.astro", "<a href={oops"]]);
    expect(findWireSinkViolations(planted)).toEqual(["src/site/components/B.astro: href={oops} bypasses wireHref"]);
  });

  it("accepts expressions through a sanctioned producer and the allow-listed non-wire value", () => {
    const clean = new Map([
      [
        "src/site/components/Meta.astro",
        '<a href={wireHref(pkg.upstream.repository_url) ?? undefined}>r</a><a href={packageHref(n, i, b)}>d</a>' +
          "<img src={joinBase(base, logo)} /><link rel=\"canonical\" href={canonical.toString()} />" +
          "const s = `<a href=\"${wireHref(x)}\">`;",
      ],
    ]);
    expect(findWireSinkViolations(clean)).toEqual([]);
  });

  it("finds no violation in src/site", () => {
    const files = sourcesUnder("src/site");
    expect(files.size).toBeGreaterThan(0);
    expect(findWireSinkViolations(files)).toEqual([]);
  });
});
