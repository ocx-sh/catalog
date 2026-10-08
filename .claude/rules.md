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
| Vite / Vitest / Astro build tooling | [quality-vite.md](./rules/quality-vite.md) |
| Design tokens (consumed from `@ocx-sh/theme`), literal-colour ban, the consumer cascade | [quality-design-tokens.md](./rules/quality-design-tokens.md) |
| This package's own CI and release workflows | [quality-security.md](./rules/quality-security.md) |
| The Astro site (`src/site`) — route identity, URL sinks, sanitisation, CSP, install commands, filters, lazy islands | [subsystem-site.md](./rules/subsystem-site.md) |
| Reading indices — containment, CAS, labels, reserved names, the mirror, scratch/staging | [subsystem-sources.md](./rules/subsystem-sources.md) |
| Rendering other repositories' CI workflows | [subsystem-ci-renderer.md](./rules/subsystem-ci-renderer.md) |
| The test gate — `unit`/`acceptance` projects, coverage exclusions, non-negotiables | [subsystem-tests.md](./rules/subsystem-tests.md) |
| Maintaining `AGENTS.md`, rules, skills, agents | [meta-ai-config.md](./rules/meta-ai-config.md) |
| Documentation pages — prose, examples, navigation, page types (grim-installed, `docs-essentials`) | [docs-quality.md](./rules/docs-quality.md) |

## By auto-load path

| Edit path | Rules that auto-load |
|---|---|
| `**/*.ts`, `**/tsconfig*.json` | [quality-typescript.md](./rules/quality-typescript.md) |
| `**/vitest.config.*`, `src/site/astro_config.ts`, `docs/astro.config.mjs` | [quality-vite.md](./rules/quality-vite.md) |
| `src/site/**/*.astro` | [quality-design-tokens.md](./rules/quality-design-tokens.md) |
| `.github/workflows/**`, `.github/actions/**`, `.github/zizmor.yml` | [quality-security.md](./rules/quality-security.md) |
| `src/site/**` | [subsystem-site.md](./rules/subsystem-site.md) |
| `src/sources/**`, `src/build/**` | [subsystem-sources.md](./rules/subsystem-sources.md) |
| `src/ci/**`, `templates/**` | [subsystem-ci-renderer.md](./rules/subsystem-ci-renderer.md) |
| `test/**`, `vitest.config.ts` | [subsystem-tests.md](./rules/subsystem-tests.md) |
| `.claude/**`, `AGENTS.md`, `CLAUDE.md` | [meta-ai-config.md](./rules/meta-ai-config.md) |
| `**/*.md`, `**/*.mdx`, `**/*.rst`, `**/*.adoc`, `**/mkdocs.yml`, docs-generator configs | [docs-quality.md](./rules/docs-quality.md) |

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
| Docs plan / IA, page inventory, tiers (grim-installed) | `docs-plan` |
| Wiring docs checks or a docs CI gate (grim-installed) | `docs-instrument` |
| Grading doc pages against docs-quality (grim-installed) | `docs-review` |

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

`docs-quality` and the `docs-*` skills are installed by grim from the
`docs-essentials` bundle (`grimoire.toml`/`grimoire.lock`). Update them with
`grim update`, never by hand — a local edit is overwritten on the next install.
