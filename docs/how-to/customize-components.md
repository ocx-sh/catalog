# Customizing components

Reassigning a [theme token](../reference/theme-tokens.md) changes the whole site
at once. This page covers the other direction: restyling one component and
leaving the rest alone.

## Why your rules win

The theme's CSS ships inside a `@layer ocx` cascade layer. Your stylesheet is
unlayered, and **any unlayered rule beats any layered rule regardless of
specificity**. So this works:

```css
[data-slot="package-card"] {
  border-radius: 0;
}
```

even though the theme's own rule for that element is more specific. You never
need `!important`, and you never need to guess at a selector specific enough to
win.

## Target `data-slot`, never a class name

Every restylable component carries a `data-slot` attribute. That is the stable
contract — it is versioned, and renaming one is a breaking change.

The theme's class names are **not** part of the contract. They are internal,
they carry a build-specific `[data-v-…]` attribute that changes on every build,
and they get renamed whenever the CSS is refactored. A stylesheet written
against them will break silently.

| Slot | Element |
|---|---|
| `package-card` | A package tile in the catalog grid |
| `keyword` | A keyword chip, wherever it appears — catalog card, detail page, metadata rail |
| `site-header` | The header bar |

## Component hooks

Some components expose named knobs. Setting one changes that component only;
leaving it unset means the component keeps following the global token, so a
palette change still reaches it.

| Hook | Falls back to |
|---|---|
| `--ocx-package-card-radius` | `--ocx-radius-lg` |
| `--ocx-package-card-padding` | the card's default padding |
| `--ocx-package-card-border-color` | `--ocx-color-border` |
| `--ocx-keyword-color` | `--ocx-color-keyword` |
| `--ocx-keyword-background` | `--ocx-color-keyword-tint` |
| `--ocx-keyword-radius` | `--ocx-radius-sm` |
| `--ocx-site-header-background` | `--ocx-color-surface` |

```css
/* square, flatter cards — but chips keep the global radius */
[data-slot="package-card"] {
  --ocx-package-card-radius: 0;
  --ocx-package-card-border-color: #d0d7de;
}
```

Set a hook on the slot itself, not on an ancestor: a value declared on the
element always beats one merely inherited from a parent, so the component's own
declaration would win over a hook set higher up the tree.

## What you cannot change this way

Media-query breakpoints are not tokens and cannot be. A media query condition
cannot read a custom property, so breakpoint values are fixed at build time.

The `prefers-reduced-motion` block is deliberately unoverridable. It sits inside
the cascade layer with `!important`, which — because layer order reverses for
`!important` — no consumer rule can beat. That is intentional: a visitor who has
asked their operating system for reduced motion should get it whatever a
stylesheet says.

## Adding a slot or a hook

The published set is deliberately small. The finest-grained part of a styling
API is the part most likely to churn, so slots and hooks are added when there is
a real request rather than speculatively. If you need one that is not here, open
an issue describing the element and what you want to change about it.
