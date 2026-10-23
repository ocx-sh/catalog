---
paths:
  - test/**
  - vitest.config.ts
---

# Test Subsystem

`npm test` runs `vitest run --coverage`. The gate
(`vitest.config.ts`'s `coverage.thresholds`) is **100% statements, branches,
functions, and lines** — not a target, the actual configured number. CI's
`test` job runs that exact command; there is no separate, looser local gate.

## Two vitest projects: `unit` and `acceptance`

`vitest.config.ts` defines both; `test/acceptance/helpers.ts` is the contract.

| Project | Runs | Setup |
|---|---|---|
| `unit` | everything except `test/acceptance/**`; Astro-free and fast | `test/global-setup.ts` builds `dist/` once per run (a `globalThis` guard shares it with the other project) |
| `acceptance` | `test/acceptance/**/*.test.ts`; 120 s tests, 300 s hooks | `test/acceptance/global-setup.ts` builds `dist/`, then runs the **real shipped CLI** (`node dist/cli/index.js build`, an `astro build` child inside) once per fixture config |

Acceptance suites assert on real builds and never import `src/**` build code to
render anything. Vitest runs a project's `globalSetup` only when the run selects
one of its files, so `npx vitest run test/foo.test.ts` never starts Astro.

- **Fixture sites** (`test/fixtures/site/`): `root` (base `/`), `rootbase` (same
  inputs at `/catalog/`) and `catalog` (multi-index, `chrome: "ocx"`, `/catalog/`).
  **`ACCEPT_CONFIG=root,catalog`** builds only those; unset builds all three.
  A suite asks `site("root")` / `siteLog("root")`; asking for a site the run did
  not build THROWS with the `ACCEPT_CONFIG` hint — a missing build is red, never
  a skip.
- A suite that needs its own build calls `runCli`/`runBuild` directly and builds
  into a temp dir; nothing writes into the repo. `cliCwd()` is the directory that
  owns the REAL `node_modules` (a worktree's is a symlink), because the Astro
  child resolves `astro` from a root nested in a real `node_modules` tree.
- Planted failures (`plantedFailure("render" | "promotion", out)`) inject through
  `NODE_OPTIONS --require`; a check is only evidence once shown able to fail.

## Coverage exclusions (and why each is real, not cheating)

`coverage.exclude` is **pinned by `test/vitest_config.test.ts`** (C-028) to
exactly this list, so widening it is a reviewed change to that test AND to ADR
D4, not an edit to a glob. The same test pins the 100% thresholds and the two
project names.

| Exclusion | Why |
|---|---|
| `src/cli/index.ts` | The bin shim runs top-level against real `process.argv`, exercised only as a subprocess (`test/cli.test.ts`); v8 only instruments code loaded inside the vitest process. |
| `**/*.astro` | v8 does not instrument compiled Astro output. Templates are covered by the built-HTML acceptance suite and the Chrome gates; their logic lives in `src/site/{model,lib,client}`, which stay at 100%. |
| `**/*.d.ts` | Ambient type-only declarations. |
| `.lighthouserc.cjs`, `.lighthouserc.bulk.cjs` | CommonJS configs read by the `lhci` binary out of process during `task quality:web`. |
| `test/fixtures/quality-index/**` | Committed JSON/markdown/asset fixtures; data, not source. |
| `test/quality/**` | Scaffolding for the standalone `quality:*` tasks. |

`astro_runner.ts` and `dev.ts` are deliberately NOT excluded: both are
unit-tested against an injected fake child (`SpawnFn`). No inline coverage
pragma exists anywhere (`rg "v8 ignore|istanbul ignore" src test` is empty);
add a test or restructure, never a pragma.

## DAMP, not DRY

Tests are self-contained and readable in isolation, per
[quality-core.md](./quality-core.md). Shared builders are extracted only after
real duplication across files (`test/sources/helpers.ts` states the bar and its
callers); most test files define small local helpers even when a near-identical
one exists elsewhere.

## Golden fixtures

`test/golden/<case>/` pairs an `input.ts` with a committed `expected/catalog.json`;
`golden.test.ts` discovers cases at collection time and asserts the output bytes
**exactly** (`Buffer.compare`, byte-offset report on failure, never JSON
equality). `test/golden/baseline_0_5_3/` holds the pre-port route sets and merged
`catalog.json` bytes that `test/acceptance/parity.test.ts` compares real builds
against (C-002): a change there is a change to the wire-visible catalog.

## Rules that have each cost this repo a real defect

**(1) Coverage cannot detect unreachable production code.** A module can be
100%-covered by tests that call it directly while no shipped entrypoint reaches
it; this repo shipped a source layer `engine.ts` never called and a
`themeConfig.brand` no component read, both fully covered. A new module needs a
test that drives a real entrypoint (`buildCatalog`, the CLI, a built page)
through it: the acceptance project exists for that, and the grep tests
(`test/viewmodel/url_sink.test.ts`, `test/site/install_literals.test.ts`,
`test/site/lib/readmeRender.test.ts`, `test/site/client/no_html_sinks.test.ts`)
pin the single legitimate sites of each choke point. Each detector runs against
a planted violation first, which must come out red.

**(2) `test/` is not typechecked.** `tsconfig.json`'s `include` is `["src"]`,
and `npm run typecheck` is `tsc --noEmit` over that alone. A fixture passing a
field since removed from `CatalogConfig` fails only at `vitest run` time, if the
field still parses at all. A clean typecheck is not evidence the suite compiles
against current types; grep `test/` for call sites when a public shape changes.

**(3) A shared `dist/` is a race.** Building it from a `beforeAll` while another
worker packs it intermittently misses files; builds belong in the `globalSetup`
above, once.
