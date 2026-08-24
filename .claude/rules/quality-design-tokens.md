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

Two, and only the second is public.

| Tier | Visibility | Contents |
|---|---|---|
| **Primitive** | Private, may change any release | Raw values used by 2+ semantic tokens — today only the shared status hues. Never referenced by a component. |
| **Semantic** | **Public API** — documented, versioned | Role-named tokens components read: surfaces, foregrounds, accent, status, code, monogram, shape, type. |

There is no component tier and none should be added. A component needing a
different colour gets a variant class, never a colour knob — a per-component
colour property re-exports the implementation as API. Structural per-instance
knobs (`--arch-cols`, `--mg-*`) already exist; they are **private internals**,
not API, and are documented as such.

Reference direction is downward only: semantic → primitive. A component never
reads a primitive; that would discard the meaning the semantic layer carries.

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
| Colour, radius | Fully tokenized — safe to document as themeable |
| Type scale, font family | Fully tokenized |
| Spacing | Partial (~9% of declarations) — **must not be documented as complete** |
| Border width, font-weight, duration/easing, shadow, z-index | No tokens — say so plainly |

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

Before tokenizing an existing family, **check what the literals actually are**.
They rarely match the scale you assume. This repo's spacing literals look like
a 4px scale but a third of them form an unnamed 4n+2 half-step family
(2/6/10/14/18px) used across 20+ components for compact controls — mapping
those onto the nearest 4px step is a visual change, not a refactor. Tokenizing
a family is a design decision until the value census says otherwise.

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
