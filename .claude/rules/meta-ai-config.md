---
paths:
  - .claude/**
  - AGENTS.md
  - CLAUDE.md
---

# AI Configuration Meta-Rule

Governs how `.claude/` artifacts (rules, skills, agents) are maintained in this
repo. Loads when working on any `.claude/` file, `AGENTS.md`, or `CLAUDE.md`.

## Single project-context file: `AGENTS.md`

This repo keeps one project-context file, `AGENTS.md`, at the repo root.
`CLAUDE.md` is a one-line `@AGENTS.md` import hook and nothing else. **Every
project-context edit goes to `AGENTS.md`** — narrative about what this package
is, workflow conventions, layout tables. Never add project content directly to
`CLAUDE.md`; if you find yourself wanting to, the edit belongs in `AGENTS.md`
instead, and `CLAUDE.md` picks it up through the import.

## Three Activation Layers

Claude Code has three rule-activation mechanisms. Each serves a different
purpose — conflating them produces dead rules or context bloat.

| Layer | Activation | Use for |
|---|---|---|
| **Rule** (`.claude/rules/*.md`) | `paths:` glob — fires when an edited file matches | Standards needed *while writing* a matching file |
| **Skill** (`.claude/skills/<name>/SKILL.md`) | `description` matched by the model against the current task | A workflow plus criteria for a task topic |
| **Catalog** (`.claude/rules.md`) | Read on demand during planning | Discover what rules exist *before* any matching file is open |

Path-scoped rules don't fire during planning/research — no file is open yet.
Skills need the model to already know the skill exists. The catalog closes that
gap. Any change to `.claude/rules/` must be reflected in `.claude/rules.md` in
the same commit.

## Context Budget

Every rule, skill description, and `AGENTS.md`/`CLAUDE.md` line competes for the
same context window. Bloated config gets ignored.

| Artifact | Budget | Impact |
|----------|--------|--------|
| `AGENTS.md` | <200 lines | Loaded every request via `CLAUDE.md`'s import — every line costs attention |
| Rules (global, no `paths:`) | <200 lines each | Load every request — minimize how many are global |
| Rules (path-scoped) | <200 lines each | Load only on path match — prefer scoping over going global |
| Skill descriptions | Small — all descriptions load at session start | Front-load discriminating keywords |
| Skill body (`SKILL.md`) | <500 lines | Loads only when invoked — safe for detail |

**Decision tree — where does an instruction belong?**

```
Must Claude know it every session?
├─ Yes → Is it file/directory-specific?
│  ├─ Yes → .claude/rules/ with paths: scoping
│  └─ No → AGENTS.md (only if removing it would cause mistakes)
└─ No → Is it invoked manually or auto-triggered?
   ├─ Manual with side effects → Skill with disable-model-invocation: true
   ├─ Auto-triggered by context → Skill with a good description
   └─ Pure automation, no model judgment → Hook (deterministic, zero context cost)
```

## Artifact Conventions

### Rules (`.claude/rules/*.md`)

- `paths:` frontmatter for scoped rules; omit entirely for a global rule.
- <200 lines. If longer, split by domain rather than let one file grow.
- After renaming or moving a directory, re-check that every `paths:` glob in
  the affected rule still matches a real file — a glob that stops matching
  fails silently, the rule just never loads again.
- **Shareable quality rules** use the `quality-*.md` naming convention (e.g.
  `quality-typescript.md`). Keep them free of this-package-specific narrative
  where the underlying principle is genuinely general — but a config-driven
  fact grounded in this repo's own `tsconfig.json`/`eslint.config.js` (e.g.
  which strict flags are actually on) belongs in the rule, not omitted for
  the sake of appearing portable; an inaccurate "shareable" claim is worse
  than a repo-grounded one.

### Skills (`.claude/skills/<name>/SKILL.md`)

- `description` is the primary discovery signal — write it as trigger
  phrasing for the tasks that should surface the skill, not as a summary of
  what the skill does internally.
- `disable-model-invocation: true` for any action skill with side effects
  (publish, release, config mutation) — require an explicit user invocation
  rather than letting the model decide to run it.
- Progressive disclosure: keep `SKILL.md` itself short, move reference
  material into files the skill reads on demand.

### Agents (`.claude/agents/worker-{name}.md`)

- `model`: Sonnet is the default for exploration, research, docs, mechanical
  edits, and test scaffolding. Reserve Opus for review, security analysis,
  and non-mechanical/architecture-level implementation. Never default to
  inherit — set `model` explicitly on every spawn so a Fable/Opus main loop
  can't silently spawn a same-tier worker.
- `tools`: grant the minimum the agent's role actually needs.
- Point agents at `.claude/rules.md` for the full rule catalog rather than
  duplicating rule content into the agent body — duplicated checklists drift
  from the source rule and become a second thing to keep in sync.

## Plan Status Protocol

If a plan file under `.claude/state/plans/plan_*.md` exists, it carries a
`## Status` block in its first ~30 lines so progress is readable at a glance
without scanning the whole plan:

```markdown
## Status

- **Plan:** plan_<slug>
- **Active phase:** <N> — <phase title>
- **Step:** <current activity, e.g. "implementation", "review round 2">
- **Last update:** <YYYY-MM-DD> (after <commit-sha-short>: <subject>)
```

A repo-wide pointer, `.claude/state/current_plan.md` (gitignored,
per-worktree), names which plan is active:

```markdown
# Current Plan Pointer

- **Plan:** .claude/state/plans/plan_<slug>.md
- **Branch:** <branch-name>
- **Updated:** <YYYY-MM-DD HH:MM UTC>
```

The pointer answers "which plan?"; the Status block answers "where in that
plan?" — the pointer is a fast path, the Status block is the record that
survives the pointer being deleted. Phase advancement is a deliberate
decision encoded as a `Step` transition, never an automatic side effect of a
commit landing.

Plans' sibling artifacts — ADRs (`adr_*.md`) and research write-ups
(`research_*.md`) — live in `.claude/artifacts/`, plain markdown, **not**
gitignored (unlike `.claude/state/plans/`): they're the durable record of a
plan's own research and decisions, so they're committed alongside the code
they informed. `AGENTS.md`'s Workflow section names both paths for a
newcomer; this section is the canonical description of the plan-state half
of that pair.

## Anti-Patterns

1. **A global rule over 200 lines** — same problem as a bloated `AGENTS.md`.
2. **A rule matching `src/**/*`** — too broad; it stops being distinguishable
   from `AGENTS.md` itself.
3. **Duplicate content** across `AGENTS.md`, rules, and skills — pick one
   source of truth and cross-reference it, don't restate it.
4. **A verbose `SKILL.md`** without progressive disclosure — move reference
   material to support files the skill reads on demand.
5. **Missing `disable-model-invocation`** on an action skill with side
   effects — leaves invocation timing unpredictable.
6. **A dead `paths:` glob** — a rule that silently stops firing after a
   directory rename or file move.
7. **Rule/skill/agent content that's really project narrative** — repo
   layout, identity, and workflow belong in `AGENTS.md`, not smuggled into a
   `quality-*.md` file that's supposed to be broadly reusable.

## When to Update

| Trigger | Action |
|---|---|
| New rule added, removed, or renamed under `.claude/rules/` | Update `.claude/rules.md` in the same commit |
| New skill or agent added | Cross-reference it from `.claude/rules.md` if it addresses a listed concern |
| CI workflow changed | Update `quality-security.md` |
| `tsconfig.json` or `eslint.config.js` changed | Re-verify `quality-typescript.md`'s claimed baseline still matches |
| Directory renamed | Re-check every `paths:` glob in scoped rules still matches |
