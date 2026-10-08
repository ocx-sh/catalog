# Goal: "port the renderer to Astro + `@ocx-sh/theme`, docs to Starlight"

Source: .claude/state/plans/plan_ocx_theme_port.md · Written: 2026-10-07 by /hex-loop

## Definition of done

- [ ] every pipeline landed — evidence: the commit, PR comment or
  artifact that satisfies it.
- [ ] PR merge-ready (DONE block only) — evidence: the PR URL, and the
  PR is not a draft.
- [ ] CI green per job (DONE block only) — evidence: every check run on
  the PR head SHA with its conclusion; every skipped job states its
  skip reason (its `if:` or path filter).
  A skip with no reason is not green.
- [ ] Deep verify passed (DONE block only) — evidence: the full documented verification result.

## Autonomy

- Prompting: never — no question waits for a human; a doubt runs
  § Issue resolution.
- Granted acts (authority: the pasted prompt): none
- Forbidden or narrowed acts: None.

## Issue resolution

Every doubt — an ambiguous requirement, a design question, a failure
with an unclear cause — runs this protocol:

1. Delegate the research to a sub-orchestrator.
2. Record question → research → decision in this file or in the PR.
3. Defer to a GitHub issue only in hard cases — the research ends with no
   decision, or the decision needs an act outside the grants; the issue
   link is the recorded decision.
4. Every doubt not deferred ends in an action.
5. A pre-existing failure that blocks done is in scope and runs this
   protocol.
6. Findings outside this goal's scope become follow-up issues.
7. Secrets and credential-bearing logs are never written to any committed
   file, commit message, PR text, PR comment or review comment, or issue.
   Security findings are never filed as issues:
   this file records them by reference only — location and class, no
   secret value or exploit detail — and only the DONE block reports them
   in full.

Recorded decisions:

- Branch base → `hex/plan-ocx-theme-port` was cut from `feat/ocx-theme-port`
  (trunk + [`d2ddf51`](https://github.com/ocx-sh/catalog/commit/d2ddf51) from
  open [#12](https://github.com/ocx-sh/catalog/pull/12) + grim
  [`7e212b2`](https://github.com/ocx-sh/catalog/commit/7e212b2)), not bare
  trunk: the plan and ADR were written against that tree, and dropping
  `ownerUrl` routing would regress it. Once #12 merges, a rebase drops the
  duplicate.
- Branch topology → the plan's split (P0a/P0b to `main`, docs series as its
  own PR) collapses onto this one branch per I9's one-PR rule. Each of those
  sets stays a contiguous, self-contained commit run so the owner can still
  split it into separate PRs at landing.
- PR CI vs the local `file:` theme dep → npm cannot install a git
  subdirectory (ocx-website-83, 2026-10-07). Decision: option (3) — until
  theme `0.2.0` is on npm, theme-dependent CI jobs check out
  `ocx-sh/website` at a pinned 40-hex SHA, `pnpm pack` `packages/theme`, and
  npm-install that tarball over the `file:` dep. The step is temporary,
  marked as such, removed in the `^0.2.0` swap (plan step I.1), and follows
  the repo's workflow security rules (SHA-pinned `uses:`,
  `persist-credentials: false`, least privilege). Rejected: pnpm migration
  (repo is npm-only), switching CI jobs off (fails "CI green per job").

## Loop shape

- Entry point: Run the /hex-execute skill on .claude/state/plans/plan_ocx_theme_port.md.
- Refinement rounds: 2 — counts outer cycles: each review ⇄ execute
  pass is one, and so is every failed repair or retry cycle — a red
  gate's fix pass, an execute or finalize retry, a post-finalize CI fix ⇄
  re-finalize pass. Inner review-fix rounds do not count, and their limit
  is untouched.
  Past `2`, the DONE block reports every remaining criterion `not met`
  and the run stops.
- Ticks: /hex-loop commits nothing. The session creates or switches to
  the branch the pasted prompt's I9 names and commits this file first on
  it. A box is ticked only between hex-mode runs, never during one, and
  each tick is committed at once; every tick lands before the final
  /hex-finalize, none after it. The `(DONE block only)` criteria are
  evidenced only in the closing DONE block, never ticked.

## Rules

None.

## Emphasis

None.

## Context

- Source plan: [.claude/state/plans/plan_ocx_theme_port.md](../../.claude/state/plans/plan_ocx_theme_port.md)
- ADR (revision 1): [.claude/artifacts/adr_ocx_theme_port_2026-10-07.md](../../.claude/artifacts/adr_ocx_theme_port_2026-10-07.md)
- Research: [.claude/artifacts/research_ocx_theme_port_discovery.md](../../.claude/artifacts/research_ocx_theme_port_discovery.md),
  [.claude/artifacts/research_astro_programmatic_renderer.md](../../.claude/artifacts/research_astro_programmatic_renderer.md)
- Review round 1 triage: [.claude/state/plans/review_ocx_theme_port_round1.md](../../.claude/state/plans/review_ocx_theme_port_round1.md)
- Handover: [.agents/handover/ocx-theme-port.md](../handover/ocx-theme-port.md)
- Library: `/home/mherwig/dev/ocx-website/packages/theme`, owner session `ocx-website-*`, branch `feat/phase3-pilots` ([ocx-sh/website#11](https://github.com/ocx-sh/website/pull/11))
