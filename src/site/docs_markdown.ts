/**
 * Markdown handling for the consumer docs mount: the one Sätteri hast plugin
 * the docs collection's markdown runs through (wired in `astro_config.ts`;
 * READMEs never reach Astro's processor, they take the parent-side sanitiser).
 * Docs are authored file-relative with `.md` links, as VitePress served them,
 * but are rendered at directory routes under `base`, so an unrewritten
 * `./m1-flip` resolves one level too deep and a root-relative `/docs/…` link
 * loses `base`. Only the same-origin forms are rewritten; any other `href` is
 * left alone. The plugin also fails the build on a link to a docs page or file
 * that does not exist (VitePress's dead-link check), opens external links in a
 * new tab, and gives every heading a permalink anchor.
 */
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import GithubSlugger from "github-slugger";
import type { HastVisitorContext } from "satteri";
import { statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { joinBase } from "../viewmodel/url.js";

type HastPluginEntry = NonNullable<SatteriProcessorOptions["hastPlugins"]>[number];
type LinkingElement = Parameters<HastVisitorContext["setProperty"]>[0] & { properties: Record<string, unknown> };

/** The docs mount's route prefix (`integration.ts` injects `/docs/[...slug]`). */
const DOCS_MOUNT = "/docs";
/** A scheme (`https:`, `mailto:`), a protocol-relative `//`, or a same-page `#fragment`. */
const NOT_SAME_ORIGIN_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
/** A link that leaves the site: absolute `http(s)` or protocol-relative. */
const EXTERNAL = /^(?:https?:)?\/\//i;
/** Resolution origin only; a `URL` normalises `.`/`..`/`\` and percent-encodes, and clamps `..` at the root. */
const ORIGIN = "http://docs.invalid";

/** What a rewritten link points at inside the docs directory, when that can be checked. */
export interface DocsTarget {
  /** `page`: a route (`<path>.md` or `<path>/index.md`); `file`: an asset beside the pages. */
  readonly kind: "page" | "file";
  /** Decoded path below the docs directory, `/`-separated, no leading `/`; `""` is the docs root page. */
  readonly path: string;
}

export interface DocsLink {
  readonly href: string;
  /** Absent for a link that is left alone, or points outside the docs mount. */
  readonly target?: DocsTarget;
}

/** The decoded path below the docs mount, no leading or trailing `/`. */
const docsPath = (pathname: string): string => decodeURIComponent(pathname).replace(/^\/|\/$/g, "");

/**
 * Resolves one `href` found in the docs file `file` (its path below the docs
 * directory, `/`-separated). A relative link resolves against the FILE, then a
 * `.md` target (or an extensionless one) becomes its directory route
 * (`index.md` serves at its directory, as `scanDocs` routes it) under
 * `<base>docs/`, and a target with another extension is a file served at the
 * same path below `<base>docs/`; `?query` and `#fragment` are kept. A
 * root-relative link gets `base`, and is checked only when it lies under
 * `/docs/`. A link `joinBase` refuses (`/a/..//x`) or that cannot be decoded
 * is returned unchanged and unchecked: a dead link beats a failed render.
 */
export const resolveDocsLink = (href: string, file: string, base: string): DocsLink => {
  try {
    return resolve(href, file, base);
  } catch {
    return { href };
  }
};

/** `resolveDocsLink`'s rewritten `href` alone. */
export const rewriteDocsHref = (href: string, file: string, base: string): string =>
  resolveDocsLink(href, file, base).href;

const resolve = (href: string, file: string, base: string): DocsLink => {
  if (href === "" || NOT_SAME_ORIGIN_PATH.test(href)) return { href };
  // The file name is a path of segments, not a URL: `#`, `?` and `%` in it are literal.
  const encodedFile = file.split("/").map(encodeURIComponent).join("/");
  const { pathname, search, hash } = new URL(href, `${ORIGIN}${href.startsWith("/") ? "/" : `/${encodedFile}`}`);
  const tail = search + hash;
  if (href.startsWith("/")) {
    // Below the mount a root-relative link is the built URL of a page or file, so a `.md` spelling gets its route
    // as a relative link would; anywhere else (a package page, the catalog) it only gets `base`.
    if (!pathname.startsWith(`${DOCS_MOUNT}/`)) return { href: joinBase(base, pathname) + tail };
    const inMount = pathname.slice(DOCS_MOUNT.length);
    return { href: joinBase(base, `${DOCS_MOUNT}${route(inMount)}`) + tail, target: docsTarget(inMount) };
  }
  return { href: joinBase(base, `${DOCS_MOUNT}${route(pathname)}`) + tail, target: docsTarget(pathname) };
};

/** The route of a docs-relative `pathname`: a `.md` file is its page, an extensionless name or a directory a page, any other file itself. */
const route = (pathname: string): string => {
  if (pathname.endsWith(".md")) {
    const page = pathname.slice(0, -".md".length);
    return page.endsWith("/index") ? page.slice(0, -"index".length) : `${page}/`;
  }
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last === "" || last.includes(".") ? pathname : `${pathname}/`;
};

/** A route ends in `/` and is a page; anything else is a file. */
const docsTarget = (pathname: string): DocsTarget => {
  const target = route(pathname);
  return { kind: target.endsWith("/") ? "page" : "file", path: docsPath(target) };
};

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

/** A decoded path that stays below its root: no `.` or `..` segment, no backslash, no NUL. */
const CONTAINED = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0]*$/s;

