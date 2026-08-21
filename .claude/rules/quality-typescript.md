---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
  - "**/tsconfig*.json"
---

# TypeScript Code Quality

TS-specific quality guide, grounded in this repo's own config. Universal design
principles (SOLID, DRY, YAGNI, severity tiers, review checklist) live in
`quality-core.md` — this file covers TS-specific applications plus the module
system and tooling actually wired up here. Vite/VitePress build-tool specifics:
`quality-vite.md`.

---

## tsconfig Baseline (this repo)

Two configs, split by target environment — `tsc -p tsconfig.theme.json` typechecks
`src/theme` separately from `tsc`'s own `tsconfig.json` run, because they resolve
differently:

- **`tsconfig.json`** (the CLI/library, `dist/`-bound): `strict: true`, `module`/
  `moduleResolution: NodeNext`, `isolatedModules: true`, `declaration` +
  `declarationMap`, `esModuleInterop`, `forceConsistentCasingInFileNames`,
  `skipLibCheck`. Excludes `src/theme`.
- **`tsconfig.theme.json`** (extends the above): `module: ESNext`,
  `moduleResolution: bundler`, `lib: [ES2022, DOM, DOM.Iterable]`, `noEmit: true`.
  Bundler resolution because `src/theme` is VitePress/Vite-consumed — extensionless
  relative imports (`from './useToast'`) and `.vue` SFC specifiers, neither of
  which `NodeNext` resolution can resolve at all.

`strict: true` is non-negotiable in either config — never weaken it or add a
per-file `// @ts-nocheck` to route around it.

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
- **`satisfies`** (used in `src/viewmodel/catalog.ts`): validates a value conforms
  to a type without widening the inferred type — `const config = { … } satisfies
  Config` instead of `const config: Config = { … }` when you still want
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
  convention here, not a compiler-enforced one — used across the codebase (22
  files as of this writing); keep using it for new type-only imports rather than
  letting `tsc`'s type-only elision do it silently.
- `.mts` (`src/theme/index.mts`, the `./theme` export entry point) marks a file
  that's always ESM regardless of how a consumer resolves it — the one place this
  repo actually uses the extension.

---

## Tooling (this repo)

- **Typecheck**: `npm run typecheck` — `tsc --noEmit` (the main `tsconfig.json`)
  then `tsc -p tsconfig.theme.json` (the theme's separate bundler-resolution pass).
- **Lint**: `npm run lint` — `eslint .`, config in `eslint.config.js`:
  `@eslint/js` recommended + `typescript-eslint` recommended (not the
  type-checked variant — no `parserOptions.project` wired up), plus one
  repo-specific `no-restricted-imports` pair banning `src/viewmodel/
  version_order.ts` and `src/theme/utils/version.ts` from importing each other
  (they implement different version-ordering grammars for different callers;
  merging them silently would corrupt one side's output).
- **Build**: `npm run build` — plain `tsc` (no bundler in the build step; this is
  a library, not an app).
- **Test**: `npm test` — `vitest run --coverage`, thresholds at 100%
  branches/functions/lines/statements (`vitest.config.ts`), with explicit,
  commented `coverage.exclude` entries for code that's subprocess- or
  SSR-render-only and can't be meaningfully unit-covered (see that file).

---

## Code Review Checklist (TypeScript-Specific)

See `quality-core.md` for the universal review checklist. TS-specific additions:

- [ ] `strict: true` unchanged in both `tsconfig.json` and `tsconfig.theme.json`
- [ ] No `any` in exported signatures
- [ ] No `as X` assertions bypassing narrowing
- [ ] No non-null `!` without a justification comment
- [ ] `catch (e)` narrows from `unknown`, not `any`
- [ ] Unions discriminated; `switch` has a `never` exhaustion check
- [ ] `import type` used for type-only imports (by convention, not enforced)
- [ ] No TypeScript `enum` — use `const` union types
- [ ] `npm run typecheck` and `npm run lint` both pass
