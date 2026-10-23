/**
 * D-144: the consumer stylesheet's graph must realpath inside the config
 * directory, bare package specifiers excepted (they may resolve into any
 * `node_modules`). The plugin is driven with hand-built nodes (what PostCSS
 * hands it after Vite inlined the `@import`s) and postcss-import's
 * `dependency` messages, over a real temp tree with real symlinks;
 * `test/acceptance/css_containment.test.ts` drives the same check through a
 * real build.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { containConsumerCss, CSS_VIOLATION_FILE, recordViolation, violationPath } from "../../src/site/css_containment.js";

interface FakeNode {
  source?: { input?: { file?: string } };
  value?: string;
  params?: string;
}
type Message = { type: string; file?: unknown };

/** `<base>/proj` is the config directory, `<base>/scratch` the Vite root; `<base>/outside.png` is a file outside both. */
let base: string;
let root: string;
let scratch: string;
let entry: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "css-containment-")));
  root = join(base, "proj");
  scratch = join(base, "scratch");
  mkdirSync(join(root, "theme"), { recursive: true });
  mkdirSync(join(scratch, "public"), { recursive: true });
  entry = join(root, "theme", "site.css");
  writeFileSync(entry, "");
  writeFileSync(join(base, "outside.png"), "x");
  writeFileSync(join(root, "theme", "dot.png"), "x");
  writeFileSync(join(scratch, "site.json"), "{}");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** The Vite root and its publicDir, as the integration passes them. */
const vite = () => ({ root: scratch, publicDir: join(scratch, "public") });

/** What PostCSS does with the plugin: `prepare` over the stylesheet as parsed, then `Once` over the inlined tree. */
function drive(plugin: ReturnType<typeof containConsumerCss>, nodes: FakeNode[], from: string | undefined, messages: Message[] = []): void {
  const result = { opts: { from }, messages, root: postcss.parse(readFileSync(entry, "utf8")) };
  plugin.prepare(result).Once?.({ walk: (visit) => nodes.forEach(visit) }, { result, postcss });
}

/** Runs the plugin over `nodes` as the stylesheet `from`; returns the reported messages. */
function run(nodes: FakeNode[], from = entry, messages: Message[] = []): string[] {
  const reported: string[] = [];
  const plugin = containConsumerCss(entry, root, (message) => reported.push(message), vite());
  drive(plugin, nodes, from, messages);
  return reported;
}

/** A declaration of `entry` (or `file`) with the given value. */
const decl = (value: string, file = entry): FakeNode => ({ source: { input: { file } }, value });

/** `<dir>/node_modules/<name>` with a `package.json` and `files`. */
function installPackage(dir: string, name: string, files: Record<string, string>): string {
  const pkg = join(dir, "node_modules", name);
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(pkg, file), text);
  return pkg;
}

