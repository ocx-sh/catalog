---
name: meta-maintain-config
description: Use when creating or editing skills, rules, or agents under `.claude/`. Also when AI knowledge has drifted from project patterns, a new Claude Code feature lands, or syncing artifacts to current state. Modes: `create`, `audit`, `refresh`, `review`, `research <topic>`.
user-invocable: true
argument-hint: "create | audit | refresh | review | research topic"
disable-model-invocation: true
triggers:
  - "maintain the config"
  - "update the rules"
  - "update the skills"
  - "ai config drift"
  - "add a skill"
  - "edit the agent"
---

# AI Configuration Maintenance

Keep `.claude/` a living knowledge base, current with this project and with
Claude Code tooling itself.

**Read [`meta-ai-config.md`](../../rules/meta-ai-config.md) first** — it
defines the conventions, budget constraints, and anti-patterns this skill
enforces, and is the source of truth if anything below drifts from it.

## Modes

### `create` — New Artifact

1. **Discover + Research** — invoke the canonical multi-agent research
   primitive from `/hex-plan` (Discover + Research phases). Spawn in
   parallel:
   - an explorer pass: existing `.claude/` patterns, conventions, and
     neighbors of the new artifact
   - a researcher pass: Claude Code docs (`code.claude.com/docs`), domain
     best practices for the artifact's topic

   Persist substantial findings as `.agents/research/research_[topic].md`
   for reuse (see `/hex-plan`'s research-artifact convention).

2. **Draft** — follow `meta-ai-config.md`'s Artifact Conventions:
   - Respect the context budget (rules <200 lines each, skill body <500
     lines)
   - Use `paths:` scoping for rules unless the content is genuinely global
   - Skills: write `description` as trigger phrasing for the tasks that
     should surface it, not a summary of its internals
   - Progressive disclosure — keep `SKILL.md` short, move detail to
     reference files the skill reads on demand
   - `disable-model-invocation: true` for any action skill with side effects
   - Agents (if one is genuinely needed): name `.claude/agents/worker-<name>.md`,
     set `model` explicitly, point at `.claude/rules.md` for the rule
     catalog rather than duplicating rule content into the agent body —
     and check first whether `/hex-plan`/`/hex-execute`/`/hex-review`
     already cover the role internally (see `.claude/rules.md`'s "Skills
     and agents" section) before adding a local one that shadows it

3. **Integrate** — add the new artifact to `.claude/rules.md`'s "By
   concern" (and "By auto-load path", for a scoped rule) table in the same
   change

4. **Validate** — run `audit` mode

### `audit` — Check All Artifacts

**Context budget audit:**
- `AGENTS.md` under 200 lines?
- Each global rule (no `paths:`) under 200 lines?
- Skill descriptions still concise and discriminating?

**Structural audit:**
- Every `SKILL.md` has `name` + `description`?
- Persona-style skills have `user-invocable: true`?
- Action skills with side effects have `disable-model-invocation: true`?
- Any local agent sets `model` explicitly and grants only the tools its
  role needs?

**Dead glob audit:**
- For each scoped rule's `paths:` patterns, do they still match a real
  file? `find . -path "<pattern>" | head -1` after any directory rename.

**Cross-reference audit:**
- Every rule/skill/agent reference to another `.claude/` file resolves —
  check against the exact 10-file rule set in `.claude/rules.md`, not a
  remembered or assumed list.
- No reference to a rule this repo doesn't have (e.g. anything Rust/`task`-
  runner-specific ported from a sibling repo without adaptation).

**Duplication audit:**
- Same instruction present in both `AGENTS.md` and a rule? Pick one source
  of truth, cross-reference the other.
- Same domain knowledge in both a skill and a rule? Skill = on-demand
  workflow, rule = always-on standard — they shouldn't restate each other.

**Catalog-sync check** (no structural test suite exists here — this is
manual):
- `ls .claude/rules/*.md` — every file has a matching row in
  `.claude/rules.md`'s "By concern" table?
- Every entry in that table resolves to a real file?
- "By auto-load path" table's `paths:` globs match each rule file's actual
  frontmatter?

### `refresh` — Sync AI Knowledge with Codebase

1. **Detect drift** — this is `meta-validate-context`'s job; run it (or its
   workflow inline) for every `subsystem-*.md` rule.
2. **Research updates** — a researcher pass via `/hex-plan`'s primitive:
   Claude Code docs for new features (hooks, frontmatter, agents), and
   current best practices for this repo's actual stack (TypeScript, Vite/
   Vitest/VitePress, npm publishing).
3. **Update stale artifacts** — read current code, correct the rule,
   preserve its structure.
4. **Self-update** — check whether this skill or `meta-ai-config.md` itself
   is stale per research findings; update those too.
5. **Validate** — run `audit` mode.

### `review` — AI Config Quality Review

Review recent changes to `.claude/` for quality:

1. **Context budget** — does the change increase always-loaded context?
   Justified?
2. **Scoping** — could a global rule instead be path-scoped?
3. **Progressive disclosure** — is `SKILL.md` still under 500 lines?
4. **Description quality** — specific enough for auto-discovery, phrased as
   triggers rather than a summary?
5. **Anti-patterns** — check against `meta-ai-config.md`'s 7 listed
   anti-patterns.
6. **Consistency** — does the change follow existing artifact conventions?
7. **Reusability** — would a hook (deterministic, zero context cost) serve
   better than a rule here?

### `research` — Deep-Dive Topic

Invoke the canonical multi-agent research primitive from `/hex-plan`
(Discover + Research phases) rather than reinventing it.

1. Spawn researchers in parallel, split by axis (e.g. Claude Code/AI-
   tooling best practices vs. this repo's own stack — TypeScript, Vite/
   VitePress/Vue, npm publishing conventions), plus an explorer pass to
   ground findings in existing `.claude/` artifacts.
2. Synthesize into actionable guidance; persist as
   `.agents/research/research_[topic].md`.
3. Apply — update the relevant artifact.

## Refresh Targets

| Artifact | What goes stale | Refresh trigger |
|---|---|---|
| `subsystem-*.md` rules | Types, paths, exports | After refactors, new modules — see `meta-ai-config.md`'s "When to Update" |
| `quality-typescript.md` | Claimed strict-mode/tsconfig baseline | After `tsconfig.json` changes |
| `quality-vite.md` | Build-tool conventions | After Vite/Vitest/VitePress version bumps |
| `quality-security.md` | CI/CD checklist | After `.github/workflows/**` changes |
| `meta-ai-config.md` | Conventions, budget numbers, anti-patterns | After Claude Code releases |
| `AGENTS.md` | Commands, layout, workflow | After new scripts, directories, or workflow changes |
| This skill | Modes, refresh targets | After Claude Code releases |

## Maintenance Schedule

| Frequency | Action |
|---|---|
| Every feature branch | `audit` before merging `.claude/` changes |
| Monthly | `refresh` to detect drift |
| On Claude Code update | `research "Claude Code new features"`, then self-update |
| On new tool integration | `create` for its skill/rule, then `audit` |
| When something feels off | `review` recent changes |

## Constraints

- ALWAYS research before creating a new AI-config artifact
- ALWAYS check context-budget impact (does this add always-loaded content?)
- NEVER remove an artifact without checking cross-references first
- Prefer a hook over a rule for anything purely deterministic — zero
  context cost beats a rule that must be read every session
- Commits touching `.claude/`, `AGENTS.md`, or `CLAUDE.md` use the `chore:`
  prefix (matches this repo's Conventional Commits convention)
- Never shadow the globally-installed `hex-*` family with a local copy —
  see `.claude/rules.md`'s "Skills and agents" section
