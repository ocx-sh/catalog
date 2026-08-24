# Rule Catalog

Entry point for `.claude/rules/`. Any change under `.claude/rules/` must be
reflected here in the same commit — a rule this catalog does not list is a
rule nobody finds before a glob happens to fire.

## By concern

| Concern | Rule |
|---|---|
| What this package is, who consumes it, what is out of scope | [product-context.md](./rules/product-context.md) |
| Code quality, any language | [quality-core.md](./rules/quality-core.md) |
| TypeScript — strict mode, ESM, narrowing | [quality-typescript.md](./rules/quality-typescript.md) |
| Vite / Vitest / VitePress build tooling | [quality-vite.md](./rules/quality-vite.md) |
| CSS custom properties — naming, tiers, coverage honesty | [quality-design-tokens.md](./rules/quality-design-tokens.md) |
| How a consumer's stylesheet wins — cascade layers, element seams, component hooks | [quality-css-overrides.md](./rules/quality-css-overrides.md) |
| This package's own CI and release workflows | [quality-security.md](./rules/quality-security.md) |
| The Vue 3 VitePress theme's conventions | [subsystem-theme.md](./rules/subsystem-theme.md) |
| Reading indices — containment, CAS, labels, the mirror | [subsystem-sources.md](./rules/subsystem-sources.md) |
| Rendering other repositories' CI workflows | [subsystem-ci-renderer.md](./rules/subsystem-ci-renderer.md) |
| The test gate and its non-negotiables | [subsystem-tests.md](./rules/subsystem-tests.md) |
| Maintaining `AGENTS.md`, rules, skills, agents | [meta-ai-config.md](./rules/meta-ai-config.md) |

## By auto-load path

| Edit path | Rules that auto-load |
|---|---|
| `**/*.ts`, `**/*.tsx`, `**/*.mts`, `**/*.cts`, `**/tsconfig*.json` | [quality-typescript.md](./rules/quality-typescript.md) |
| `**/vite.config.*`, `**/vitest.config.*`, `**/.vitepress/config.*` | [quality-vite.md](./rules/quality-vite.md) |
| `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less`, `**/*.styl`, `src/theme/**/*.vue` | [quality-design-tokens.md](./rules/quality-design-tokens.md), [quality-css-overrides.md](./rules/quality-css-overrides.md) |
| `.github/workflows/**`, `.github/actions/**`, `.github/zizmor.yml` | [quality-security.md](./rules/quality-security.md) |
| `src/theme/**` | [subsystem-theme.md](./rules/subsystem-theme.md) |
| `src/sources/**`, `src/build/**` | [subsystem-sources.md](./rules/subsystem-sources.md) |
| `src/ci/**`, `templates/**` | [subsystem-ci-renderer.md](./rules/subsystem-ci-renderer.md) |
| `test/**`, `vitest.config.ts` | [subsystem-tests.md](./rules/subsystem-tests.md) |
| `.claude/**`, `AGENTS.md`, `CLAUDE.md` | [meta-ai-config.md](./rules/meta-ai-config.md) |

Globals (no `paths:` — always loaded):
[quality-core.md](./rules/quality-core.md),
[product-context.md](./rules/product-context.md), this catalog.

## Skills

| Task | Skill |
|---|---|
| Security audit, threat model, attack-surface review | `security-auditor` |
| Designing or writing Vitest suites, closing a coverage gap | `qa-engineer` |
| Auditing `subsystem-*.md` freshness against the code | `meta-validate-context` |
| Creating or editing anything under `.claude/` | `meta-maintain-config` |

## Agents

Typed subagents in `.claude/agents/`, all pinned `model: sonnet` per
`AGENTS.md`'s model policy.

| Agent | Tools | Use for |
|---|---|---|
| `worker-explorer` | Read, Glob, Grep | Read-only parallel codebase search |
| `worker-builder` | Read, Write, Edit, Bash, Glob, Grep | Implementation, refactoring |
| `worker-tester` | Read, Write, Edit, Bash, Glob, Grep | Vitest suites, coverage gaps |
| `worker-reviewer` | Read, Glob, Grep, Bash | Review and security analysis — deliberately no write tools |

These are Agent-tool subagent types (restricted tools, pinned model), which
is a different thing from the `hex-core` worker *personas* the hex
orchestrators inline. Both exist; neither replaces the other.

The `hex-*` planning/execution/review family (`/hex-plan`, `/hex-execute`,
`/hex-review`, `/hex-architect`, `/hex-init`) is installed **globally**, not
here — never shadow it with a local copy.