describe("containConsumerCss: relative references", () => {
  it("D-144 passes a graph that stays inside the config directory", () => {
    expect(() => run([decl("url(./dot.png)"), decl("url('dot.png?v=1#x')"), decl("url(../theme/dot.png)")])).not.toThrow();
  });

  it("D-144 refuses a url() that climbs out of the config directory, naming the file", () => {
    expect(() => run([decl("url(../../outside.png)")])).toThrow(join(base, "outside.png"));
  });

  it("D-144 reports the violation before throwing it", () => {
    const reported: string[] = [];
    const plugin = containConsumerCss(entry, root, (message) => reported.push(message), vite());
    expect(() =>
      drive(plugin, [decl("url(../../outside.png)")], entry),
    ).toThrow();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(join(base, "outside.png"));
  });

  it("D-144 refuses a node that came from a file outside the config directory (an inlined @import)", () => {
    expect(() => run([{ source: { input: { file: join(base, "outside.css") } }, value: "red" }])).toThrow(join(base, "outside.css"));
  });

  it("D-144 refuses a symlink inside the config directory that points out, for a url() target", () => {
    symlinkSync(join(base, "outside.png"), join(root, "theme", "link.png"));
    const link = join(root, "theme", "link.png");
    expect(() => run([decl("url(./link.png)")])).toThrow(`css "${link}" (resolves to "${join(base, "outside.png")}")`);
  });

  it("D-144 refuses an inlined file reached through a symlink that points out", () => {
    writeFileSync(join(base, "outside.css"), "");
    symlinkSync(join(base, "outside.css"), join(root, "theme", "linked.css"));
    const link = join(root, "theme", "linked.css");
    expect(() => run([{ source: { input: { file: link } }, value: "red" }])).toThrow(`css "${link}" (resolves to "${join(base, "outside.css")}")`);
  });

  it.each([
    "url(../../outside.png)",
    'url("../../outside.png")',
    "image-set('../../outside.png' 1x)",
    'image-set("../../outside.png" 1x, "./dot.png" 2x)',
    "image-set(../../outside.png 1x)",
    'image-set("./dot.png" type("image/png") 1x, "../../outside.png" 2x)',
    "-webkit-image-set('../../outside.png' 1x)",
  ])("D-144 finds the reference in %s", (value) => {
    expect(() => run([decl(value)])).toThrow(join(base, "outside.png"));
  });

  it("D-144 finds a reference in at-rule params, and decodes percent escapes before judging the file", () => {
    expect(() => run([{ source: { input: { file: entry } }, params: "url(..%2F..%2Foutside.png)" }])).not.toThrow();
    writeFileSync(join(root, "my icon.png"), "x");
    expect(() => run([decl("url(./my%20icon.png)")])).not.toThrow();
    expect(() => run([decl("url(../../out%73ide.png)")])).toThrow(join(base, "outside.png"));
  });

  it("D-144 leaves a malformed percent escape as written", () => {
    expect(() => run([decl("url(./bad%zz.png)")])).not.toThrow();
  });

  it.each([
    ["a backslash path", String.raw`url(..\..\outside.png)`],
    ["a CSS-escaped slash, which Vite unescapes to ../", String.raw`url(..\/..\/outside.png)`],
    ["a percent-encoded backslash", "url(..%5C..%5Coutside.png)"],
    ["an escaped ) that Vite keeps inside the url", String.raw`url(..\)/../../../outside.png)`],
    ["escaped dots, which only Vite's unescape turns into ../", String.raw`url(.\./.\./outside.png)`],
  ])("D-144 judges %s as the traversal it is", (_name, value) => {
    expect(() => run([decl(value)])).toThrow("outside the config directory");
  });

  it.each(["url(data:image/png;base64,AAAA)", "url(https://cdn.test/x.png)", "url(//cdn.test/x.png)", "url(#frag)", "url()", "url('')", "none"])(
    "D-144 does not treat %s as a file",
    (value) => {
      expect(() => run([decl(value)])).not.toThrow();
    },
  );

  it("D-144 judges a file that does not exist by its path alone", () => {
    expect(() => run([decl("url(./missing.png)")])).not.toThrow();
    expect(() => run([decl("url(../../missing.png)")])).toThrow(join(base, "missing.png"));
  });

  it.each([
    ["a symlink loop", "url(./loop-a)", "ELOOP"],
    ["a file used as a directory", "url(./dot.png/x)", "ENOTDIR"],
  ])("D-144 refuses %s as a violation naming the reference, not a render failure", (_name, value, code) => {
    symlinkSync(join(root, "theme", "loop-b"), join(root, "theme", "loop-a"));
    symlinkSync(join(root, "theme", "loop-a"), join(root, "theme", "loop-b"));
    const reported: string[] = [];
    const plugin = containConsumerCss(entry, root, (message) => reported.push(message), vite());
    expect(() => drive(plugin, [decl(value)], entry)).toThrow(
      `cannot be resolved (${code})`,
    );
    expect(reported[0]).toContain(join(root, "theme", value.slice(6, -1)));
  });

  it("D-144 rethrows any other filesystem error, unreported", () => {
    const reported: string[] = [];
    const plugin = containConsumerCss(entry, root, (message) => reported.push(message), vite());
    expect(() =>
      drive(plugin, [decl(`url(./${"a".repeat(300)})`)], entry),
    ).toThrow(/ENAMETOOLONG/);
    expect(reported).toEqual([]);
  });
});

