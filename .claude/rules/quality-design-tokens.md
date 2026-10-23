---
paths:
  - "src/site/**/*.astro"
---

# Design Tokens — consumed, not owned

This package owns no token files. Every colour, space, type, radius and
shape value is a `--ocx-*` custom property declared by
`@ocx-sh/theme/tokens.css` (values only, inside `@layer ocx`, light on `:root`
and dark on `:root[data-theme="dark"]`), and the theme's `base.css` and
components read them. Severity tiers and the "Unchecked Green" evidence bar are
[`quality-core.md`](./quality-core.md)'s; the component-side conventions that
use the tokens are in [`subsystem-site.md`](./subsystem-site.md).

## What this repo may do with tokens

- **Read, never mint.** A component in `src/site/**` styles itself with
  `var(--ocx-…)` only. A role no token carries (a missing colour step, a track
  width) is a request to the theme, answered by a new token there; this repo
  never declares a second `--ocx-*` namespace entry and never copies the theme's
  token or base CSS. A bare number the theme has no token for (the 1px
  visually-hidden box, the 24px WCAG 2.5.8 target) stays a commented literal
  naming why.
- **No literal colour.** A hex, `rgb()`/`rgba()` or named colour in a `.astro`
  `<style>` block is **Block-tier**: it is a value a consumer's `css` can never
  override and that dark mode silently ignores. Reviewer check, empty today:
  `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/site --glob '*.astro'`. There is no
  automated gate for this one.
- **Private knobs are not tokens.** Per-instance structural values the island or
  template sets itself (`--reserve`, `--os-cols`) are internals: unprefixed
  by `--ocx-`, never documented, never read by a consumer.
- **Derive, don't store, a tint:** `color-mix(in srgb, var(--ocx-color-…) 10%,
  transparent)` follows an overridden source token; a copied `rgba()` of the
  same colour does not, so a rebrand comes out half-applied.
- **Breakpoints are not tokens.** A media query cannot read `var()`; keep the
  values of one intent identical across files.

## The cascade

The theme's rules all sit inside `@layer ocx`, so an unlayered rule in a
consumer's `css` file beats them at any specificity and in either source order
(asserted by `test/acceptance/seo.test.ts`, which scans the `/_astro/`
stylesheets of the built 404 page for an unlayered rule, with a planted case
proving the scan can fail). Component `<style>` blocks in `src/site/**` are Astro-scoped; some also sit in
`@layer ocx { … }` and some do not. Per-block wrapping is **not** a rule any
more (it went with the Vue theme's override contract) and not a consumer
promise, so do not write a component that depends on being layered or unlayered.

## What consumers are promised

Only the `--ocx-*` token overrides (set in BOTH `:root` and
`:root[data-theme="dark"]`: a `:root`-only override beats the theme's layered
dark value and takes dark mode with it) are stable. **There is no selector
contract**: class names, element structure and `data-slot` attributes of the
theme and of this package's components can change in any release, and the docs
say so (`customize-branding-and-docs`). Do not add a stable hook "for
consumers" without a reviewed decision; it is a permanent API.

## Where the rest went

Token naming, tiers, the dark-parity invariant and the generated token
reference are the theme's (`packages/theme` in `ocx-sh/website`, its own tests).
The old local rules (the component-hook tier, a separate cascade-contract rule
file, the in-repo token files and their evidence gate) were retired with the
Vue theme in 0.6.0.
