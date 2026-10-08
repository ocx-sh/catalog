/**
 * Base containment (C-005, S-002), asserted on the real `catalog` build
 * (multi-index, `chrome: "ocx"`, base `/catalog/`) and the `rootbase` build
 * (neutral chrome, docs, publicDir, base `/catalog/`).
 *
 * The site is deployed under `/catalog/` on ocx.sh, so anything it emits that
 * the browser resolves against the origin root escapes the mount. The scan
 * covers every emitted `.html`, `.css`, `.js` and `.mjs` file (README content is
 * inside the HTML pages). A "reference" is, precisely:
 *
 *  - HTML: the value of `href`, `src`, `action`, `formaction`, `poster`,
 *    `data`, `xlink:href`, each candidate of `srcset` / `imagesrcset`, and the
 *    `content` of a `<meta>` whose value starts `/` or `http(s):`; CSS inside
 *    `<style>` and `style=""`; JS inside inline `<script>` bodies.
 *  - CSS: every `url(...)` and `@import "..."` target.
 *  - JS (files and inline scripts, importmap and JSON-LD included): a quoted
 *    string literal whose ENTIRE value is a URL, i.e. `http(s)://host/...`,
 *    `//host.tld/...` or a root-relative path `/x...` with no whitespace and
 *    no `${...}` interpolation. Substrings of longer strings are not references.
 *  - `data:`, `mailto:`, `javascript:`, `#frag` and document-relative values
 *    are ignored.
 *
 * A root-relative reference passes when it starts `/catalog/` or is exactly an
 * allowed chrome link: the user `nav`/`footer`/`docsNav` links as written in
 * the fixture config and, under `chrome: "ocx"`, the hrefs of the theme's
 * `nav.json` plus `/favicon.svg`.
 *
 * An absolute (or protocol-relative) reference passes when its origin is one
 * of: an origin written anywhere in the config or in the source trees the
 * config points at (index data, docs, publicDir; `{login}` in an `ownerUrl`
 * template matches one host label), an origin in the theme's `nav.json`, or
 * the W3C namespace host (`http://www.w3.org/`, an XML namespace name, never
 * fetched). Anything else is a third-party origin the renderer injected.
 */
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { afterAll, describe, expect, it } from "vitest";
import { fixtureConfig, listTree, REPO_ROOT, site, type SiteName } from "./helpers.js";

const BASE = "/catalog/";
const require_ = createRequire(import.meta.url);

interface Ref {
  readonly file: string;
  readonly value: string;
}

// ---- extraction ------------------------------------------------------------

const URL_ATTRS = ["href", "src", "action", "formaction", "poster", "data", "xlink:href"];
const SRCSET_ATTRS = ["srcset", "imagesrcset"];

function srcsetCandidates(value: string): string[] {
  return value
    .replace(/data:\S*/g, "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter((url) => url !== "");
}

function cssRefs(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? "");
  return out;
}

// A string literal that is, as a whole, an absolute / protocol-relative / root-relative URL.
const URL_LITERAL = /^(?:https?:\/\/[^\s"'`\\]+|\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?|\/(?!\/)[^\s"'`\\<>]+)$/i;

function jsRefs(js: string): string[] {
  const out: string[] = [];
  for (const m of js.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = m[2] ?? "";
    // A template with `${...}` is built at runtime (e.g. a hex colour), not a URL as written.
    if (URL_LITERAL.test(value) && !value.includes("${")) out.push(value);
  }
  return out;
}

function htmlRefs(html: string): string[] {
  const doc = new JSDOM(html).window.document;
  const out: string[] = [];
  for (const el of doc.querySelectorAll("*")) {
    for (const name of URL_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) out.push(value.trim());
    }
    for (const name of SRCSET_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) out.push(...srcsetCandidates(value));
    }
    const style = el.getAttribute("style");
    if (style !== null) out.push(...cssRefs(style));
    if (el.localName === "meta") {
      const content = el.getAttribute("content")?.trim() ?? "";
      if (/^(\/|https?:)/.test(content)) out.push(content);
    }
    if (el.localName === "style") out.push(...cssRefs(el.textContent ?? ""));
    if (el.localName === "script" && !el.hasAttribute("src")) out.push(...jsRefs(el.textContent ?? ""));
  }
  return out;
}

