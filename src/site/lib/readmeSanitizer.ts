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
//  - only absolute `http(s):`, `mailto:` and `#fragment` link targets survive;
//    a protocol-relative, root-relative or relative `<a>` becomes its text.
//  - only absolute `http(s):` image sources survive; any other `<img>` is
//    dropped (a relative path would resolve against the CATALOG host and
//    could be pointed at any same-origin asset; `data:` is a tracking/size
//    vector).
//  - `<a>` always gets `rel="noopener noreferrer nofollow ugc"`; `<img>`
//    always gets `loading="lazy" decoding="async" referrerpolicy="no-referrer"` — remote README images must not leak the page URL.
//  - `class` is limited to highlight.js tokens (`hljs…`, `language-…`).
//  - `style` is limited to the declaration allowlist below.
//
// jsdom leaks memory per parsed document, so window and purifier are recycled
// every `RECYCLE_AFTER` documents with the hooks re-registered each time.
import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";
import { brandSanitized, type SanitizedHtml } from "./sanitizedHtml.js";

// `<style>` is in DOMPurify's default allowed list and is a CSS exfiltration
// vector. `form` and the media elements have no place in a README and would
// each give a second, unpoliced way to reach a remote host (a form `action`,
// a `<source srcset>`), bypassing the link/image policy above. The form
// controls (`input type=image` fetches its `src`, a `button` carries a
// `formaction`) and image maps (`map`/`area` re-open an `<a>`-like target
// without the link policy) are in the same class. markdown-it emits none of
// them: GFM task-list items render as text, not as `<input>`.
const FORBID_TAGS = [
  "style",
  "form",
  "input",
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
  // Shiki dual-theme custom properties (`--shiki-light:…;--shiki-dark:…`).
  /^--shiki-(?:light|dark):\s*#[0-9a-fA-F]{3,8}$/,
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
const SAFE_LINK = /^(?:https?:\/\/|mailto:|#)/i;
const SAFE_IMAGE = /^https?:\/\//i;

/** A jsdom-style window: DOMPurify's requirement plus a way to release it. */
export type ReadmeWindow = WindowLike & { close(): void };

export interface ReadmeSanitizer {
  /** Idempotent: `sanitize(sanitize(x)) === sanitize(x)`. */
  sanitize(html: string): SanitizedHtml;
  /** Closes the current window. Terminal: `sanitize` must not be called after. */
  close(): void;
}

export interface ReadmeSanitizerOptions {
  /** Documents sanitized before the window and purifier are recycled. */
  readonly recycleAfter?: number;
}

const RECYCLE_AFTER = 500;

function buildPurifier(window: ReadmeWindow): DOMPurify {
  const purify = createDOMPurify(window);
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    const { attrName, attrValue } = data;
    if (attrName === "style") {
      if (!isAllowedStyle(attrValue)) data.keepAttr = false;
    } else if (attrName === "class") {
      const kept = attrValue.split(/\s+/).filter((token) => HIGHLIGHT_CLASS.test(token));
      if (kept.length === 0) data.keepAttr = false;
      else data.attrValue = kept.join(" ");
    } else if (attrName === "href") {
      if (!SAFE_LINK.test(attrValue)) data.keepAttr = false;
    } else if (attrName === "src") {
      if (!SAFE_IMAGE.test(attrValue)) data.keepAttr = false;
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      // A link with no surviving target is its text.
      if (!node.hasAttribute("href")) node.replaceWith(...Array.from(node.childNodes));
      else node.setAttribute("rel", "noopener noreferrer nofollow ugc");
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
  let window = createWindow();
  let purify = buildPurifier(window);
  let count = 0;
  return {
    sanitize(html) {
      if (count >= recycleAfter) {
        window.close();
        window = createWindow();
        purify = buildPurifier(window);
        count = 0;
      }
      count++;
      return brandSanitized(purify.sanitize(html, SANITIZE_CONFIG));
    },
    close() {
      window.close();
    },
  };
}
