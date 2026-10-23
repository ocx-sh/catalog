// The build-time README sanitizer (C-014). A factory over an injected jsdom
// window: this runs under Node during the Astro build, so there is no ambient
// `window` to find and none is ever read — the caller owns the window's
// lifetime and `runScripts`/`resources` stay at their jsdom defaults (off), so
// nothing in a README can execute or load while it is parsed.
//
// Defence in depth, not the sole control: the pipeline already renders with
// markdown-it `html: false` (raw HTML is escaped to text, never parsed). This
// layer guards against a markdown-it config regression or a future plugin, and
// carries the link/image policy the markdown renderer cannot express.
//
// Policy on top of DOMPurify's html profile:
//  - link targets: absolute `http(s):`, `mailto:` and `#fragment` survive as
//    written. A protocol-relative `//host/x` survives as `https://host/x`. A
//    relative or root-relative target survives only when the caller says where
//    the README lives (`ReadmeLinkContext`) and is rewritten to a `base`-joined
//    path under that package's `p/<ns>/<pkg>/` wire directory; anything that
//    would land outside the sandboxed `p/*` prefix (`../../..`), names a file
//    the mirror did not write (`ReadmeLinkContext.mirrored`: a link to a LICENSE
//    or `docs/x.md` would be a dead internal link), or has any other scheme
//    (`javascript:`, `data:`) becomes its text. Without a context only
//    the absolute forms survive.
//  - image sources: the same forms as links, minus `mailto:`/`#`, plus a
//    `data:image/{png,jpeg,gif,webp,avif,svg+xml};base64,…` URI. Any other
//    `<img>` is dropped.
//  - GFM task-list checkboxes survive as `<input type="checkbox" [checked]
//    disabled>`; every other `<input>` is removed.
//  - `<a>` always gets `rel="noopener noreferrer nofollow ugc"`; `<img>`
//    always gets `loading="lazy" decoding="async" referrerpolicy="no-referrer"` — remote README images must not leak the page URL.
//  - `class` is limited to highlight.js tokens (`hljs…`, `language-…`) on `code` and `span`.
//  - `style` is limited to GFM table alignment (`text-align`); nothing else emits one.
//
// jsdom leaks memory per parsed document, so window and purifier are recycled
// every `RECYCLE_AFTER` documents with the hooks re-registered each time.
import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";
import { joinBase } from "../../viewmodel/url.js";
import { brandSanitized, type SanitizedHtml } from "./sanitizedHtml.js";

// `<style>` is in DOMPurify's default allowed list and is a CSS exfiltration
// vector. `form` and the media elements have no place in a README and would
// each give a second, unpoliced way to reach a remote host (a form `action`,
// a `<source srcset>`), bypassing the link/image policy above. The form
// controls (a `button` carries a `formaction`) and image maps (`map`/`area`
// re-open an `<a>`-like target without the link policy) are in the same class.
// `input` is allowed through DOMPurify only to be reduced to a disabled
// checkbox in `afterSanitizeAttributes` (`type=image` fetches its `src`).
const FORBID_TAGS = [
  "style",
  "form",
  "button",
  "textarea",
  "select",
  "map",
  "area",
  "video",
  "audio",
  "source",
  "track",
  "picture",
];
const FORBID_ATTR = ["srcset", "poster", "action", "formaction", "background", "download", "usemap"];

/** Exported for test introspection — not meant to be mutated by callers. */
export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  SANITIZE_NAMED_PROPS: true,
} as const;

const STYLE_DECLARATION_ALLOWLIST = [
  // GFM table column alignment (`|:--|:-:|--:|`): markdown-it emits
  // `<th style="text-align:left">`.
  /^text-align:\s*(?:left|center|right)$/,
];

/** True when every declaration of a `style` attribute is on the allowlist. */
export function isAllowedStyle(value: string): boolean {
  const declarations = value
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  return declarations.length > 0 && declarations.every((d) => STYLE_DECLARATION_ALLOWLIST.some((re) => re.test(d)));
}