/**
 * Whether `target` exists. A page is `<path>.md` or `<path>/index.md` below
 * `docsDir`, and not under a dot-directory (`scanDocs` skips those). A file is
 * looked up in `<publicDir>/docs/`, the built site's own `docs/` tree: it holds
 * exactly what `copyDocsAssets` carried plus whatever the consumer's `publicDir`
 * serves there, so a dot-file or a `.md` source is not found. The path was
 * decoded from the link, so a `..` in it is refused rather than followed.
 */
export const docsTargetExists = (docsDir: string, publicDir: string, { kind, path }: DocsTarget): boolean => {
  if (!CONTAINED.test(path)) return false;
  if (kind === "file") return isFile(join(publicDir, "docs", path));
  if (path.split("/").some((segment) => segment.startsWith("."))) return false;
  return isFile(join(docsDir, path === "" ? "index.md" : `${path}.md`)) || isFile(join(docsDir, path, "index.md"));
};

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * The hast plugin for a docs directory: a per-document factory, so it knows
 * which file it is rendering (`fileURL`) and sits out any document that is not
 * inside `docsDir`. Headings get their id here (github-slugger, the algorithm
 * Astro's own heading-ids plugin runs after this one, which keeps an id that is
 * already set) so the permalink anchor appended to each can point at it.
 */
export const docsMarkdownPlugin = (docsDir: string, base: string, publicDir: string): HastPluginEntry => ({ fileURL }) => {
  if (fileURL === undefined) return null;
  const file = relative(docsDir, fileURLToPath(fileURL)).split(sep).join("/");
  if (file.startsWith("../")) return null;
  const slugger = new GithubSlugger();
  /** Rewrites the same-origin URL in `node[key]`, and fails the render when it names a docs page or file that is missing. */
  const relink = (node: LinkingElement, ctx: HastVisitorContext, key: "href" | "src"): void => {
    const url = node.properties[key];
    if (typeof url !== "string") return;
    const link = resolveDocsLink(url, file, base);
    if (link.target !== undefined && !docsTargetExists(docsDir, publicDir, link.target)) {
      throw new Error(`docs: ${file} links to "${url}", which is not a ${link.target.kind} in the docs directory`);
    }
    if (link.href !== url) ctx.setProperty(node, key, link.href);
  };
  return {
    name: "ocx-catalog-docs-markdown",
    element: [
      {
        filter: ["a"],
        visit(node, ctx) {
          if (typeof node.properties.href === "string" && EXTERNAL.test(node.properties.href)) {
            ctx.setProperty(node, "target", "_blank");
            ctx.setProperty(node, "rel", "noreferrer");
          } else {
            relink(node, ctx, "href");
          }
        },
      },
      // Images take the link path, not Astro's image pipeline (which needs `sharp` and hashes the file
      // into `_astro/`): a relative `src` becomes the URL of the file `copyDocsAssets` serves, and Astro's
      // marker plugin, which runs after this one, leaves a `src` it did not collect untouched.
      { filter: ["img"], visit: (node, ctx) => relink(node, ctx, "src") },
      {
        filter: HEADINGS,
        visit(node, ctx) {
          const existing = node.properties.id;
          const text = ctx.textContent(node);
          const id = typeof existing === "string" ? existing : slugger.slug(text);
          if (typeof existing !== "string") ctx.setProperty(node, "id", id);
          ctx.appendChild(node, {
            type: "element",
            tagName: "a",
            properties: { className: ["header-anchor"], href: `#${id}`, ariaLabel: `Permalink to “${text}”` },
            children: [],
          });
        },
      },
    ],
  };
};
