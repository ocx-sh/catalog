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

> **Status: pre-1.0, published.** `latest` on npm is `0.4.0` (verified via
> `npm view @ocx-sh/catalog version`), the same version tagged `v0.4.0` in
> this repo — the release lane has carried every version since `0.1.0`
> through `0.2.0`, `0.2.1`, `0.3.0`, and `0.4.0`. The GitHub remote
> [`ocx-sh/catalog`](https://github.com/ocx-sh/catalog) is public, and the
> user documentation is a MkDocs Material site under `docs/`, published to
> GitHub Pages (`README.md` is a pointer at it, not a second copy). The
> release lane is fully operational: `0.1.0` was a one-time manual bootstrap
> publish (trusted publishing cannot pre-provision a new package name), and
> every version since went out through CI with a real provenance
> attestation. No release setup remains — see [Release](#release).

## Rule Catalog

Before planning, research, or an architectural decision, scan "By concern"
in the catalog below. Path-glob rules fire only once a matching file is
already open; the catalog covers everything before that.

@.claude/rules.md

## Commands

`taskfile.yml` (go-task, provisioned via `ocx.toml`/`ocx.lock`) is the
canonical local + CI surface — CI runs the same `task <name>` a developer
runs, byte for byte, so local and CI execute identical checks. No `ocx run --`
prefix is needed there: `ocx-sh/setup-ocx` activates the project, which puts
every tool `ocx.lock` pins on `PATH` for the steps that follow. The plain npm
scripts still exist underneath; `task` wraps them.

```sh
task                # → verify (the default)
task verify         # the four-gate quality run: lint → typecheck → test → pack-smoke
task lint           # npm run lint (eslint, flat config)
task typecheck      # npm run typecheck (tsc --noEmit && tsc -p tsconfig.theme.json)
task test           # npm test (vitest run --coverage — 100% gate)
task pack-smoke     # node scripts/pack-smoke.mjs (publint + attw + real pack/install)
task build          # npm run build (tsc -> dist/; postbuild chmods the CLI entry)
task docs:build     # mkdocs build --strict (the docs site; standalone)
task docs:serve     # local docs preview on 127.0.0.1:8000
task changelog:preview   # git-cliff --unreleased
task release:prepare BUMP=auto|patch|minor|major   # see Release
task dev:indexes         # seed .dev-indexes/ (needs ../index checked out)
task dev:catalog CASE=multi-root   # serve one seeded multi-index case
```

`task verify` is the local equivalent of the CI quality gate — run it before
calling anything done. Repo-hygiene tasks (`lint:actions`, `lint:links`,
`secrets`, `lint:workflows`), `quality:web` (Lighthouse CI over a fixture
site), `dev:*` (the manual multi-index review harness — the one task that
needs the sibling `ocx-sh/index` checkout) and `docs:*` (the MkDocs
documentation site) run standalone, not as part of `verify` — `verify` must
stay runnable with the npm toolchain alone.

CI (`.github/workflows/ci.yml`) runs: `lint`, `typecheck`, `test`,
`pack-verify`, `workflows-lint` (zizmor), `audit-signatures`, `repo-checks`
(actionlint/lychee/gitleaks), and `web-quality` (Lighthouse CI).
`.github/workflows/pages.yml` builds `docs/` on every docs-touching PR
(`mkdocs build --strict` is the dead-internal-link gate) and publishes it to
GitHub Pages on `main`.

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

- **Branch + PR + merge** against the `ocx-sh/catalog` GitHub remote — the
  active workflow; never commit straight to `main`.
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
| `docs/` | The user documentation site (MkDocs Material, `mkdocs.yml`) — published at `https://ocx-sh.github.io/catalog/` |
| `test/` | Vitest suites, mirroring `src/` |
| `scripts/pack-smoke.mjs` | Publish-shape verification (publint, attw, real pack + install) |

## Release

`.github/workflows/release.yml` — `gate` (full quality run) then `publish`
via **npm trusted publishing (OIDC)** with `--provenance`. The publish job
uses `npm ci --ignore-scripts`: it holds `id-token: write`, so a lifecycle
script from any transitive dependency could otherwise mint an npm token.

`task release:prepare BUMP=<level>` prepares a release locally: it computes
the next version (git-cliff), writes it into `package.json`, regenerates
`CHANGELOG.md`, and runs `verify` — then prints the manual commit/tag/push
steps. It never commits, tags, or pushes.

The npm Trusted Publisher is registered and proven end to end: `0.1.1`
published through this lane with a SLSA v1 provenance attestation. It is
scoped to org `ocx-sh`, repo `catalog`, workflow `release.yml`, and **no
environment** — npm's form has no branch field, so the scope is
org + repo + workflow (+ optional environment), and a configured environment
the `publish` job does not set would reject the OIDC exchange. `--provenance`
additionally requires the GitHub repo to be public at tag-push time; it is,
and taking it private would silently drop attestations rather than fail.
