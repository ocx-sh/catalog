# hex memory — ocx-catalog

Maintained by the hex skills. Small by contract: pointers and preferences,
not copies. Team-shared — commit it.

## Pointers

- Verification: `AGENTS.md` › Commands — `npm run lint`, `npm run typecheck`,
  `npm test`, `node scripts/pack-smoke.mjs`; all four together are the
  local CI equivalent.
- Plan / ADR conventions: plans in `.claude/state/plans/plan_*.md`
  (gitignored; Plan Status Protocol in `.claude/rules/meta-ai-config.md`);
  ADR/research artifacts in `.claude/artifacts/` (`adr_*.md`,
  `research_*.md`). Shipped hex templates are the fallback only.
- Product knowledge: `.claude/rules/product-context.md` (indexed from
  `.claude/rules.md`).
- Key rules: `.claude/rules.md` catalog; security-sensitive: `src/sources/**`
  (untrusted index ingestion), `src/ci/**` + `templates/**` (rendered CI
  workflows), `.github/workflows/**` (OIDC publish pipeline).
- Worktrees: default `.agents/worktrees/` (gitignored).

## Preferences

```yaml
# hex config, vocabulary v2. Unknown keys warn once and are ignored.
models:
  fast-balanced: sonnet
  deep-reasoning: opus
adversary: codex:rescue
perspectives:
  always:
    - role: reviewer:security
      when: "src/sources/**"
    - role: reviewer:security
      when: "src/ci/**"
    - role: reviewer:security
      when: "templates/**"
    - role: reviewer:security
      when: ".github/workflows/**"
```

- Security review means the untrusted-index readers and the rendered-CI
  invariants (`subsystem-sources.md`, `subsystem-ci-renderer.md`), not the
  Vue theme.

## Memory

- Active plan: `.claude/state/plans/plan_sota_release_ready.md` (tier high) —
  SOTA + release-ready single-PR round on branch `feat/sota-release-ready`.
  Inputs: `.claude/artifacts/research_initial_review_2026-08-22.md`,
  `.claude/artifacts/adr_tooling_and_quality_gate_2026-08-22.md`.
