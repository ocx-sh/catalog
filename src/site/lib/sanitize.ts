// README sanitization chokepoint. `sanitizeReadmeHtml` sits between
// markdown-it's render output and the `v-html` sink in `ReadmePane.vue`,
// which is its only caller — every wire-sourced README string passes
// through here before reaching the DOM. Defense in depth, not the sole control: the
// pipeline it wraps already renders with `html: false` (raw HTML in the
// source is escaped to text, never parsed), so this module's job is (a) a
// second independent layer against a markdown-it config regression or a
// future plugin, and (b) the enabler for GFM affordances markdown-it alone
// can't express safely — table alignment, task-list checkboxes, highlighter
// styling — per `research_catalog_sanitizer_stack.md` (`@ocx-sh/index`,
// `.claude/artifacts/research_catalog_sanitizer_stack.md`).
//
// Environment contract: the shipped code path runs DOMPurify against the
// real browser DOM — no jsdom import anywhere under `src/**`. `v-html` only
// ever runs client-side, so `sanitizeReadmeHtml` is client-only BY DESIGN;
// see the SSR guard below for what a build-time (Node, no `window`) call
// does instead of silently passing raw HTML through unsanitized. Tests need
// a DOM to sanitize against; `dompurify` genuinely does not work under
// `happy-dom` (verified empirically — it silently drops the root element and
// strips `<input>` outright), so `test/theme/utils/sanitize.test.ts` opts
// into `// @vitest-environment jsdom` instead, per the research's own jsdom
// recommendation. Every other test in this package uses happy-dom; this is
// the one deliberate exception.
//
// Isolated instance, not the DOMPurify default export: `createDOMPurify(window)`
// builds a fresh instance with its own hook registry, independent of
// whatever else in the eventual consuming bundle might also import
// `dompurify` and register hooks on the shared default singleton. Built lazily
// on first call, not at module scope — VitePress prerenders `DetailPage.vue`
// (which statically imports `ReadmePane.vue`, no `ClientOnly` guard) under
// Node during SSG, where `window` is undefined; `createDOMPurify(undefined)`
// silently returns `{isSupported: false}` with no `.addHook` method at all,
// so a module-scope `purify.addHook(...)` throws at import time and takes
// every detail page's prerender down with it (verified empirically). Same
// `typeof window !== 'undefined'` guard already used elsewhere in this theme
// (`ReadmePane.vue`'s own `readmeUrl`, `CopyContextMenu.vue`'s copy-link
// action) — just applied at the sanitizer-instance level instead of a value.
//
// Logos are never inlined as raw SVG DOM — always `<img src="…">` (see
// `components/catalog/LogoTile.vue` and `components/detail/IdentityBlock.vue`,
// both wire-sourced logo render sites). That keeps a sanitizer bug from
// mattering for SVG at all (an `<img>`-embedded SVG is script-inert per the
// W3C webappsec note the research cites) and is why this module exports no
// `{svg: true}` sanitize path — there is no inline-SVG sink to protect.
import createDOMPurify, { type DOMPurify } from 'dompurify'

// GFM task-list checkboxes (`- [x] done`) render as
// `<input type="checkbox" disabled checked>` — DOMPurify has no GFM
// awareness, so the research calls for explicit `ADD_TAGS`/`ADD_ATTR`.
// Verified against DOMPurify 3.4.14's own defaults: `input`/`type`/
// `checked`/`disabled` are already in its built-in HTML allowlist, making
// this a documented no-op today rather than a functional requirement — kept
// explicit anyway (matches the research artifact verbatim, and survives a
// future DOMPurify default-list narrowing without silently losing GFM
// checkboxes).
const ADD_TAGS = ['input']
const ADD_ATTR = ['type', 'checked', 'disabled']

// `<style>` is, surprisingly, in DOMPurify's default *allowed* tag list —
// verified in `purify.cjs.js`'s own default tag set. It's a real CSS-based
// exfil vector with no legitimate use here (markdown-it's `html:false`
// output never emits one) — `background:url(https://…)`, attribute-selector
// data exfiltration, etc. — so it's force-excluded regardless of default.
// (Empirically, jsdom's own fragment parser drops a *leading* `<style>` node
// but keeps one with a preceding sibling — a parse5 quirk, not a security
// control; `FORBID_TAGS` removes it deterministically either way, in every
// environment.)
const FORBID_TAGS = ['style']

/** Exported for test introspection — not meant to be mutated by callers. */
export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS,
  ADD_ATTR,
  FORBID_TAGS,
} as const

// DOMPurify's default profile allows `style` unrestricted, which is too wide
// (style-based exfil via `expression()`/`url()` — verified empirically: both
// survive DOMPurify's default config untouched). A blanket `style` strip is
// too narrow — it would silently kill two things markdown-it's own output
// legitimately needs the attribute for. Property-based allowlist instead:
// split on `;`, keep the attribute only if every declaration matches one of
// these two families, strip the whole thing otherwise.
const STYLE_DECLARATION_ALLOWLIST = [
  // GFM table column alignment (`|:--|:-:|--:|`) — verified against real
  // markdown-it@14 output: `<th style="text-align:left">`, no trailing `;`,
  // no space after the colon.
  /^text-align:\s*(?:left|center|right)$/,
  // Shiki dual-theme highlight custom properties (research artifact, quoted
  // verbatim: `style="--shiki-light:…;--shiki-dark:…"`).
  //
  // Known limitation, flagged rather than guessed around: the research
  // prescribes deriving this allowlist "from one real `md.render()` sample,
  // not guesswork" — but the README pipeline this module currently wraps
  // (`ReadmePane.vue`) highlights via `highlight.js` (class-based `hljs-*`
  // tokens, no inline `style`), not Shiki. There is no real Shiki sample in
  // this tree yet to derive against. Scoped to exactly the two custom
  // properties the research artifact names; whichever WP wires Shiki
  // styling should re-derive/widen this against a real render then.
  /^--shiki-(?:light|dark):\s*#[0-9a-fA-F]{3,8}$/,
]

function isAllowedStyle(value: string): boolean {
  const declarations = value.split(';').map((d) => d.trim()).filter(Boolean)
  return declarations.length > 0 && declarations.every((d) => STYLE_DECLARATION_ALLOWLIST.some((re) => re.test(d)))
}

let purify: DOMPurify | undefined

function getPurify(): DOMPurify {
  if (typeof window === 'undefined') {
    // Silently returning unsanitized HTML here would be worse than crashing
    // the render — a named error surfaces a wiring mistake (this module
    // called from a Node/SSR path) loudly instead of shipping unsanitized
    // README content.
    throw new Error('sanitizeReadmeHtml is client-only (no `window` in this environment)')
  }
  if (!purify) {
    purify = createDOMPurify(window)
    purify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'style' && !isAllowedStyle(data.attrValue)) {
        data.keepAttr = false
      }
    })
  }
  return purify
}

/**
 * Sanitizes a rendered README HTML string before it reaches a `v-html`
 * sink. Strips scripts, event handlers, dangerous URI schemes, and
 * structurally dangerous tags (`iframe`, `object`, `embed`, `svg`, …) while
 * preserving GFM table alignment, task-list checkboxes, and Shiki
 * dual-theme highlight styling. Idempotent — sanitizing already-sanitized
 * output is a no-op. Client-only — throws under SSR/Node (no `window`); see
 * this module's header for why a silent unsanitized pass-through is not an
 * acceptable alternative there.
 */
export function sanitizeReadmeHtml(html: string): string {
  return getPurify().sanitize(html, SANITIZE_CONFIG)
}
