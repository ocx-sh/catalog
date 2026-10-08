# hex memory — ocx-catalog

Maintained by the hex skills. Small by contract: pointers and preferences,
not copies. Team-shared — commit it.

## Pointers

- Verification: `AGENTS.md` › Commands — `task verify` (go-task, provisioned
  via `ocx.toml`/`ocx.lock`) is the canonical local + CI surface, byte for
  byte: lint → typecheck → test → pack-smoke. The npm scripts it wraps
  (`npm run lint`/`typecheck`/`test`, `node scripts/pack-smoke.mjs`) still
  work. `docs:*`, `quality:web`, `dev:*` and the repo-hygiene tasks are
  standalone, deliberately not part of `verify`.
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

- Active plan: `.claude/state/plans/plan_ocx_theme_port.md` (tier xhigh) —
  port onto `@ocx-sh/theme` (Astro 7 subprocess renderer + Starlight docs) on
  branch `feat/ocx-theme-port`. Inputs: `.claude/artifacts/adr_ocx_theme_port_2026-10-07.md`,
  `research_ocx_theme_port_discovery.md`, `research_astro_programmatic_renderer.md`.
  Library requests go to the `ocx-website-*` session; gate G1 = one pending SHA.
- Previous active plan: `plan_sota_release_ready.md` (tier high; status not re-checked).
