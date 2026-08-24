---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.styl"
  - "src/theme/**/*.vue"
---

# Design Tokens — the CSS custom-property interface

Governs how CSS custom properties are named, layered, and exposed. Loads for
any stylesheet and for the theme's `.vue` files, where most of this repo's CSS
actually lives (`<style scoped>` blocks).

Only `.css` and `src/theme/**/*.vue` match anything today — the `.scss`/`.sass`/
`.less`/`.styl` globs are forward guards, and the rule still fires without them.

Scope split, no restatement:
[`subsystem-theme.md`](./subsystem-theme.md) owns the component-side rule
("every value is a token, never a literal") and the `.dark` toggle mechanism.
[`quality-css-overrides.md`](./quality-css-overrides.md) owns the cascade — how
a consumer's rule is *able* to win. This file owns which values exist and what
they are named. Severity tiers and the "Unchecked Green" evidence bar are
[`quality-core.md`](./quality-core.md)'s.

## Why this is an API, not styling

A consumer's entire ability to theme a rendered catalog is one file —
`catalog.config.json`'s `css`, imported after the theme's own CSS. A value that
is not a token is a value a corporate mirror can never change: a colour baked
into a `.ts` constant or into generated config is invisible to that file, and
a literal buried in a scoped rule is unreachable without the cascade machinery
the sibling rule sets up.

So an untokenized appearance value is a defect, not a style choice.

## Tiers

Three. The primitive tier is private; the other two are public API.

| Tier | Visibility | Contents |
|---|---|---|
| **Primitive** | Private, may change any release | Raw values used by 2+ semantic tokens — today only the shared status hues. Never referenced by a component. |
| **Semantic** | **Public API** — documented, versioned | Role-named tokens components read: surfaces, foregrounds, accent, status, code, monogram, shape, type. |
| **Component hook** | **Public API** — small, curated | `--ocx-<component>-<property>`, override-only. See [`quality-css-overrides.md`](./quality-css-overrides.md) for the grammar. |

The component tier is **override-only**: a hook is never *declared* by the
theme, only *read* with a `var()` fallback to the semantic tier
(`var(--ocx-package-card-radius, var(--ocx-radius-lg))`). Unset, the component
tracks the global token, so a rebrand still reaches everything in one edit;
only components a consumer deliberately opted out of diverge.

That is what separates it from the anti-pattern. The rule against per-component
colour knobs bans a component holding an *independent second value*, not an
*override point that falls through* — which is the shape SLDS, Ant Design,
PrimeVue and MUI all ship. A hook that stores a value instead of falling back
is the defect.

Keep the set small. The finest-grained tier is the one that churns: Salesforce's
own component-hook tier is unsupported in their current rewrite. Ship hooks for
a handful of components, never speculatively.

Structural per-instance knobs (`--arch-cols`, `--mg-*`) are a different thing —
**private internals**, not API.

Reference direction is downward only: component hook → semantic → primitive. A
component never reads a primitive; that would discard the meaning the semantic
layer carries.

## Naming

```
--{namespace}-{category}-{role}[-{modifier}]
```

- **Namespace is mandatory.** A bare category prefix is not a namespace — the
  set this theme shipped before `--ocx-*` used `--c-line`, which a mirror
  defining its own `--c-line` would have collided with silently.
- **The category segment is load-bearing**, not decoration — without it
  `--x-text` (a colour) collides with `--x-text-lg` (a size). Colours take
  `color`; sizes, fonts, spacing and radii take their own.
- **Name the role, never the value.** `accent`, not `coral`; `success`, not
  `green`.
- 2–4 segments. Past four, the token is probably a component token in
  disguise — see the tier table.

### Numbers in names

A bare number is allowed **only** when every number has a published role, the
way Radix's 12-step scale documents step 3 as "UI element background" and step
11 as "low-contrast text". Absent that table the number is noise: it says
nothing about direction or job.

Legitimate here: the monogram rotation set, whose members genuinely have no
individual meaning. Not legitimate: foreground and surface steps — those take
role names (`fg` / `fg-muted` / `fg-subtle`, `surface` / `surface-subtle`).

The whole set lives under `--ocx-*`: `--ocx-color-*`, `--ocx-text-*` (sizes),
`--ocx-font-*`, `--ocx-radius-*`, `--ocx-space-*`. There is no second namespace,
and a new token never introduces one.

## Coverage is part of the contract