describe("containConsumerCss: root-relative and absolute references", () => {
  it("D-144 refuses an absolute url() naming a file outside the config directory, and passes one inside", () => {
    expect(() => run([decl(`url(${base}/outside.png)`)])).toThrow(join(base, "outside.png"));
    expect(() => run([decl(`url(${root}/theme/dot.png)`)])).not.toThrow();
  });

  it("D-144 refuses a /@fs url(), which Vite reads off the filesystem", () => {
    expect(() => run([decl(`url(/@fs${base}/outside.png)`)])).toThrow(`css "${join(base, "outside.png")}"`);
  });

  it("D-144 refuses a root-relative url() naming a file of the Vite root, which Vite reads before the filesystem", () => {
    expect(() => run([decl("url(/site.json)")])).toThrow(join(scratch, "site.json"));
    expect(() => run([decl("url(/../outside.png)")])).toThrow(join(base, "outside.png"));
  });

  it("D-144 passes a root-relative url() naming no file on disk", () => {
    expect(() => run([decl("url(/fonts/x.woff2?v=1)")])).not.toThrow();
  });

  it("D-144 passes a root-relative url() naming a publicDir file before looking further, as Vite links it without reading", () => {
    writeFileSync(join(scratch, "public", "font.woff2"), "x");
    writeFileSync(join(scratch, "public", "site.json"), "{}");
    expect(() => run([decl("url(/font.woff2)"), decl("url(/site.json)")])).not.toThrow();
  });

  it("D-144 refuses a root-relative url() into the Vite root outside publicDir, a publicDir directory or a climb out of it included", () => {
    mkdirSync(join(scratch, "public", "site.json"));
    writeFileSync(join(base, "site.json"), "{}");
    expect(() => run([decl("url(/site.json)")])).toThrow(join(scratch, "site.json"));
    expect(() => run([decl("url(/../site.json)")])).toThrow(join(base, "site.json"));
  });
});

