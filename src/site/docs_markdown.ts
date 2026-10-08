/**
 * Link rewriting for the consumer docs mount: the one Sätteri hast plugin the
 * docs collection's markdown runs through (wired in `astro_config.ts`; READMEs
 * never reach Astro's processor, they take the parent-side sanitiser). Docs are
 * authored file-relative with `.md` links, as VitePress served them, but are
 * rendered at directory routes under `base`, so an unrewritten `./m1-flip`
 * resolves one level too deep and a root-relative `/docs/…` link loses `base`.
 * Only the same-origin forms are rewritten; any other `href` is left alone.
 */
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { joinBase } from "../viewmodel/url.js";

type HastPluginEntry = NonNullable<SatteriProcessorOptions["hastPlugins"]>[number];

/** The docs mount's route prefix (`integration.ts` injects `/docs/[...slug]`). */
const DOCS_MOUNT = "/docs";
/** A scheme (`https:`, `mailto:`), a protocol-relative `//`, or a same-page `#fragment`. */
const NOT_SAME_ORIGIN_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
/** Resolution origin only; a `URL` normalises `.`/`..`/`\` and percent-encodes, and clamps `..` at the root. */
const ORIGIN = "http://docs.invalid";

/**
 * Rewrites one `href` found in the docs file `file` (its path below the docs
 * directory, `/`-separated). A relative link resolves against the FILE, then a
 * `.md` target (or an extensionless one) becomes its directory route
 * (`index.md` serves at its directory, as `scanDocs` routes it) under
 * `<base>docs/`; `?query` and `#fragment` are kept. A root-relative link gets
 * `base`. A relative link to a non-`.md` file is returned unchanged, and so is
 * one `joinBase` refuses (`/a/..//x`): a dead link beats a failed render.
 */
export const rewriteDocsHref = (href: string, file: string, base: string): string => {
  try {
    return rewrite(href, file, base);
  } catch {
    return href;
  }
};

const rewrite = (href: string, file: string, base: string): string => {
  if (href === "" || NOT_SAME_ORIGIN_PATH.test(href)) return href;
  // The file name is a path of segments, not a URL: `#`, `?` and `%` in it are literal.
  const encodedFile = file.split("/").map(encodeURIComponent).join("/");
  const { pathname, search, hash } = new URL(href, `${ORIGIN}${href.startsWith("/") ? "/" : `/${encodedFile}`}`);
  if (href.startsWith("/")) return joinBase(base, pathname) + search + hash;
  if (pathname.endsWith(".md")) {
    const page = pathname.slice(0, -".md".length);
    const route = page.endsWith("/index") ? page.slice(0, -"index".length) : `${page}/`;
    return joinBase(base, `${DOCS_MOUNT}${route}`) + search + hash;
  }
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (last === "") return joinBase(base, `${DOCS_MOUNT}${pathname}`) + search + hash;
  return last.includes(".") ? href : joinBase(base, `${DOCS_MOUNT}${pathname}/`) + search + hash;
};

/**
 * The hast plugin for a docs directory: a per-document factory, so it knows
 * which file it is rendering (`fileURL`) and sits out any document that is not
 * inside `docsDir`.
 */
export const docsLinksPlugin = (docsDir: string, base: string): HastPluginEntry => ({ fileURL }) => {
  if (fileURL === undefined) return null;
  const file = relative(docsDir, fileURLToPath(fileURL)).split(sep).join("/");
  if (file.startsWith("../")) return null;
  return {
    name: "ocx-catalog-docs-links",
    element: {
      filter: ["a"],
      visit(node, ctx) {
        const href = node.properties.href;
        if (typeof href !== "string") return;
        const rewritten = rewriteDocsHref(href, file, base);
        if (rewritten !== href) ctx.setProperty(node, "href", rewritten);
      },
    },
  };
};
