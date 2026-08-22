---
paths:
  - test/**
  - vitest.config.ts
---

# Test Subsystem

`npm test` runs `vitest run --coverage`. The gate
(`vitest.config.ts`'s `coverage.thresholds`) is **100% statements, branches,
functions, and lines** — not a target, the actual configured number.
CI's `test` job runs that exact command — there is no separate, looser
local gate, and no `task` runner in this repo.

## Coverage exclusions (and why each is real, not cheating)

`vitest.config.ts`'s `coverage.exclude`:

| Exclusion | Why |
|---|---|
| `src/cli/index.ts` | The bin shim runs top-level against real `process.argv` — exercised only as a subprocess (`test/cli.test.ts`'s smoke test), never imported in-process, so v8 coverage (which only instruments code loaded inside the vitest process) can't see it run. |
| `src/build/dev_worker.ts` | Runs as a genuinely separate `node` process (`fork()`-ed against its compiled `dist/` output, per the "Vite-in-Vite pitfall" — `vitepress`'s `createServer()` must never share a process with another Vite instance, and vitest's own module transform *is* one). `test/build/dev.test.ts`'s real `devServer()` calls are this module's functional coverage instead. |
| `**/*.vue` | SFC `<script setup>` internals aren't unit-testable via plain branch coverage the way composables/utils are — golden fixtures + wiring tests (see [subsystem-theme.md](./subsystem-theme.md)) cover them instead. |
| `**/*.d.ts` | Ambient type-only declarations — zero executable code. |
| `src/theme/index.mts` | Re-exports `Layout.vue` (itself excluded) plus side-effect CSS imports; importing it for coverage would force-load the whole component graph through Vite's transform pipeline for no branch-coverage benefit. |

Both process-boundary exclusions (`cli/index.ts`, `dev_worker.ts`) share one
real constraint: v8 coverage only observes code loaded **inside the
instrumented vitest process**. A file that only ever runs as a separate OS
process cannot be instrumented by definition — the exclusion is the honest
description of that boundary, backed by a real black-box test elsewhere in
the suite, not a way to skip testing the file.

No inline `// v8 ignore` appears without a comment naming what it's for and
why (e.g. `useCatalog.ts`'s `finally` block comment: "v8-to-istanbul
instruments this bare-statement finally header as a synthetic branch").

## DAMP, not DRY

Test code favors being self-contained and readable in isolation over
eliminating duplication — matching [quality-core.md](./quality-core.md)'s general "DAMP" carve-out
from DRY. `test/sources/helpers.ts` states the actual bar explicitly: shared
builders are extracted only once real duplication crosses multiple files
("quality-core.md DRY: 5 genuine callers" in the file's own comment —
path/extract/labels/mirror/walker all needed the same schema-shaped root
builder and byte-equality check; `git.test.ts` has since become a 6th caller
of `bytesEqual`/`utf8`, same bar, comment not yet bumped).
Most test files instead define their own small local helpers even when a
near-identical one exists elsewhere (e.g. `brand_install_wiring.test.ts`'s
`sourceWithoutComments`) — each test file should read on its own.

## Golden fixtures

`test/golden/<case>/` pairs an `input.ts` with a committed
`expected/catalog.json` — `golden.test.ts` discovers case directories at
collection time (`readdirSync`, not a hardcoded list) and asserts
`catalogIndex`+`serializeCatalog` reproduce the expected bytes **exactly**
(`Buffer.compare`, with a byte-offset divergence report on failure, never a
semantic/JSON-equality check). A new case directory joins the suite with no
edit to `golden.test.ts` itself.

## Two rules that have each cost this repo a real defect

**(1) Coverage cannot detect unreachable production code.** A library
module can be 100%-covered by tests that call it directly while nothing in
the shipped app actually wires it in — the coverage gate is blind to that,
because it only asks "did this line run under some test", never "does a real
entrypoint reach this line". This repo's own history: `themeConfig.brand`
was fully generated, fully covered, and read by *zero* component
(`SiteHeader.vue` and `Logo.vue` both hardcoded their values instead) before
`test/theme/components/brand_install_wiring.test.ts` was added to assert the
**rendered** result for a configured vs. unconfigured theme, plus a
source-level grep pinning that the hardcoded literals never come back.
`readme_pane_wiring.test.ts` exists for the identical reason on a different
surface. A new library-layer module needs a test proving a shipped
entrypoint actually calls it — not just tests of the module in isolation.

**(2) `test/` is not typechecked.** `tsconfig.json`'s `include` is exactly
`["src"]` (with `src/theme` excluded there and typechecked separately by
`tsconfig.theme.json`, whose own `include` is `["src/theme"]`) — `test/` is
in neither, and `package.json`'s `typecheck` script (`tsc --noEmit && tsc -p
tsconfig.theme.json`) covers only those two. `npm run typecheck` passing is
**not** evidence that test fixtures still match current types — a fixture
passing a config field that was since removed from `CatalogConfig` fails
only at `vitest run` time (a real runtime/behavioral failure, if the removed
field happened to still parse), not at typecheck time. Don't treat a clean
`typecheck` run as proof the test suite compiles against current types; only
`npm test` proves that.
