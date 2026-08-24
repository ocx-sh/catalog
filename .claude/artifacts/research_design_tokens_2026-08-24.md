# Research: CSS custom-property interface design — @ocx-sh/catalog @ 4d0c2ff

Date: 2026-08-24. Question that prompted it: a corporate mirror configures
this renderer's appearance through exactly one channel —
`catalog.config.json`'s `css` field. Is our variable set the right *interface*
for that, and how should such a set be named and layered?

Secondary question, raised and settled here: should the theme adopt
VitePress's own `--vp-*` variables instead of its own set?

## 1. Current state (measured, 2026-08-24)

Facts, not opinions — each verified against the tree at `4d0c2ff`.

| Fact | Evidence |
|---|---|
| 42 custom properties, all defined in `src/theme/styles/tokens/*.css` and nowhere else | `grep -rnE '^\s*--[a-zA-Z0-9-]+\s*:' src/` returns hits only under `styles/tokens/` |
| Zero hardcoded hex in any `.vue` | `grep -rn '#[0-9a-fA-F]{3,8}'` over `src/theme/**/*.vue` → no colour hits; one `rgba()` (`CopyToast.vue:31` box-shadow) |
| 20 colour + 10 type + 12 shape = 42 | `palette.css` (20 in `:root`, 19 in `.dark` — `--c-overlay` is deliberately light-only), `type.css`, `shape.css` |
| VitePress core ships **no** CSS at all | `find node_modules/vitepress/dist/client -name '*.css' -not -path '*theme-default*'` → empty |
| `--vp-*` exists only in the default theme: 259 vars (76 colour), 575 lines | `theme-default/styles/vars.css` |
| The built site contains zero `--vp-` references | `grep -c -- '--vp-' .lhci-site/assets/style.*.css` → 0 |
| 445 scoped `[data-v-<hash>]` selectors in the built CSS | `grep -o 'data-v-[0-9a-f]*' .lhci-site/assets/style.*.css \| wc -l` |
| `shiki` 4.4.3 ships `createCssVariablesTheme` | `@shikijs/core/dist/index.d.mts:164`; implementation at `index.mjs:1237` (prefix `--shiki-`, roles `token-keyword`, `token-string`, …) |

### Defects this surfaced

**D1 — a `:root`-only override leaks into dark mode.** Consumer CSS is
imported after the theme's (`config_gen.ts`'s `renderThemeShim`). `:root` and
`.dark` have identical specificity (0,1,0) and both match `<html>`, so source
order decides and the consumer's `:root` wins in *both* modes. Reproduced with
happy-dom: theme `.dark{--c-bg:#0e1116}` + consumer `:root{--c-bg:#ffeeee}` →
computed `--c-bg` under `html.dark` is `#ffeeee`. Not a bug we introduced —
VitePress's own `vars.css` has the identical shape — but
`docs/how-to/customize-branding-and-docs.md:56` documents the opposite.

**D2 — consumer *selectors* mostly cannot win.** Scoped rules carry
`[data-v-<hash>]` (0,2,0), e.g. `.package-card[data-v-e7517417]`. A consumer's
`.package-card{}` (0,1,0) loses regardless of order, and the hash rotates per
build so it cannot be targeted stably. Tokens are the only reliable override
surface — yet the same doc, line 33, promises "any custom property **or
selector** your file redeclares wins the cascade".

**D3 — 34 colours are unreachable from CSS**, so a mirror cannot rebrand them:

- `src/build/config_gen.ts:188-206` — 18 hex baked into the Shiki theme.
- `src/theme/utils/monogram.ts:16` — 16 hex/rgba in `MONOGRAM_HUES`, applied
  as inline `style` (overridable only with `!important`).
- `palette.css:79-85` — `--c-accent-tint-bg`/`-tint-border`, `--c-warn-bg`,
  `--c-kw-bg` are literal `rgba()` copies of the brand hex, so overriding
  `--c-accent` leaves the tints coral. Seven *other* sites already use
  `color-mix(in srgb, var(--c-accent) 8%, transparent)` and do follow — two
  mechanisms for one concept.