describe("containConsumerCss: bare package specifiers (0.5.3 behaviour)", () => {
  it("D-144 passes a bare url() into a node_modules hoisted above the config directory, scoped or not", () => {
    installPackage(base, "pkg", { "logo.png": "x" });
    installPackage(base, "@scope/pkg", { "logo.png": "x" });
    expect(() => run([decl("url(pkg/logo.png)"), decl("url(@scope/pkg/logo.png)"), decl("url(pkg/missing.png)")])).not.toThrow();
  });

  it("D-144 tries a bare url() relative first, as Vite does: a word-led name of a file beside the stylesheet is judged as that file", () => {
    symlinkSync(join(base, "outside.png"), join(root, "theme", "link.png"));
    expect(() => run([decl("url(dot.png)")])).not.toThrow();
    expect(() => run([decl("url(link.png)")])).toThrow(join(root, "theme", "link.png"));
  });

  it("D-144 refuses a bare url() into a package that is a symlink pointing outside every node_modules", () => {
    mkdirSync(join(base, "elsewhere"));
    writeFileSync(join(base, "elsewhere", "x.png"), "x");
    mkdirSync(join(base, "node_modules"));
    symlinkSync(join(base, "elsewhere"), join(base, "node_modules", "evil"));
    expect(() => run([decl("url(evil/x.png)")])).toThrow(join(base, "elsewhere"));
  });

  it.each(["url(pkg/../../outside.png)", "url(pkg/../.cache/x.png)", "url(@scope/pkg/../x.png)"])("D-144 refuses a bare %s that climbs out of the package it names", (value) => {
    installPackage(base, "pkg", {});
    expect(() => run([decl(value)])).toThrow("climbs out of the package it names");
  });

  it("D-144 judges a word-led reference with .. by the file it names relative, or with .css added, before calling it a package climb", () => {
    mkdirSync(join(root, "theme", "images"));
    writeFileSync(join(root, "theme", "b.css"), "");
    expect(() => run([decl("url(images/../dot.png)")])).not.toThrow();
    writeFileSync(entry, '@import "images/../b";');
    expect(() => run([])).not.toThrow();
  });

  it("D-144 refuses the stylesheet's own @import that climbs out of its package before postcss-import resolves it", () => {
    writeFileSync(entry, '@import "pkg/../../../tmp/x.css";');
    const reported: string[] = [];
    const plugin = containConsumerCss(entry, root, (message) => reported.push(message), vite());
    expect(() => plugin.prepare({ opts: { from: entry }, messages: [], root: postcss.parse(readFileSync(entry, "utf8")) })).toThrow(
      'css "pkg/../../../tmp/x.css"',
    );
    expect(reported).toHaveLength(1);
  });

  it("D-144 passes an inlined package file, and its own relative references inside node_modules", () => {
    const pkg = installPackage(base, "pkg", { "x.css": "", "font.woff2": "x" });
    const file = join(pkg, "x.css");
    expect(() => run([decl("url(./font.woff2)", file)], entry, [{ type: "dependency", file }])).not.toThrow();
  });

  it("D-144 refuses a package file's relative reference that leaves node_modules", () => {
    const file = join(installPackage(base, "pkg", { "x.css": "" }), "x.css");
    expect(() => run([decl("url(../../outside.png)", file)])).toThrow(join(base, "outside.png"));
  });

  it("D-144 refuses an inlined file under node_modules/.cache, or inside the Vite root, as no package", () => {
    mkdirSync(join(base, "node_modules", ".cache"), { recursive: true });
    writeFileSync(join(base, "node_modules", ".cache", "x.css"), "");
    mkdirSync(join(scratch, "public", "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(scratch, "public", "node_modules", "pkg", "x.css"), "");
    expect(() => run([], entry, [{ type: "dependency", file: join(base, "node_modules", ".cache", "x.css") }])).toThrow("outside the config directory");
    expect(() => run([], entry, [{ type: "dependency", file: join(scratch, "public", "node_modules", "pkg", "x.css") }])).toThrow(
      "outside the config directory",
    );
  });
});

describe("containConsumerCss: the @import graph", () => {
  it("D-144 refuses a file postcss-import read that left no node behind (an @import-only file outside)", () => {
    writeFileSync(join(base, "outside.css"), '@import "./x.css";');
    expect(() => run([], entry, [{ type: "warning" }, { type: "dependency", file: 7 }, { type: "dependency", file: join(base, "outside.css") }])).toThrow(
      join(base, "outside.css"),
    );
  });

  it("D-144 refuses the stylesheet itself when it is a symlink pointing out, even with no node", () => {
    writeFileSync(join(base, "outside.css"), "");
    rmSync(entry);
    symlinkSync(join(base, "outside.css"), entry);
    expect(() => run([])).toThrow(`css "${entry}" (resolves to "${join(base, "outside.css")}")`);
  });

  it("D-144 refuses a relative @import into a node_modules above the config directory, and passes the same package imported bare", () => {
    installPackage(base, "pkg", { "x.css": ".from-pkg{}" });
    writeFileSync(entry, '@import "../../node_modules/pkg/x.css";');
    expect(() => run([])).toThrow(join(base, "node_modules", "pkg", "x.css"));
    writeFileSync(entry, '@import "pkg/x.css" layer(vendor);');
    expect(() => run([])).not.toThrow();
  });

  it("D-144 re-reads every config file of the graph, a nested @import-only one included", () => {
    installPackage(base, "pkg", { "x.css": "" });
    const nested = join(root, "theme", "nested.css");
    writeFileSync(nested, "@import url('../../node_modules/pkg/x.css');");
    expect(() => run([], entry, [{ type: "dependency", file: nested }])).toThrow(join(base, "node_modules", "pkg", "x.css"));
  });

  it("D-144 refuses an absolute @import, even into node_modules", () => {
    const file = join(installPackage(base, "pkg", { "x.css": "" }), "x.css");
    writeFileSync(entry, `@import "${file}";`);
    expect(() => run([])).toThrow(file);
  });

  it("D-144 skips an @import of a remote URL, and one with no specifier", () => {
    writeFileSync(entry, '@import url("https://cdn.test/x.css");\n@import url(//cdn.test/y.css);\n@import nothing;\n@import url();');
    expect(() => run([])).not.toThrow();
  });
});

describe("containConsumerCss: which runs it checks", () => {
  it("D-144 ignores nodes with no source, and any stylesheet that is not the consumer's", () => {
    expect(() => run([{ value: "url(../../outside.png)" }])).not.toThrow();
    expect(() => run([decl("url(../../outside.png)")], join(base, "theme.css"))).not.toThrow();
  });

  it("D-144 ignores a run with no input file, and strips a query from the input file", () => {
    const plugin = containConsumerCss(entry, root, () => undefined, vite());
    const visit = (from: string | undefined): void =>
      drive(plugin, [decl("url(../../outside.png)")], from);
    expect(() => visit(undefined)).not.toThrow();
    expect(() => visit(`${entry}?used`)).toThrow(join(base, "outside.png"));
  });

  it("D-144 judges the config directory by its real path", () => {
    symlinkSync(root, join(base, "alias"));
    const plugin = containConsumerCss(entry, join(base, "alias"), () => undefined, vite());
    expect(() =>
      drive(plugin, [decl("url(./dot.png)")], entry),
    ).not.toThrow();
  });
});

describe("recordViolation", () => {
  it("D-144 writes the message where the parent reads it after a failed render", () => {
    recordViolation(base)("css is outside");
    expect(readFileSync(violationPath(base), "utf8")).toBe("css is outside");
    expect(violationPath(base)).toBe(join(base, CSS_VIOLATION_FILE));
  });
});
