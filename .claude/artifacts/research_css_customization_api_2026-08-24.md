# Research: the CSS customization API beyond colour — @ocx-sh/catalog @ 4d0c2ff

Date: 2026-08-24. Companion to
[`research_design_tokens_2026-08-24.md`](./research_design_tokens_2026-08-24.md),
which settled colour/type naming and tiers. This round answers the two
questions that one left open:

1. **Structural knobs** — radius, border width, spacing/density, shadow,
   motion, z-index, breakpoints. "We don't want rounded corners."
2. **Per-element restyling** — "restyle the package card / the keyword chip /
   the site header", for a theme with **no shadow DOM**.

Method: 22 agents across three waves — 12 prior-art/inventory/verification,
7 component-framework surveys, 3 gap-closers — plus two verifications run
directly (real headless Chrome; a real production build of this repo).

> **Category correction.** The first wave surveyed static-site generators
> (VitePress, Starlight, Docusaurus, MkDocs Material, Furo). That is the right
> category for tokens and the *wrong* one for per-element overrides. The
> load-bearing prior art is systems that ship **predefined components** —
> WordPress, MUI, Ant Design, SLDS, Bootstrap — which the second wave covered.

## 1. Empirical results

Every claim below was produced by a run with a **red control**, per
`quality-core.md`'s "Unchecked Green".

### E1 — Cascade layers work, and defeat specificity (real Chrome 148)

Sandboxed engines could not answer this: happy-dom v20 **drops `@layer`
blocks at parse time** (rule count 0), and jsdom v29 parses `@layer` into
correct CSSOM but **never applies layered declarations** in `getComputedStyle`.
Both produced a *false* "unlayered wins" — the layered rule was simply inert.
Re-run in real headless Chrome 148.0.7778.167:

| Test | Result |
|---|---|
| Layered theme `.t1[data-v-abc]` (0,2,0) vs unlayered consumer `.t1` (0,1,0) | `0px` — **consumer wins** |
| **Control** — identical pair, no `@layer` | `8px` — theme wins |
| Later layer vs earlier, equal specificity | later layer wins |
| Consumer unlayered `:root` vs layered `.dark`, under `html.dark` | consumer value — **layering does NOT fix the dark leak** |
| Layered `!important` vs unlayered `!important` | **layered wins** |

The control is what makes the first row evidence rather than habit.

### E2 — `@layer` survives this repo's real production build

Run through the actual pipeline (`createScratchRoot` → `synthesizePages` →
`generateConfig` → `vitepress build`), theme CSS authored with layers, consumer
CSS plain. Emitted `/assets/style.<hash>.css`, verbatim:

```
@layer reset{.layer-probe{color:red;background:red}}@layer base{.layer-probe{color:orange}}:root{--c-accent:#123456}.layer-probe{color:#00f}
```

Blocks and order survived. The bare **ordering statement** `@layer reset, base;`
was dropped by esbuild's minifier. Control run with `minify: false` preserved
it — proving the drop is minifier-specific, not a build defect.