async function scan(dir: string): Promise<Ref[]> {
  const refs: Ref[] = [];
  for (const file of await listTree(dir)) {
    const extract = { ".html": htmlRefs, ".css": cssRefs, ".js": jsRefs, ".mjs": jsRefs }[extname(file)];
    if (extract === undefined) continue;
    for (const value of extract(await readFile(join(dir, file), "utf8"))) refs.push({ file, value });
  }
  return refs;
}

// ---- allowlists --------------------------------------------------------------

interface ChromeNav {
  readonly brand: { href: string };
  readonly sections: readonly { href?: string }[];
  readonly hubs: readonly { href: string }[];
  readonly entries: readonly { href?: string }[];
  readonly actions: readonly { href: string }[];
  readonly footer: readonly { href: string }[];
}

const themeNav = JSON.parse(await readFile(require_.resolve("@ocx-sh/theme/nav.json"), "utf8")) as ChromeNav;
const themeHrefs = [
  themeNav.brand.href,
  ...themeNav.sections.map((s) => s.href),
  ...themeNav.hubs.map((h) => h.href),
  ...themeNav.entries.map((e) => e.href),
  ...themeNav.actions.map((a) => a.href),
  ...themeNav.footer.map((f) => f.href),
].filter((href): href is string => href !== undefined);

interface FixtureConfig {
  readonly sources: readonly { path: string }[];
  readonly docs?: string;
  readonly publicDir?: string;
  readonly chrome?: string;
  readonly nav?: readonly { link: string }[];
  readonly docsNav?: readonly { link: string }[];
  readonly footer?: { links?: readonly { link: string }[] };
}

const originOf = (url: string): string => new URL(url, "http://relative.invalid").origin.toLowerCase();

interface Allowed {
  readonly paths: Set<string>;
  readonly origins: Set<string>;
  readonly originPatterns: RegExp[];
}

async function allowlistFor(name: SiteName): Promise<Allowed> {
  const configPath = fixtureConfig(name);
  const configText = await readFile(configPath, "utf8");
  const config = JSON.parse(configText) as FixtureConfig;
  const ocx = config.chrome === "ocx";

  const paths = new Set<string>(ocx ? [...themeHrefs, "/favicon.svg"] : []);
  const userLinks = [...(config.nav ?? []), ...(config.docsNav ?? []), ...(config.footer?.links ?? [])];
  for (const { link } of userLinks) paths.add(link);

  // Origin text: the config itself, the theme's nav.json, and every source tree the config points at.
  const texts = [configText, JSON.stringify(themeNav)];
  const trees = [...config.sources.map((s) => s.path), ...(config.docs ? [config.docs] : []), ...(config.publicDir ? [config.publicDir] : [])];
  for (const tree of trees) {
    const root = resolve(dirname(configPath), tree);
    for (const file of await listTree(root)) texts.push(await readFile(join(root, file), "utf8"));
  }
  const origins = new Set<string>(["http://www.w3.org"]);
  const originPatterns: RegExp[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/[^\s"'`<>)\]\\/?#]+/g)) {
      const raw = m[0].toLowerCase();
      if (raw.includes("{login}")) {
        const literal = raw.split("{login}").map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"));
        originPatterns.push(new RegExp(`^${literal.join("[^./]+")}$`));
      } else {
        origins.add(originOf(raw));
      }
    }
  }
  return { paths, origins, originPatterns };
}

// ---- classification ----------------------------------------------------------

