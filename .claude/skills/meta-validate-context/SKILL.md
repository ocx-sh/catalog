---
name: meta-validate-context
description: Use when auditing the freshness of `.claude/rules/subsystem-*.md` files against current codebase state, or when a subsystem (theme, sources, CI renderer, tests) has undergone significant change.
user-invocable: true
argument-hint: "all | subsystem-name"
triggers:
  - "validate context"
  - "audit subsystem rules"
  - "check subsystem rules"
  - "freshness of rules"
---

# Validate Context Rules

Check `.claude/rules/subsystem-*.md` files match current codebase state.

## Workflow

For each `subsystem-*.md` rule file:

1. **Read the rule** — extract type/interface/function names, module paths,
   file-name references
2. **Grep the codebase** — verify each reference still exists, at the path claimed
3. **Check for new additions** — find new exported types/functions in the
   subsystem's directory not mentioned in the rule
4. **Report** — list stale references and missing additions

## Subsystem Rules to Check

| Rule | Key references to verify | Path scope |
|---|---|---|
| [`subsystem-theme.md`](../../rules/subsystem-theme.md) | Vue components, composables, CSS custom-property tokens | `src/theme/**` |
| [`subsystem-sources.md`](../../rules/subsystem-sources.md) | Reader functions (`path.ts`/`walker.ts`/`git.ts`), containment/digest-validation functions, `mirror.ts` write path | `src/sources/**`, `src/build/**` |
| [`subsystem-ci-renderer.md`](../../rules/subsystem-ci-renderer.md) | Template files, the generated-header version contract, drift-check logic | `src/ci/**`, `templates/**` |
| [`subsystem-tests.md`](../../rules/subsystem-tests.md) | `vitest.config.ts`'s `coverage.exclude` list, golden-fixture convention, test helper locations | `test/**`, `vitest.config.ts` |

Subsystem rules describe real, shipped code here (not scaffolding) — a
stale reference is a real doc-drift bug, not an expected placeholder gap.

## Verification Commands

```bash
# Check if an exported symbol still exists at the claimed path
grep -rn "export function <name>\|export class <name>\|export interface <name>\|export const <name>" src/

# Check if a module/file still exists
ls src/<module>/

# Find new exports in a subsystem's directory not mentioned in its rule
grep -rn "^export " src/<module>/ | grep -v test

# Cross-check vitest.config.ts's actual coverage.exclude against what
# subsystem-tests.md documents
grep -n "coverage" -A 20 vitest.config.ts
```

## Output Format

```markdown
## Context Validation Report

### subsystem-sources.md
- OK: [function/type] still present at [path]
- STALE: [reference] — renamed to [new name] or removed
- MISSING: [new export] — not documented in the rule

### subsystem-theme.md
...
```

## When to Run

- After a refactor touching a covered subsystem
- Before merging AI-config changes touching `.claude/rules/`
- As part of `meta-maintain-config`'s `audit`/`refresh` modes
- Monthly
