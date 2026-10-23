/**
 * Containment of the consumer stylesheet's graph (D-144). `css` is bundled by
 * Vite, which follows its `@import` and `url()` references wherever they point.
 * `catalog.config.json` may be authored by a fork PR, so the file AND every
 * file its graph resolves to must realpath inside the config directory: a
 * `url(../../.ssh/key)` or a symlink pointing out would otherwise be inlined
 * into the published site. The one exception is a bare package specifier
 * (`@import "pkg/x.css"`, as 0.5.3 allowed): it may resolve into any
 * `node_modules`, even one above the config directory, and that package's own
 * relative references may stay inside `node_modules`.
 *
 * A PostCSS plugin does the check: it runs after Vite has inlined the
 * `@import`s, when every node still names the file it came from, and
 * postcss-import's `dependency` messages name every file it read (an
 * `@import`-only file leaves no node behind). Only the consumer stylesheet is
 * checked (the theme's own sheets legitimately live elsewhere).
 *
 * References are judged the way Vite reads them (`vite:css`, Vite 8): a `\`
 * escape is dropped (`..\/` is `../`), `/x` is `<vite root>/x`, then the
 * filesystem path `/x`, and `/@fs/x` is `/x`; a word-led reference is tried
 * relative, then as a package. Every candidate that exists must pass, so a
 * check is never narrower than the bundler. A `/x` that is a `publicDir` file
 * passes before anything else (Vite links it, never reads it), and so does one
 * that names no file at all.
 */
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

/** Written beside `site.json` on a violation, so the parent can report a data error (exit 65), not a render failure. */
export const CSS_VIOLATION_FILE = "css-violation.txt";

/** The slice of a PostCSS node this check reads. */
interface CssNode {
  readonly source?: { readonly input?: { readonly file?: string } };
  readonly value?: string;
  readonly params?: string;
}
interface CssRoot {
  walk(visitor: (node: CssNode) => void): void;
}
interface CssAtRoot {
  walkAtRules(name: string, visitor: (node: { readonly params: string }) => void): void;
}
interface CssResult {
  readonly opts: { readonly from?: string };
  readonly messages: readonly { readonly type: string; readonly file?: unknown }[];
  /** The stylesheet as parsed, before any plugin ran. */
  readonly root: CssAtRoot;
}
interface CssHelpers {
  readonly result: CssResult;
  readonly postcss: { parse(css: string): CssAtRoot };
}

/** A file the check cannot judge: refused like one outside, with its own reason. */
class Refusal extends Error {}

/** `realpath` of a file that exists, else `undefined`. */
const realIfExists = (file: string): string | undefined => {
  try {
    return realpathSync(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    // A symlink loop or a file used as a directory: Vite cannot read it either, but it is not judged inside.
    if (code === "ELOOP" || code === "ENOTDIR") throw new Refusal(`css "${file}" cannot be resolved (${code})`);
    throw err;
  }
};

/** `realpath`, or the lexical path for a file that does not exist (nothing to read, so nothing to leak). */
const real = (file: string): string => realIfExists(file) ?? resolve(file);

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
};

/** A file of an installed package: below some `node_modules/<name>`, `<name>` not a dot-dir (`node_modules/.cache` holds build scratch). */
const PACKAGE_FILE = /[\\/]node_modules[\\/][^.\\/]/;

