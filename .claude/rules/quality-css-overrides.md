---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.styl"
  - "src/theme/**/*.vue"
---

# The consumer override contract

How a consumer's stylesheet is *able* to win. Sibling to
[`quality-design-tokens.md`](./quality-design-tokens.md), which governs which
values exist and what they are named — this file governs the cascade.

Split rationale: a token can be perfectly named and still unreachable. Naming
is a vocabulary problem; overriding is a cascade problem. Different failure
modes, different checks.

Evidence for every claim here:
[`research_css_customization_api_2026-08-24.md`](../artifacts/research_css_customization_api_2026-08-24.md).

## The problem this solves

Consumer CSS arrives as one stylesheet (`catalog.config.json`'s `css`),
imported after the theme's by `config_gen.ts`'s `renderThemeShim`. Source order
alone does **not** make it win: every scoped rule compiles to
`.foo[data-v-<hash>]` — specificity (0,2,0) — which outranks a consumer's
`.foo` (0,1,0) in *either* order. Verified in two engines, both orders.

So without a deliberate mechanism, only custom properties are overridable and
every selector is a dead end. That is the state this contract fixes.

## Three layers of contract, in dependency order

Each one is useless without the one before it.

| # | Mechanism | Provides |
|---|---|---|
| 1 | **`@layer`** around the theme's CSS | Makes overriding *possible at all* |
| 2 | **`data-slot`** attributes | A stable *identity* to target |
| 3 | **`--ocx-<component>-<property>`** hooks | Ergonomics for common cases |

### 1. Ship theme CSS inside a cascade layer

Any **unlayered** author rule beats **any** layered rule, at any specificity.
Verified in real Chrome with the red control (same pair unlayered → theme
wins). This is the whole mechanism: the consumer writes ordinary CSS and wins,
with no `!important` and no specificity arms race.

Two hard constraints, both empirically established:

- **Layer blocks must appear in intended precedence order physically.** A bare
  `@layer a, b;` ordering statement is dropped by the production minifier
  whenever block order already implies the same precedence. This is correct CSS
  per Vite's maintainers, not a bug — never depend on the statement.
- **Never `!important` inside the layer.** Layer order *reverses* for
  `!important`, so a layered `!important` beats an unlayered one — it locks the
  consumer out permanently, with no escape hatch at all.

The single exception is a deliberate **accessibility lock**: `base.css`'s
`prefers-reduced-motion` block stays `!important` inside the layer on purpose,
because a consumer must not be able to switch motion accommodation back on by
accident. Bootstrap and Vuetify make the same call. Any other `!important`
needs a comment justifying why a consumer should be unable to override it.

`:where()` is the alternative mechanism and is SFC-safe — the scope attribute
compiles *inside* the `:where()`, preserving zero specificity. Prefer `@layer`:
`:where()` zeroes specificity for the theme's own internal ordering too, so it
trades away control we want. Use it surgically, not as the default.

**`@scope` is not a substitute.** It contributes zero specificity, and its
proximity step only breaks ties among already-equal rules — our selectors win
outright, so there is no tie. It also leaves inherited custom properties
untouched. Do not reach for it to solve overridability.

### 2. `data-slot` is the identity contract

A published class name is a *target*, not an override — a theme rule at (0,2,0)
still beats a consumer rule on that class in both source orders. Stable naming
and cascade reachability are independent problems; layer 1 solves the second.

Identity goes on `data-slot="<name>"`, not on a class, because the `class`
attribute stays free for the consumer's own use, and an attribute whose only
job is identification has no reason to churn during a styling refactor. A class
gets renamed by whoever refactors the CSS; a `data-slot` does not.

Consequences that are now rules:

- A `data-slot` value is **public API**. Renaming one is a breaking change.
- Class names remain **internal and unversioned**. They appear nowhere in
  `docs/` or the JSON schema today; keep it that way. Never document a class
  name as a targetable seam.
- Add a `data-slot` only to elements a consumer would actually name — the card,
  the chip, the header. Not to every div.
- Watch the 21 bare generic classes (`.active`, `.link`, `.count`, `.yanked`)
  reused across up to 7 components. They are a collision surface *inside* the
  theme; scoping currently hides it. Never widen one into a seam.

### 3. Component hooks, override-only

Grammar: `--ocx-<component>-<property>`, always defined with a fallback to the
semantic tier:

```css
border-radius: var(--ocx-card-radius, var(--ocx-radius-lg));
```

The component segment is **mandatory**. Bare property-name hooks are safe only
inside shadow DOM, which this theme does not have — without it, a hook named
`--radius` leaks into every component reading that name.

The fallback shape is what makes this legitimate rather than a second source of
truth: an unset component tracks the global token, so a palette or shape change
still reaches everything in one edit, and only components a consumer
deliberately opted out of diverge. A hook that *stores* a value instead of
falling through is the anti-pattern.

Keep the set small and curated. The finest-grained tier is the one that churns
— Salesforce's own component-hook tier is unsupported in their current rewrite.
Ship hooks for a handful of components, not exhaustive per-property coverage,
and never speculatively.

## What layering does not fix

A consumer's `:root { --x: … }` still leaks into dark mode under `@layer` —
verified. `:root` is mode-agnostic; no cascade mechanism changes that. It stays
a documentation obligation: **override both `:root` and `.dark`, always.** See
`quality-design-tokens.md`'s invariant.

## Severity

- **Block**: `!important` inside the layer without an accessibility
  justification comment; a component hook without a component segment; a hook
  that stores a value instead of falling back.
- **Block**: documenting a class name as a stable override target.
- **Warn**: a new `data-slot` on an element no consumer would name; relying on
  a bare `@layer` ordering statement for precedence.

## Evidence gate

Four checks, each shown red then green (`quality-core.md`, "Unchecked Green"):

| Check | Where | Reddens when |
|---|---|---|
| Every style block wrapped; no unjustified layered `!important` | `test/theme/layer_contract.test.ts` | a block loses its wrapper |
| Hook grammar and `var()` fallback | `test/theme/component_hook_contract.test.ts` | a bare hook or a literal fallback |
| `@layer ocx` survives the production build, with the right rules in and out of it | `test/build/css_layer_real_build.test.ts` | the wrapper is stripped |
| A consumer stylesheet actually wins **in Chrome** | `scripts/quality-css-cascade.mjs`, run by `task quality:web` | any theme rule escapes the layer |

The last one cannot be moved into vitest. **happy-dom drops `@layer` blocks at
parse time and jsdom parses them but never applies layered declarations**, so a
cascade assertion in either passes whether or not the mechanism works. That is
the vacuous green this repo's own rule warns about — a real browser or a real
build is the only honest form.

Its red state is worth knowing: stripping one component's wrapper leaves the
build valid and every token and hook assertion still passing, and flips only the
`data-slot` selector assertion. That is the precise failure mode the layer
exists to prevent, and nothing else in the suite catches it.