Families are not uniformly tokenized, and the docs must never imply they are.
Claiming a family is themeable when most of its declarations are literals is
the same class of defect as a hardcoded colour — the consumer writes an
override that silently does nothing.

| Family | State |
|---|---|
| Colour, radius, type scale, font family | Fully tokenized |
| Spacing, border width, font-weight, duration, shadow, z-index | Fully tokenized |
| Easing | Deliberately untokenized — `ease-out` is a keyword that already says what it does |
| Breakpoints | Cannot be tokens; see below |

When adding a token family, tokenize the family *before* documenting it. A
partially-tokenized family gets an explicit coverage caveat in the docs until
it is finished.

**Breakpoints are excluded by construction.** Media-query conditions cannot
consume `var()`, so a breakpoint can never be a custom property. Any breakpoint
constant is a build-time mechanism and belongs in a different discussion —
never in a token table, which would promise runtime overridability that cannot
exist. Keep breakpoint values internally consistent regardless; two values one
pixel apart for the same intent is a bug either way.

## Invariants

**Every colour token is defined in both `:root` and `.dark`.** A `:root`-only
declaration is mode-agnostic: it applies in dark mode too, silently pinning
that token to its light value. This bites consumers hardest — their `custom.css`
loads last, so a `:root`-only override beats the theme's `.dark` at equal
specificity and takes dark mode with it. Deliberate exceptions go on an
allowlist with a stated reason (today: `--ocx-color-overlay`, one scrim that reads
correctly over either theme).

Consumer-facing corollary the docs must state: **override both blocks, always.**

**Derive tints, never store them.** A tint of an existing token is
`color-mix(in srgb, var(--<token>) 10%, transparent)`, not a hand-written
`rgba()` of the same hex. A stored copy does not follow when the source token
is overridden, so a rebrand comes out half-applied. Keep the tint as a named
token — components read one name — but let its *default value* be the
`color-mix()`.

The exception is a tint whose base is genuinely a different colour from the
token it accompanies: the monogram tints are not derivable from their own
foregrounds, and three of the four predate the a11y darkening of the status
tokens, so deriving them would silently change three of four. Store those, and
say in the file why deriving is wrong — an unexplained stored tint is
indistinguishable from the defect.

**No literal colour outside the token files.** Includes `.ts`/`.mts`
constants and strings baked into generated config. When a build-time consumer
seems to force a literal (a syntax-highlighting theme, an inline style), the
fix is to make it read CSS variables — not to accept the literal. Both
highlighters in this repo can do so; a theme palette that only *some* renderers
follow produces two palettes on one page.

**Block-tier**: a hardcoded colour anywhere outside `styles/tokens/*.css`, and a
colour token missing from `.dark` without an allowlist entry.
**Warn-tier**: a stored rgba tint of another token; a new bare-numbered name
with no published role table.

## Don't over-tokenize

The named failure mode of token systems is minting too many too early, not too
few. Before adding one, in order:

1. Does an existing token already carry this role? Reuse it.
2. Is it a *derivation* of an existing token? `color-mix()`, no new token.
3. Is the value genuinely fixed and used once? Inline it.
4. Only then: add it — with its `.dark` value and its documentation row.

Before tokenizing an existing family, **run the census first**. The literals
rarely match the scale you assume, and a partial census is worse than none: this
repo's spacing was first read as a 4px scale plus a 4n+2 half-step family, which
put the sweep at ~63 shifts. The full census found 3, 5, 7, 9, 11 and 22px too,
and the real figure was 106. The scale had already been chosen against the
smaller number.

Tokenizing an existing family is a design decision until the census says
otherwise — and the census must be exhaustive before it can say anything.

Watch for the inverse rot: a token whose name stopped describing what it does.
The theme's old `--c-kw` served as both "code keyword colour" (hljs syntax
highlighting) and "the purple used by keyword chips" — one token, two unrelated
roles, which is how a semantic layer quietly stops being semantic. It is now
split: `--ocx-color-keyword` for the chips, `--ocx-color-code-keyword` for
syntax. Split, don't overload.

## Evidence gate

Two checks, and neither counts until it has been **shown red** on a mutation
you control, then green (`quality-core.md`, "Unchecked Green"):

- Every colour token declared in `:root` also declared in `.dark`, modulo the
  allowlist. Mutate by deleting one `.dark` line.
- No hex/`rgba()`/named colour outside `styles/tokens/*.css`. Mutate by adding
  a literal to a component.

A token reference page is **generated from the token files**, never
hand-maintained — a hand-written table is the thing that goes stale, and a
stale API table is worse than none.