Vite maintainers closed [vite#22705](https://github.com/vitejs/vite/issues/22705)
as not-a-bug: `@layer a, b;` only matters if it precedes the blocks, and is
redundant when block order already implies the same precedence. Same for
[#23229](https://github.com/vitejs/vite/issues/23229) (lightningcss) and
[#22318](https://github.com/vitejs/vite/issues/22318).
[#21903](https://github.com/vitejs/vite/issues/21903) (chunk-order instability)
is a different hazard class and **does not apply**: VitePress's `build()`
hardcodes `cssCodeSplit: false`, so this site always emits exactly one CSS
file. Installed Vite is 8.2.2.

**Constraint:** place layer blocks in intended precedence order physically.
Never depend on a bare ordering statement.

### E3 — SFC compilation is layer- and `:where()`-safe (Vue 3.5.41)

`compileStyle` with `scoped: true`:

- `@layer ocx.components { .package-card { … } }` → layer preserved verbatim,
  `[data-v-test]` injected onto inner selectors, nested `@media` fine.
- `:where(.package-card)` → emits `:where(.package-card[data-v-test])`. The
  scope attribute lands **inside** `:where()`, so specificity stays zero. Had
  it landed outside, `:where()` would have been useless here.
- `:deep()` inside a layer compiles cleanly.

### E4 — A stable class name alone is not enough

Theme `.package-card[data-v-abc]` (0,2,0) vs consumer `.ocx-package-card`
(0,1,0): theme wins in **both** source orders, both engines. And
`:where(.package-card)[data-v-abc]` leaks — the attribute outside `:where()`
ties at (0,1,0), so a stray reorder flips the winner. A published class name
gives consumers a *predictable target*; it does not make anything overridable.
That requires the theme to cap its own specificity.

## 2. Current state

| Axis | Tokenized | Literal | Note |
|---|---|---|---|
| **border-radius** | **65 / 65** | 0 | "Square everywhere" already works — four `--radius-*` overrides |
| border-width | 0 | 66 | 60×1px, 3×2px, 2×1.5px, 1×3px; all `solid`. Colour *is* tokenized |
| spacing (padding/margin/gap) | **21 / 238** (8.8%) | 217 | +25 position offsets, all literal → 21/263 |
| font-weight | 0 | 55 | 600×28, 500×23, 700×2, 400×2 — coherent 4-value set |
| transition/animation | 0 | 65 | 0.15s×34, 0.1s×12, 0.12s×5, 200ms×3… same duration written both `0.2s` and `200ms` |
| z-index | 0 | 13 | 40/44/45/100×7/101/200/300 — informal tiers, undocumented |
| breakpoints | 0 | 14 | 639px×6, 640px×4, 1199px×3, 899px×1 — **639 and 640 used interchangeably for one intent** |
| box-shadow | 0 | 1 | `CopyToast.vue:31` |

Element seams: 37 `.vue`, 35 styled, **298 unique class names**. Component-local
prefixes are the norm (`card-*`, `identity-*`, `rail-*`), but **21 bare generic
classes** (`.active`, `.link`, `.count`, `.yanked`) recur across up to 7 files —
the real collision surface. `:deep()` 47× in 3 files; `:where()` never in a
`.vue` (once in `docs-prose.css`). Class names appear **nowhere** in `docs/` or
the JSON schema — 100% internal, free to rename.

### Two findings that constrain what we can honestly offer

**Spacing is not a mechanical sweep.** Of 215 non-zero px literals, only 92
(43%) land on `--space-1..8`; 7 more are clean 4px multiples above the scale.
A further **72 (33.5%) form an untokenized "4n+2" half-step family** —
2/6/10/14/18px — used across 20+ files for compact controls (`6px 9px`,
`2px 7px`). That is a convention, not noise, and tokenizing it is a design
decision, not find-and-replace. `--space-1` is defined and used **zero** times.

**Breakpoints structurally cannot be custom properties.** Media-query
conditions cannot consume `var()`. Any breakpoint "token" would be a build-time
constant, a different mechanism from everything else here.

### Docs defect D4

`customize-branding-and-docs.md:53` lists `--radius-*` and `--space-1..8` in
one "Example tokens" cell with no caveat, under line 37's "The theme exposes
its full design system … Override any of them". Radius is 100%; spacing is
8.8%. Third false claim in that file, joining lines 33 and 56.

## 3. Prior art

### Nobody has a one-line "make it square"

Not SLDS, Spectrum, Material Web, or Bootstrap 5.3. The real pattern is
"set a small documented scale once at `:root`".

- **Foundation** `$global-radius: 0` is genuinely one line — but it is the
  `!default` of ~18 per-component Sass variables, resolved at **compile time**,
  and the pattern does not generalise (no `$global-boxshadow`).
- **Bootstrap** `$enable-rounded: false` is a real boolean — the guard lives in
  the `border-radius()` mixin, which *omits* the property. **Sass-only.** A
  consumer of compiled CSS cannot flip it.
  ([options](https://getbootstrap.com/docs/5.3/customize/options/))
- **Bootstrap 5.3** is the closest precedent to us: `--bs-card-border-radius`
  defaults to `var(--bs-border-radius)`, so overriding the root scale cascades
  wherever the default was left alone. Six root radius vars, not one.
- **Ant Design** is the cleanest: one seed `borderRadius`, and `genRadius()`
  derives `borderRadiusXS/SM/LG/Outer`; components read the alias tier, never
  the seed. Also ships `compactAlgorithm` as a density switch.
- **WordPress is the cautionary tale.** Root `styles.border.radius` compiles to
  `body` only — `border-radius` does not inherit — so authors hand-wire
  `styles.blocks.<name>.border.radius` per block
  ([Gutenberg #56626](https://github.com/WordPress/gutenberg/issues/56626)).
  They lack the `var()` fan-out we already built.

**We are ahead of every one of these**: 65/65 usage against four root tokens
means square-in-four-lines works today, at runtime, for a consumer holding only
compiled CSS.

### Per-component hooks: the naming grammars

| System | Grammar | Example |
|---|---|---|
| SLDS | `--slds-c-{component}[-{element}]-{category}-{property}[-{state}]` | `--slds-c-card-radius-border`, `--slds-c-accordion-heading-text-color` |
| Spectrum | `--mod-{component}-{property}[-{state}]` | `--mod-actionbutton-border-radius`, `--mod-switch-border-color-hover` |
| PrimeVue | `--p-{component}-{property}` | `--p-button-border-radius` |
| Bootstrap | `--bs-{component}-{property}` → `var(--bs-{property})` | `--bs-card-border-radius` |

SLDS's `element` segment is precisely how a sub-part gets a hook **without
shadow DOM** — the mechanism we need.

Two warnings, both load-bearing:

- **Ionic's bare `--background` / `--color` are safe only because shadow DOM
  contains them.** Without it, a hook lacking a component segment leaks across
  every component reading that property name. Namespacing is mandatory here,
  not stylistic.
- **SLDS's own `--slds-c-*` tier is unsupported in SLDS 2**, their active
  rewrite; official guidance is to migrate to global hooks. The finest-grained
  tier is where churn lands. Ship few curated hooks, not exhaustive coverage.

### The "never expose colour per component" contradiction, resolved

The two-tier rule bans a component holding an **independent second source of
truth**, not an **override point that falls back to the shared token**. SLDS,
Ant Design, PrimeVue and MUI all ship the fallback shape — PrimeVue's docs:
component tokens "by default resolve from semantic tokens unless explicitly
overridden".

A component tier is correct when three conditions hold: (1) override-only,
wired by `var()` fallback to one upstream semantic source, so an unset
component never drifts; (2) small and curated; (3) a semantic tier exists that
most consumers never bypass. We meet all three — `palette.css` already declares
`--c-accent` "the only interactive color".

### Per-element identity: `data-slot`

shadcn/ui put `data-slot="<name>"` on every primitive in the Feb 2025 Tailwind
v4 upgrade ([changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4)).
It buys three things over a stable class: the `class` attribute stays free for
consumer utilities; an attribute whose only job is identity has no incentive to
churn during a styling refactor; and it composes for parent-targets-child
selectors. Radix/Ark extend the same idea to state (`data-state`,
`data-disabled`). ([rationale](https://www.components.build/data-attributes))

Specificity is the same as a class (0,1,0) — so `data-slot` is an *identity*
contract, not an override mechanism. It needs `@layer` underneath it.

### Rejected

- **`@scope`** — Baseline since Firefox 146 (Dec 2025), and genuinely useful,
  but it adds **zero specificity** (bare selectors inside are implicitly
  `:where(:scope)`-prefixed) and its new proximity step only breaks ties among
  already-equal rules. Our theme wins outright on specificity, so there is no
  tie to break; and inherited custom properties are untouched by any scope. It
  solves neither of our two problems.
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@scope),
  [css-cascade-6](https://drafts.csswg.org/css-cascade-6/))
- **Panda CSS slot recipes** — a whole atomic-CSS build system we don't have.
  Steal the "explicit named parts list" idea for free; don't take the dep.
- **Per-component overrides in `catalog.config.json`** — highest cost
  (permanent public API, one key per component/property, naming grammar locked
  pre-1.0) and WordPress's `supports` gate shows the failure mode: an override
  for a property the component never opted into is a **silent no-op**
  ([Gutenberg #64501](https://github.com/WordPress/gutenberg/issues/64501)).
  Revisit later as thin sugar over the CSS hooks — never a parallel code path.
- **A `squareCorners`-style config flag** — the variable already does it. A
  JSON boolean would be a second implementation of a solved problem.

## 4. Conclusions

**C1 — Ship the theme's CSS inside `@layer ocx.*`.** It is the only mechanism
that makes *any* consumer rule win without `!important`, verified in a real
browser and through a real build of this repo. Blocks in precedence order; no
reliance on an ordering statement.

**C2 — Never `!important` inside the layer, except deliberate accessibility
locks.** Layered `!important` beats unlayered, permanently locking consumers
out. `base.css:73-75` (reduced-motion) is a **correct** lock — Bootstrap and
Vuetify bake the same accommodation in unconditionally so a consumer cannot
forget it. `docs-prose.css:120` (fighting Shiki's inline background) is not an
a11y lock and needs a decision.

**C3 — Three-part per-element contract**, in dependency order:
`@layer` (makes overrides possible) → `data-slot` (stable identity) → a small
set of `--ocx-<component>-<property>` hooks with `var()` fallback to the
semantic tier (ergonomic common cases). Hooks must carry a component segment.
Start with 2–3 components.

**C4 — Extend the semantic tier** to the families that have none:
border-width, font-weight, duration/easing, shadow, z-index. Each is small and
coherent enough to tokenize honestly. Spacing is the exception — decide the
4n+2 family first. Breakpoints are out of scope for tokens entirely.

**C5 — Fix D4 and stop overselling.** Say plainly which families are fully
tokenized and which are not. `--space-1` is dead; delete or use it.

## 5. Open decisions

1. `docs-prose.css:120`'s `!important` under C2 — keep the lock, or restructure
   so consumers can restyle code backgrounds beyond the token.
2. The 4n+2 spacing family: extend the scale with half-steps, absorb into 4px
   steps (a visual change), or leave spacing untokenized and say so.
3. Which 2–3 components get the first hooks. Package card, keyword chip and
   site header are the obvious candidates from the ask.
4. Whether `data-slot` values are namespaced (`ocx-package-card`) or bare
   (`package-card`).
5. Whether to fix the 639/640px breakpoint inconsistency in the same pass.

Durable rules distilled from this:
[`quality-design-tokens.md`](../rules/quality-design-tokens.md) (what values
exist) and [`quality-css-overrides.md`](../rules/quality-css-overrides.md)
(how a consumer wins the cascade).