// A whole-token test: a prefix test would let a fence info string like `"><img`
// through as `language-"><img`.
const HIGHLIGHT_CLASS = /^(?:hljs[\w-]*|language-[\w+#.-]+)$/;
const HIGHLIGHT_ELEMENTS: ReadonlySet<string> = new Set(["CODE", "SPAN"]);
const SAFE_LINK = /^(?:https?:\/\/|mailto:|#)/i;
// A data: image is capped at 256 KiB of base64 so a README cannot inline a payload.
const SAFE_IMAGE = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=]{0,262144}$)/i;

/** Mirrored document types a browser runs script from; a same-origin link to one is refused. */
const SCRIPT_CAPABLE = /\.(?:svgz?|x?html?|xml|mht)$/i;

/** Where a README lives, so its relative targets can be resolved (see the policy above). */
export interface ReadmeLinkContext {
  /** The site's `base` (`/` or `/seg/`). */
  readonly base: string;
  /** Catalog-root-relative CAS path: `[/index/<label>]/p/<ns>/<pkg>/o/sha256/<hex>.md`. */
  readonly readmeUrl: string;
  /**
   * True when the file at this catalog-root-relative, still percent-encoded path
   * (`p/<ns>/<pkg>/o/sha256/<hex>.svg`, no leading slash) exists in the mirrored tree.
   */
  readonly mirrored: (path: string) => boolean;
}

// A stand-in origin: relative targets are parsed against it, then only their
// path leaves this module. The reserved `.invalid` TLD cannot be a real host.
const ORIGIN = "https://readme.invalid";
const README_WIRE_PATH = /^((?:\/index\/[^/]+)?\/p\/)(.+\/)o\/sha256\/[^/]+$/;

interface WireLocation {
  readonly base: string;
  readonly mirrored: (path: string) => boolean;
  /** The sandboxed prefix, `base`-joined: every resolved path must stay under it. */
  readonly sandbox: string;
  /** The package's wire directory as an absolute URL on `ORIGIN`. */
  readonly packageDir: string;
}

function wireLocation({ base, readmeUrl, mirrored }: ReadmeLinkContext): WireLocation | undefined {
  const match = README_WIRE_PATH.exec(readmeUrl);
  if (match === null) return undefined;
  return { base, mirrored, sandbox: joinBase(base, match[1]), packageDir: ORIGIN + joinBase(base, match[1] + match[2]) };
}

function parse(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/**
 * A relative, root-relative or protocol-relative target as the path (or
 * `https:` URL) to emit, `null` when it must die. The URL parser does the
 * normalisation a browser would (`\` and `%2e%2e` dot segments, tab/newline
 * stripping), and the check runs on its output, so what is emitted is what was
 * checked. A root-relative path already under the sandbox is kept (this is what
 * makes a second pass a fixed point); any other is read as relative to the
 * package directory, never to the host root.
 */
function resolveTarget(value: string, wire: WireLocation): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let url = parse(value, wire.packageDir);
  if (url === null) return null;
  if (url.origin !== ORIGIN) return url.protocol === "https:" ? url.href : null;
  if (/^[\\/]/.test(trimmed) && !url.pathname.startsWith(wire.sandbox)) {
    // `./` keeps a leftover like `http://x` a path, never a new origin.
    url = new URL(`./${trimmed.replace(/^[\\/]+/, "")}`, wire.packageDir);
  }
  const { pathname } = url;
  const inside = pathname.startsWith(wire.sandbox) && wire.mirrored(pathname.slice(wire.base.length));
  return inside ? pathname + url.search + url.hash : null;
}

/** A jsdom-style window: DOMPurify's requirement plus a way to release it. */
export type ReadmeWindow = WindowLike & { close(): void };

export interface ReadmeSanitizer {
  /**
   * Idempotent for a fixed `links`: `sanitize(sanitize(x, l), l) === sanitize(x, l)`.
   * Without `links` only absolute targets survive.
   */
  sanitize(html: string, links?: ReadmeLinkContext): SanitizedHtml;
  /** Closes the current window. Terminal: `sanitize` must not be called after. */
  close(): void;
}

export interface ReadmeSanitizerOptions {
  /** Documents sanitized before the window and purifier are recycled. */
  readonly recycleAfter?: number;
}

const RECYCLE_AFTER = 500;

/** A link or image target as emitted, `null` when it must die. */
function target(value: string, absolute: RegExp, wire: WireLocation | undefined): string | null {
  if (absolute.test(value)) return value;
  return wire === undefined ? null : resolveTarget(value, wire);
}

function buildPurifier(window: ReadmeWindow, wire: () => WireLocation | undefined): DOMPurify {
  const purify = createDOMPurify(window);
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const { attrName, attrValue } = data;
    if (attrName === "style") {
      if (!isAllowedStyle(attrValue)) data.keepAttr = false;
    } else if (attrName === "class") {
      const kept = attrValue.split(/\s+/).filter((token) => HIGHLIGHT_CLASS.test(token));
      // Only the highlighter's own elements carry classes (`<code>`, token `<span>`s).
      if (kept.length === 0 || !HIGHLIGHT_ELEMENTS.has(node.nodeName)) data.keepAttr = false;
      else data.attrValue = kept.join(" ");
    } else if (attrName === "href" || attrName === "src") {
      const resolved = target(attrValue, attrName === "href" ? SAFE_LINK : SAFE_IMAGE, wire());
      const scriptLink = attrName === "href" && resolved !== null && !SAFE_LINK.test(attrValue) && SCRIPT_CAPABLE.test(resolved.replace(/[?#].*$/s, ""));
      if (resolved === null || scriptLink) data.keepAttr = false;
      else data.attrValue = resolved;
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      // A link with no surviving target is its text.
      if (!node.hasAttribute("href")) node.replaceWith(...Array.from(node.childNodes));
      else node.setAttribute("rel", "noopener noreferrer nofollow ugc");
    } else if (node.nodeName === "INPUT") {
      // A GFM task-list item: a disabled checkbox and nothing else (an
      // `<input type=image>` would fetch its `src`).
      if (node.getAttribute("type")?.toLowerCase() !== "checkbox") node.remove();
      else {
        const checked = node.hasAttribute("checked");
        for (const name of node.getAttributeNames()) node.removeAttribute(name);
        node.setAttribute("type", "checkbox");
        if (checked) node.setAttribute("checked", "");
        node.setAttribute("disabled", "");
      }
    } else if (node.nodeName === "IMG") {
      if (!node.hasAttribute("src")) node.remove();
      else {
        // Order matters: DOMPurify re-appends the attributes it keeps, so
        // this is the order a second pass reproduces (tripwire idempotency).
        node.setAttribute("loading", "lazy");
        node.setAttribute("decoding", "async");
        node.setAttribute("referrerpolicy", "no-referrer");
      }
    }
  });
  return purify;
}

/**
 * @param createWindow returns a FRESH window per call (`new JSDOM("").window`)
 *   — it is called again each time the sanitizer recycles. The sanitizer closes
 *   every window it retires.
 */
export function createReadmeSanitizer(
  createWindow: () => ReadmeWindow,
  { recycleAfter = RECYCLE_AFTER }: ReadmeSanitizerOptions = {},
): ReadmeSanitizer {
  // The hooks read the location of the document being sanitized; one document
  // at a time, synchronously.
  let wire: WireLocation | undefined;
  let window = createWindow();
  let purify = buildPurifier(window, () => wire);
  let count = 0;
  return {
    sanitize(html, links) {
      if (count >= recycleAfter) {
        window.close();
        window = createWindow();
        purify = buildPurifier(window, () => wire);
        count = 0;
      }
      count++;
      wire = links === undefined ? undefined : wireLocation(links);
      return brandSanitized(purify.sanitize(html, SANITIZE_CONFIG));
    },
    close() {
      window.close();
    },
  };
}