/** Vite's skip list (`skipUrlReplacer`): a remote or data URL, a fragment, a CSS function, a Vite placeholder. */
const NOT_A_FILE = /^(?:(?:[a-z]+:)?\/\/|\s*data:|#|[a-z_][.\w-]*\(|__VITE_(?:PUBLIC_)?ASSET__)/i;

/** The forms of one reference a bundler may read: as written and CSS-unescaped, percent-decoded, `\` as `/`, query and fragment dropped. */
function forms(ref: string): string[] {
  const variants = [ref, ref.replace(/\\(\W)/g, "$1")].map((form) => unescapeUrl(form).replaceAll("\\", "/").replace(/[?#].*/s, ""));
  return [...new Set(variants)].filter((form) => form !== "");
}

/** A percent-escaped reference names the decoded file; a malformed escape is left as written. */
function unescapeUrl(ref: string): string {
  try {
    return decodeURI(ref);
  } catch {
    return ref;
  }
}

/** Strips one pair of matching quotes. */
const unquote = (ref: string): string => ref.replace(/^(["'])(.*)\1$/s, "$2");

/** The `url(...)` and `image-set(...)` references of a declaration value or at-rule params, over-approximating Vite's own parse. */
function references(value: string): string[] {
  const refs: string[] = [];
  for (const m of value.matchAll(/url\(\s*('[^']*'|"[^"]*"|(?:\\.|[^'")\\])*)\s*\)/gi)) refs.push(unquote(m[1].trim()));
  for (const m of value.matchAll(/image-set\(((?:[\w-]{1,256}\([^)]*\)|[^)])*)\)/gi)) {
    for (const c of m[1].matchAll(/(["'])(.*?)\1|([^\s,"']+)/g)) refs.push(c[2] ?? c[3]);
  }
  return refs.filter((ref) => !NOT_A_FILE.test(ref));
}

/** The specifier of an `@import` prelude: `"x"`, `'x'` or `url(x)`. */
function importSpecifier(params: string): string | undefined {
  const m = /^\s*(?:url\(\s*('[^']*'|"[^"]*"|[^)]*?)\s*\)|('[^']*'|"[^"]*"))/i.exec(params);
  return m === null ? undefined : unquote(m[1] ?? m[2]);
}

/** postcss-import's record of every file it read for this stylesheet. */
const dependencies = (result: CssResult): string[] =>
  result.messages.flatMap((message) => (message.type === "dependency" && typeof message.file === "string" ? [message.file] : []));

/**
 * @param consumerCss absolute path of the stylesheet the check applies to
 * @param root the config directory every file of its graph must stay inside
 * @param report called with the message before the plugin throws it
 * @param vite the Vite root (the build's scratch root) and its `publicDir`: where `url(/x)` is looked up first
 */
export function containConsumerCss(
  consumerCss: string,
  root: string,
  report: (message: string) => void,
  vite: { readonly root: string; readonly publicDir: string },
) {
  const realRoot = real(root);
  const realViteRoot = real(vite.root);
  const entry = real(consumerCss);
  const outside = (file: string, target: string): Refusal =>
    new Refusal(
      `css "${file}"${target === file ? "" : ` (resolves to "${target}")`} is outside the config directory ${realRoot}: a stylesheet and everything it imports or references must stay inside it`,
    );
  const inConfig = (target: string): boolean => isInside(realRoot, target);
  // The build's own scratch root sits under `node_modules/.cache`; its public copy is never a package.
  const inPackage = (target: string): boolean => PACKAGE_FILE.test(target) && !isInside(realViteRoot, target);

  /** Vite's `checkPublicFile`: `publicDir` + the path, lexically inside it, a regular file. */
  const isPublicFile = (form: string): boolean => {
    const file = join(vite.publicDir, form);
    if (!isInside(resolve(vite.publicDir), file)) return false;
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  };

  /** A file of the graph (an inlined `@import`, or the file a node came from): the config directory, or a package. */
  const checkGraphFile = (file: string): void => {
    const target = real(file);
    if (!inConfig(target) && !inPackage(target)) throw outside(file, target);
  };

  /** Judges one reference written in `origin`, every candidate Vite may read for it. */
  const checkReference = (ref: string, origin: string): void => {
    const fromPackage = !inConfig(real(origin));
    for (const form of forms(ref)) {
      if (form.startsWith("/")) {
        // A publicDir file is linked, never read (Vite's `checkPublicFile`), and Vite looks no further.
        if (isPublicFile(form)) continue;
        // Root-relative, then the filesystem path, then `/@fs/<path>` (Vite's `fsPathFromId`): only a file that exists is read.
        const candidates = [join(realViteRoot, form), form];
        if (form.startsWith("/@fs/")) candidates.push(form.slice(5).replace(/^(?![a-z]:|\/)/i, "/"));
        for (const candidate of candidates) {
          const target = realIfExists(candidate);
          if (target !== undefined && !inConfig(target)) throw outside(candidate, target);
        }
        continue;
      }
      // Relative: judged even when missing. A package's own relative reference may stay inside `node_modules`.
      const relativeFile = resolve(dirname(origin), form);
      const relativeTarget = form.startsWith(".") ? real(relativeFile) : realIfExists(relativeFile);
      if (relativeTarget !== undefined && !inConfig(relativeTarget) && !(fromPackage && inPackage(relativeTarget))) {
        throw outside(relativeFile, relativeTarget);
      }
      if (form.startsWith(".")) continue;
      const name = form.split("/").slice(0, form.startsWith("@") ? 2 : 1).join("/");
      // Not found relative (nor, for an `@import`, with `.css` added), it is a bare specifier, which must stay inside
      // the package it names: `pkg/../x` is a path Vite cannot resolve, and `pkg/../.cache` is no package.
      const normal = posix.normalize(form);
      const climbs = normal !== name && !normal.startsWith(`${name}/`);
      if (climbs && relativeTarget === undefined && realIfExists(`${relativeFile}.css`) === undefined) {
        throw new Refusal(`css "${form}" (in "${origin}") climbs out of the package it names: a bare specifier must stay inside its package`);
      }
      // A bare specifier: the package directory and the file, in every `node_modules` Node's lookup walks.
      for (let dir = dirname(origin); ; dir = dirname(dir)) {
        for (const candidate of [join(dir, "node_modules", name), join(dir, "node_modules", form)]) {
          const target = realIfExists(candidate);
          if (target !== undefined && !inConfig(target) && !inPackage(target)) throw outside(candidate, target);
        }
        if (dirname(dir) === dir) break;
      }
    }
  };

  /** Judges one `@import` prelude written in `file`. */
  const checkImport = (params: string, file: string): void => {
    const spec = importSpecifier(params);
    if (spec !== undefined && !NOT_A_FILE.test(spec)) checkReference(spec, file);
  };

  /** Runs `check`; a refusal is reported, then thrown as a plain error for PostCSS to carry. */
  const refusing = (check: () => void): void => {
    try {
      check();
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      report(err.message);
      throw new Error(err.message, { cause: err });
    }
  };

  return {
    postcssPlugin: "ocx-catalog:contain-consumer-css",
    // `prepare` runs before any plugin's `Once`: the stylesheet's own `@import`s are judged before postcss-import
    // resolves them, so one it could not resolve is a refusal (exit 65), not a render failure.
    prepare(prepared: CssResult): { Once?: (css: CssRoot, helpers: CssHelpers) => void } {
      if (prepared.opts.from === undefined || real(prepared.opts.from.replace(/\?.*$/s, "")) !== entry) return {};
      refusing(() => prepared.root.walkAtRules("import", ({ params }) => checkImport(params, consumerCss)));
      return {
        Once(css, { result, postcss }) {
          refusing(() => {
            const graph = new Set([consumerCss, ...dependencies(result)]);
            const refs: [ref: string, origin: string][] = [];
            css.walk((node) => {
              const origin = node.source?.input?.file;
              if (origin === undefined) return;
              graph.add(origin);
              for (const ref of references(`${node.value ?? ""} ${node.params ?? ""}`)) refs.push([ref, origin]);
            });
            for (const file of graph) checkGraphFile(file);
            for (const [ref, origin] of refs) checkReference(ref, origin);
            // The `@import`s were inlined away: a config file's are re-read, so a relative one cannot reach `node_modules`.
            for (const file of graph) {
              if (!inConfig(real(file))) continue;
              postcss.parse(readFileSync(file, "utf8")).walkAtRules("import", ({ params }) => checkImport(params, file));
            }
          });
        },
      };
    },
  };
}

/** Where the parent looks for a violation after a failed render. */
export const violationPath = (scratch: string): string => join(scratch, CSS_VIOLATION_FILE);

/** The `report` callback the integration passes: records the message for the parent. */
export const recordViolation = (scratch: string) => (message: string): void => {
  writeFileSync(violationPath(scratch), message, "utf8");
};