const IGNORED = /^(?:#|data:|mailto:|tel:|javascript:|blob:|about:)/i;

/** Why `value` escapes the mount or names a foreign origin; `undefined` when it is contained. */
function violation(value: string, allowed: Allowed): string | undefined {
  if (value === "" || IGNORED.test(value)) return undefined;
  const absolute = /^(?:https?:)?\/\//i.test(value);
  if (absolute) {
    const origin = originOf(value.startsWith("//") ? `https:${value}` : value);
    const bare = origin.replace(/^https?:\/\//, "");
    const known =
      allowed.origins.has(origin) ||
      [...allowed.origins].some((o) => o.replace(/^https?:\/\//, "") === bare) ||
      allowed.originPatterns.some((p) => p.test(origin));
    return known ? undefined : `third-party origin ${origin}`;
  }
  if (!value.startsWith("/")) return undefined;
  const path = value.replace(/[?#].*$/, "");
  if (value.startsWith(BASE) || allowed.paths.has(value) || allowed.paths.has(path)) return undefined;
  return "root-relative ref outside /catalog/";
}

async function violations(dir: string, allowed: Allowed): Promise<string[]> {
  const found = new Set<string>();
  for (const { file, value } of await scan(dir)) {
    const why = violation(value, allowed);
    if (why !== undefined) found.add(`${file}: ${value} (${why})`);
  }
  return [...found].sort();
}

// ---- suites ------------------------------------------------------------------

describe.each(["catalog", "rootbase"] as const)("C-005 containment under /catalog/ (%s)", (name) => {
  it("the scan reaches the pages, the CSS and the JS it is meant to cover", async () => {
    const files = await listTree(site(name));
    const refs = await scan(site(name));

    expect(files.filter((f) => f.endsWith(".html")).length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(".css"))).toBe(true);
    expect(files.some((f) => f.endsWith(".js"))).toBe(true);
    expect(refs.filter((r) => r.value.startsWith(BASE)).length).toBeGreaterThan(100);
    // README content is part of the package pages: its own links are in the scanned set.
    expect(refs.some((r) => r.file.startsWith("tools/") && /^https?:/.test(r.value))).toBe(true);
  });

  it("no root-relative ref leaves /catalog/ and no third-party origin appears", async () => {
    expect(await violations(site(name), await allowlistFor(name))).toEqual([]);
  });
});

describe("C-005 the scan can fail", () => {
  const scratch: string[] = [];
  afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

  async function plant(snippet: string, file = "index.html"): Promise<string[]> {
    const copy = await mkdtemp(join(tmpdir(), "ocx-contain-"));
    scratch.push(copy);
    await cp(site("catalog"), copy, { recursive: true });
    const target = join(copy, file);
    await writeFile(target, `${await readFile(target, "utf8")}${snippet}`);
    return violations(copy, await allowlistFor("catalog"));
  }

  it("a root-absolute href is reported", async () => {
    expect(await plant('<a href="/docs/escape/">x</a>')).toEqual(["index.html: /docs/escape/ (root-relative ref outside /catalog/)"]);
  });

  it("a root-absolute CSS url() and srcset candidate are reported", async () => {
    expect(await plant('<div style="background:url(/img/bg.png)"></div><img srcset="/a.png 1x, /catalog/b.png 2x">')).toEqual([
      "index.html: /a.png (root-relative ref outside /catalog/)",
      "index.html: /img/bg.png (root-relative ref outside /catalog/)",
    ]);
  });

  it("a root-absolute URL literal in an inline script is reported, a plain slash string is not", async () => {
    expect(await plant('<script>fetch("/data/x.json"); const sep = "/";</script>')).toEqual([
      "index.html: /data/x.json (root-relative ref outside /catalog/)",
    ]);
  });

  it("a third-party origin is reported, a source-data origin is not", async () => {
    expect(await plant('<script src="https://cdn.evil.test/x.js"></script><link rel="stylesheet" href="https://fonts.example/f.css">')).toEqual([
      "index.html: https://cdn.evil.test/x.js (third-party origin https://cdn.evil.test)",
      "index.html: https://fonts.example/f.css (third-party origin https://fonts.example)",
    ]);
    expect(await plant('<a href="https://discord.gg/mT2UCF8CVe">x</a>')).toEqual([]);
  });

  it("a root-absolute ref in an emitted CSS file is reported", async () => {
    const css = (await listTree(site("catalog"))).find((f) => f.endsWith(".css"))!;
    expect(await plant("\n.x{background:url('/leak.svg')}", css)).toEqual([`${css}: /leak.svg (root-relative ref outside /catalog/)`]);
  });
});

describe("C-005 ocx-site check on the catalog build", () => {
  const bin = join(REPO_ROOT, "node_modules/.bin/ocx-site");
  const run = promisify(execFile);
  const check = (dist: string): Promise<{ code: number; stdout: string; stderr: string }> =>
    run(bin, ["check", "--dist", dist, "--repo", "ocx-sh/index", "--path", BASE]).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
  const scratch: string[] = [];
  afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

  it("passes: every root-relative link resolves inside the /catalog/ claim", async () => {
    expect(await check(site("catalog"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("fails on a dead /catalog/ link planted in a copy", async () => {
    const copy = await mkdtemp(join(tmpdir(), "ocx-site-"));
    scratch.push(copy);
    await cp(site("catalog"), copy, { recursive: true });
    const index = join(copy, "index.html");
    await writeFile(index, `${await readFile(index, "utf8")}<a href="/catalog/no-such-page/">x</a>`);

    const result = await check(copy);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("index.html: C-013: /catalog/no-such-page/ does not exist in dist\n");
  });
});