Consequence of D3: the same language renders in two different palettes on one
site. README fences (highlight.js, `ReadmePane.vue:341+`) read `--c-kw`/`--c-ok`
and follow a rebrand; docs-mount fences (Shiki) do not.

## 2. What the field agrees on

### Three tiers, referenced downward only

Primitive (`red-500` — raw value, no meaning) → semantic/alias
(`color-bg-surface` — the role) → component (`button-bg-primary`). A token
references exactly one tier below it: never skips, never sideways. The
semantic layer is the insulation — swap semantics and every component updates,
swap primitives and every theme updates.

- [Honcho — Token tiers](https://honcho.agency/design-systems/glossary/token-tiers)
- [zeroheight — How design tokens work](https://zeroheight.com/learn/how-design-tokens-work-types-structure-and-hierarchy/)
- [Netguru — Design token naming best practices](https://www.netguru.com/blog/design-token-naming-best-practices)

### Name for meaning, not value

`--ds-color-accent`, never `--ds-color-green-500`. Formula in common use:
`{namespace}-{category}-{role}-{modifier}`. Regular systems use 2–4 levels;
5–6 only for large multi-platform ones.

- [Smart Interface Design Patterns — How to name design tokens](https://smart-interface-design-patterns.com/articles/naming-design-tokens/)
- [Style Dictionary — Design tokens (CTI: Category/Type/Item)](https://styledictionary.com/info/tokens/)
- [Cristiano Rastelli — why CTI is too rigid](https://didoo.medium.com/because-ive-found-the-cti-category-type-item-structure-very-rigid-and-sometimes-you-find-82e1e059b2aa)

### A library's public API is the semantic tier — and never a colour knob

Two-tier CSS custom-property model: tier 1 is global theme tokens at `:root`;
tier 2 is each component's *structural* local API (padding, widths). Colour is
explicitly **not** a per-component knob — components consume colour implicitly
from the environment, and a "make this one red" request gets a variant class,
not a colour property. Also names the cascade subtlety that a value declared
*on* an element beats one inherited from an ancestor.

- [Kevin Dench — Two-tier CSS custom properties](https://www.kevindench.design/posts/two-tier-css-custom-properties-design-systems)

### Namespace the prefix

`--vp-`, `--md-`, `--ds-`. Ours (`--c-`, `--text-`, `--space-`) is a *category*
prefix, not a namespace: a mirror that defines its own `--c-line` collides with
us silently. (Same source as above; also the M3 `md.sys.color.*` convention.)

### The named pitfall is over-tokenization

"Creating too many tokens too early." Aim for the Goldilocks zone — not so
precise the set explodes combinatorially, not so generic it means nothing.
Inline genuinely fixed values rather than minting a token for everything.

- [Nate Baldwin — When "semantic tokens" are no longer semantic](https://www.designsystemscollective.com/when-semantic-tokens-are-no-longer-semantic-d65ef16fadd7)
- [design.dev — Design systems & design tokens explained](https://design.dev/guides/design-systems/)

### Numbered scales are legitimate — with a published role per number

Radix's 12 steps work *because* each has exactly one documented job: 1 app bg,
2 subtle bg, 3 UI element bg, 4 hovered, 5 active/selected, 6 subtle border,
7 border/focus ring, 8 hovered border, 9 solid bg, 10 hovered solid, 11
low-contrast text, 12 high-contrast text. Absent that table, a number is
noise — our `--c-text-1/-2/-3` and `--c-surface-2` have no such table, and the
number says nothing about direction or job.

- [Radix Colors — Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)

### Pair each surface with its foreground

Material 3's `on-` prefix (`color-primary` / `color-on-primary`) exists to make
accessible pairings structural rather than remembered — directly relevant given
the WCAG ratios already measured into `palette.css`'s header comment.

- [Material Design 3 — Color roles](https://m3.material.io/styles/color/roles)

### DTCG format is stable but not needed here

The Design Tokens Format Module reached its first stable version (2025.10);
Figma, Style Dictionary, Terrazzo and others implement it. It is a
Community-Group report, not on the W3C standards track.

- [DTCG — first stable version announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)

Not adopted: a JSON source format plus generator earns its keep with multiple
output targets. Once Shiki reads CSS variables and monogram colours move to
CSS, this repo has **one** target. A build system with a single target is the
over-engineering the over-tokenization sources warn about.

## 3. Conclusions for this repo

**C1 — Do not import `--vp-*`.** VitePress core ships no CSS; those variables
live in the default theme, which `src/theme/index.mts:40` deliberately does not
extend. Adopting them means importing a 259-variable sheet of which ~15 map to
anything we render (the rest drive `.vp-sidebar`, `.vp-doc`, `.vp-button`,
sponsor blocks, DocSearch), and our 37 components use zero `.vp-*` classes.
It also would not fix D1 — `vars.css` has the same `:root`/`.dark` shape. Net
effect would be a *larger* undocumented surface handed to mirrors, which is the
opposite of the goal.

**C2 — Two tiers, and the primitive tier stays tiny and private.** The full
three-tier build targets multi-brand, multi-platform systems. What justifies
any primitive layer here is narrow and concrete: four status hues are currently
duplicated across `palette.css`, `monogram.ts:16`, and `config_gen.ts:190` —
three real callers, which clears `quality-core.md`'s own DRY bar. Everything
else derives with `color-mix()`. Component-tier tokens: none (YAGNI, and the
sources advise against colour knobs there regardless).

**C3 — Every colour must be reachable from CSS.** Fixes for D3:
`createCssVariablesTheme()` for Shiki (confirmed available), `MONOGRAM_HUES`
→ CSS classes with the hue index staying in JS, stored rgba tints →
`color-mix()` on the token they tint. Both highlighters then read one code
palette, ending the two-palette split.

**C4 — Naming.** `--ocx-{category}-{role}[-{modifier}]`. The category segment
is load-bearing, not decoration: without it `--ocx-text` (colour) collides with
`--ocx-text-lg` (size). So colours are `--ocx-color-*`, sizes `--ocx-text-*`.
Role names replace bare numbers (`fg`/`fg-muted`/`fg-subtle`,
`surface`/`surface-subtle`) *except* for the monogram rotation set, where
numbers are correct for Radix's own reason — an arbitrary set whose members
have no individual meaning.

`--c-kw` gets split. It currently serves as both "code keyword colour" and "a
purple status hue for monograms", which is exactly Baldwin's *semantic token
that stopped being semantic*.

Resulting set: ~52 tokens (up from 42) while deleting 34 hardcoded colours
from `.ts`. Type/shape tokens change prefix only.

**C5 — Contract, enforced.** Every colour token defined in **both** `:root` and
`.dark`, with an allowlist for deliberate exceptions (`--c-overlay` today). A
lint gate proves it, and a grep gate fails on any literal colour outside the
token files. Both must be demonstrated red before green (`quality-core.md`,
"Unchecked Green"). `--arch-cols` and `--mg-*` are private internals, not API.

## 4. Open decisions

1. **The `--ocx-` rename is breaking** for any mirror shipping a `custom.css`,
   including `ocx-sh/index`. Pre-1.0 permits it, but it touches all 37
   components and needs a migration note — or a one-minor alias shim.
2. Role names vs. keeping `-1/-2/-3`.
3. Whether `ocx-sh/index` ships a `custom.css` today — decides whether a
   CHANGELOG note suffices.

The durable half of this research is the rule
[`quality-design-tokens.md`](../rules/quality-design-tokens.md); this file is
the evidence and the sources behind it.
