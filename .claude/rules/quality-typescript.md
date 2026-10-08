---
paths:
  - "**/*.ts"
  - "**/tsconfig*.json"
---

# TypeScript Code Quality

TS-specific quality guide, grounded in this repo's own config. Universal design
principles (SOLID, DRY, YAGNI, severity tiers, review checklist) live in
`quality-core.md` — this file covers TS-specific applications plus the module
system and tooling actually wired up here. Vite/Astro build-tool specifics:
`quality-vite.md`.

---

## tsconfig Baseline (this repo)

One config, `tsconfig.json`, for everything under `src/` (the CLI, the
view-model and `src/site/{model,lib,client}`; `dist/`-bound): `strict: true`,
`module`/`moduleResolution: NodeNext`, `isolatedModules: true`, `declaration` +
`declarationMap`, `esModuleInterop`, `forceConsistentCasingInFileNames`,
`skipLibCheck`, `lib: [ES2022, DOM, DOM.Iterable]` (the DOM lib is for the
browser-side logic in `src/site/lib` and `client`; the CLI code never touches
it). There is no second, bundler-resolution config any more (the Vue theme that
needed one is gone). `.astro` templates and `test/` are outside it: `tsc` does
not read a template, so a type error inside one surfaces only when the
acceptance build renders that page.

`strict: true` is non-negotiable: never weaken it or add a per-file
`// @ts-nocheck` to route around it.

**Not currently enabled** — real candidates, not yet turned on, so don't claim
they're enforced: `noUncheckedIndexedAccess` (still not part of `strict` itself,
TS issue [#49169](https://github.com/microsoft/TypeScript/issues/49169), open
since 2022 — the single highest-value flag missing from strict mode) and
`exactOptionalPropertyTypes`. Treat adding either as a **Suggest**-tier
improvement, not a fact about the current baseline.

---

## `any` vs `unknown`

- **`unknown`** is the correct type for values whose shape you don't control (API
  responses, `JSON.parse`, error catches). Narrow before use.
- **`any`** is acceptable only at deliberate escape hatches in adapter/interop code
  and test fixtures — never in library surface or domain logic.
- **`catch (e)`** defaults to `unknown` under `strict` (`useUnknownInCatchVariables`,
  TS 4.4+) — this repo's own `catch` blocks rely on that default rather than
  annotating explicitly. Never `catch (e: any)`.
- **Block-tier**: `any` in function signatures crossing module boundaries dissolves
  the entire type graph downstream.

---

## Anti-Patterns (TypeScript-Specific)

### Block (must fix before merge)

- **`any` in exported function signatures** — dissolves the type graph downstream.
- **`as SomeType` to silence a type error** — assertion without narrowing. Use a
  type guard (`is` predicate) or discriminated union instead.
- **Non-null assertion (`!`)** without justification — hides runtime errors. Use
  optional chaining (`?.`) or an explicit check.
- **`catch (e: any)`** — rely on the default `unknown`, narrow with `instanceof`.
- **`@ts-ignore` without a comment** — explain why. Prefer `@ts-expect-error` so
  the suppression is removed automatically once the underlying issue is fixed.
- **TypeScript `enum`** — numeric enums are erased at runtime and cause subtle
  reverse-mapping bugs. Use `const` union types instead:
  `type Direction = "north" | "south"`. This repo has none — keep it that way.
- **`Object` / `{}` as a type** — use `Record<string, unknown>` or a named interface.
- **`eval()` / `Function()` constructor** — injection risk. Always find a typed
  alternative.

### Warn (should fix)

- Overusing generics where `unknown` + narrowing suffices
- Type predicates (`is`) without airtight runtime checks — a false type guard is a
  silent bug
- Intersecting incompatible types with `&` to "merge" them — use `Omit` + spread
- Deeply nested conditional types — split into named aliases

---

## Type Narrowing Patterns

- **Discriminated unions**: tag every union with a `kind`/`type` literal field. TS
  narrows exhaustively in a `switch`.
- **`satisfies`** (used in `src/site/lib/installIcons.ts`): validates a value
  conforms to a type without widening the inferred type — `const config = { … }
  satisfies Config` instead of `const config: Config = { … }` when you still want
  autocomplete on the literal values.
- **`as const`** (used throughout `src/`, e.g. `src/config/load.ts`): freezes
  literal types.
- **`never` exhaustion check**: in the default branch of a discriminated-union
  `switch`, assign to `never` to get a compile error on a missing case.

```ts
function handle(msg: Message): Result {
  switch (msg.kind) {
    case "text": return handleText(msg);
    case "image": return handleImage(msg);
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled: ${_exhaustive}`);
    }
  }
}
```

---

## Module System (ESM-only)

- `"type": "module"` in `package.json`; `NodeNext` resolution in `tsconfig.json`
  means relative imports need an explicit extension — `import { main } from
  "./main.js"`, even though the source file is `main.ts` (the convention across
  `src/cli/`, `src/build/`, etc.).
- `verbatimModuleSyntax` is not set, so `import type` for type-only imports is a
  convention here, not a compiler-enforced one; keep using it for new type-only
  imports rather than letting `tsc`'s type-only elision do it silently.
- Code that runs inside the Astro child (`src/site/**`) is loaded by Astro/Vite
  and by vitest as well as compiled to `dist/`: keep imports to the explicit
  `.js` specifiers `NodeNext` requires, and never value-import the programmatic
  API (`build|dev|preview|sync`) from `"astro"` (C-025).

---

## Tooling (this repo)

- **Typecheck**: `npm run typecheck` — `tsc --noEmit` over `tsconfig.json`, a
  single pass.
- **Lint**: `npm run lint` — `eslint .`, config in `eslint.config.js`:
  `@eslint/js` recommended + `typescript-eslint` recommended (not the
  type-checked variant — no `parserOptions.project` wired up). No Astro plugin,
  so `.astro` files are not linted; `docs/**` and `.agents/**` are ignored.
- **Build**: `npm run build` — plain `tsc` (no bundler in the build step; this is
  a library, not an app), then `scripts/postbuild.mjs`.
- **Test**: `npm test` — `vitest run --coverage`, thresholds at 100%
  branches/functions/lines/statements (`vitest.config.ts`), with a pinned,
  commented `coverage.exclude` list (see `subsystem-tests.md`).

---

## Code Review Checklist (TypeScript-Specific)

See `quality-core.md` for the universal review checklist. TS-specific additions:

- [ ] `strict: true` unchanged in `tsconfig.json`
- [ ] No `any` in exported signatures
- [ ] No `as X` assertions bypassing narrowing
- [ ] No non-null `!` without a justification comment
- [ ] `catch (e)` narrows from `unknown`, not `any`
- [ ] Unions discriminated; `switch` has a `never` exhaustion check
- [ ] `import type` used for type-only imports (by convention, not enforced)
- [ ] No TypeScript `enum` — use `const` union types
- [ ] `npm run typecheck` and `npm run lint` both pass
