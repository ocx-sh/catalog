# AGENTS.md

Single project-context file for **every** AI agent working in this repo —
Claude Code, Codex CLI, and any other `AGENTS.md`-aware tool.

> **Edit this file, never `CLAUDE.md`.** `CLAUDE.md` is a one-line pointer
> that imports this one, so a second copy would only drift. The same goes
> for anything it links: fix the source file, not a restatement of it.

Lines beginning `@` are Claude Code file imports, expanded into context
automatically; other agents should open those paths directly.

## What is `@ocx-sh/catalog`

A [VitePress](https://vitepress.dev) static-site generator that renders one
or more **OCX package indices** into a browsable catalog: a package grid,
per-package detail pages (README, platforms, versions, install commands),
search, and an optional docs mount. Binary: `ocx-catalog`. ESM-only,
Node >= 20.19, npm toolchain.

**An index is not this package**, and that distinction is the load-bearing
one here: this package only ever *reads* an index — it never writes index
data and never invents it. The index's URL shapes and field semantics are a
frozen one-way door it must read faithfully but **does not own**.

Full positioning — what an index is, who consumes this renderer, which
surfaces this package owns versus reads, and the non-goals →
[`product-context.md`](./.claude/rules/product-context.md). Canonical; do
not restate it here.

> **Status: pre-1.0, unpublished.** `0.1.0` is complete and gated but not on
> npm — it waits on the `@ocx-sh` org and a manual first publish. There is
> **no GitHub remote yet**: this is a local-only checkout that
> [`ocx-sh/index`](https://github.com/ocx-sh/index) consumes through a
> `file:../ocx-catalog` dependency. Until it publishes, the index's own CI
> cannot build it, and that is expected.

## Rule Catalog

Before planning, research, or an architectural decision, scan "By concern"
in the catalog below. Path-glob rules fire only once a matching file is
already open; the catalog covers everything before that.

@.claude/rules.md

## Commands

Plain npm scripts — there is **no `task` runner** here.

```sh
npm run lint              # eslint (typescript-eslint, flat config)
npm run typecheck         # tsc --noEmit && tsc -p tsconfig.theme.json
npm test                  # vitest run --coverage — the gate, see below
npm run build             # tsc -> dist/ (postbuild chmods the CLI entry)
node scripts/pack-smoke.mjs   # publint + attw + a real pack/install smoke
```

`npm test`, `npm run lint`, `npm run typecheck` and `node
scripts/pack-smoke.mjs` together are the local equivalent of CI. Run all
four before calling anything done.

CI (`.github/workflows/ci.yml`) runs six jobs: `lint`, `typecheck`, `test`,
`pack-verify`, `workflows-lint` (zizmor), `audit-signatures`.

## Quality Gate

- **100% coverage — statements, branches, functions, lines.** A design
  constraint, not a target; never lower a threshold in `vitest.config.ts`.
  New branches get covering tests in the same change.
- No inline coverage pragmas. The only exclusions are the reviewed list in
  `vitest.config.ts`, each of which has a stated reason.
- **Coverage cannot detect unreachable production code.** A new module
  needs a test proving a *shipped entrypoint* reaches it — this repo has
  shipped a fully-tested, fully-orphaned module before.
- `test/` is not in `tsconfig.json`'s `include`, so `npm run typecheck`
  does not check test files. A fixture passing a removed field fails only
  at runtime — grep for call sites when changing a public shape.
- Tests are DAMP, not DRY: self-contained and readable in isolation.

## Generated Files

`templates/ci/*.yml` render other repositories' CI workflows. Output must
satisfy the invariants it generates: default-deny `permissions:`, per-job
least privilege, `persist-credentials: false`, and **SHA-pinned `uses:`
refs only** — a mutable ref is never carried forward. See
[`subsystem-ci-renderer.md`](./.claude/rules/subsystem-ci-renderer.md).

## Workflow

- **Branch + PR + merge.** No remote exists yet, so commits land on `main`
  locally; once the GitHub repo is created, switch to branch + PR.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `ci:`, `chore:`, `docs:`, `test:`). No `Co-Authored-By`
  trailers.
- Planning: research → ADR/design → plan → execute, via the global `hex-*`
  skills (`/hex-plan`, `/hex-execute`, `/hex-review`). Memory lives in
  `.agents/memory/hex.md`.
- Plans live in `.claude/state/plans/plan_*.md` (gitignored; Plan Status
  Protocol in `.claude/rules/meta-ai-config.md`); ADRs and research
  artifacts in `.claude/artifacts/` (`adr_*.md`, `research_*.md`), plain
  markdown. Shipped hex templates are the fallback format.

## Model Policy

Applies to **every** subagent spawn (Agent tool, `Workflow` `agent()`, hex
workers). Always set `model` explicitly — never rely on inherit.

| Task | Model |
|---|---|
| Implementation, research, review, docs, tests, exploration — **the default** | **Sonnet 5** (`sonnet`) |
| Genuinely hard problems where Sonnet demonstrably falls short | `opus` — rare, justify in the spawn prompt |
| Synthesizing multiple agent results into architecture conclusions | Fable — main loop only |

**Never** spawn Fable subagents. Parallelize Sonnet workers instead of
escalating tier.

## Layout

| Path | Purpose |
|---|---|
| `src/cli/` | `ocx-catalog` — `build \| dev \| ci`; commander wiring, BSD sysexit codes |
| `src/config/` | `catalog.config.json` loader + its JSON Schema (`schema/`) |
| `src/sources/` | Index readers (`path`/`url`/`git`), label derivation, the mirror, `_headers` |
| `src/build/` | VitePress orchestration: scratch roots, page synthesis, generated config, dev child process |
| `src/ci/` | The generated-workflow renderer — templates, pins, header versioning, drift check |
| `src/theme/` | The Vue 3 VitePress theme (components, composables, utils, styles) |
| `src/viewmodel/` | The `/data/catalog/catalog.json` view-model emitter |
| `templates/` | Rendered CI workflow templates (`ci/*.yml`) |
| `test/` | Vitest suites, mirroring `src/` |
| `scripts/pack-smoke.mjs` | Publish-shape verification (publint, attw, real pack + install) |

## Release

`.github/workflows/release.yml` — `gate` (full quality run) then `publish`
via **npm trusted publishing (OIDC)** with `--provenance`. The publish job
uses `npm ci --ignore-scripts`: it holds `id-token: write`, so a lifecycle
script from any transitive dependency could otherwise mint an npm token.

**The first publish must be manual** — trusted publishing cannot be
configured for a package name that does not exist yet.
