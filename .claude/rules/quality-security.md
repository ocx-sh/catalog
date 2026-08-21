---
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/zizmor.yml"
---

# CI/CD Security Standards

This repo's whole CI/CD security surface is two workflow files —
`.github/workflows/ci.yml` and `.github/workflows/release.yml` — that build,
test, and publish an npm package. No SQL, no user-facing auth, no server. The
checklist below is scoped to what those two files actually do; verify every
claim against them (and `.github/zizmor.yml`, `renovate.json`) before asserting
it — this file is not a generic OWASP checklist.

---

## Security Checklist (this repo's workflows)

- [ ] Every `uses:` step is SHA-pinned, with the human-readable tag as a trailing
      comment (`actions/checkout@3d3c...  # v7.0.1`) — matches `renovate.json`'s
      `pinDigests: true` for `github-actions`, which keeps the pin current.
- [ ] Top-level `permissions: {}` in every workflow; each job grants itself only
      what it needs (`contents: read` is the default across both files; the
      `publish` job in `release.yml` additionally needs `id-token: write` for
      npm trusted publishing — nothing else does).
- [ ] No `NODE_AUTH_TOKEN` / npm auth token secret exists anywhere in this repo.
      Publishing is OIDC-based (`id-token: write` exchanged for a short-lived npm
      credential at publish time) — adding a stored token back would be a live
      credential this workflow never needs to read.
- [ ] `npm ci --ignore-scripts` specifically in the `publish` job (`release.yml`),
      not `gate` — `publish` is the one job holding `id-token: write`, so a plain
      `npm ci` there would run every transitive dependency's install script with
      `ACTIONS_ID_TOKEN_REQUEST_URL`/`TOKEN` in its environment; a compromised
      dependency could mint the publish credential itself. `gate` keeps full
      install scripts (no `id-token`), so a dependency that genuinely needs one
      fails loudly there instead of silently in `publish`.
- [ ] No dependency cache (`cache: npm` on `actions/setup-node`) in the release
      lane — a restored cache is a supply-chain write into what gets published.
      `ci.yml` keeps its cache since it never publishes.
- [ ] Tools that themselves produce the published artifact are version-pinned,
      never `@latest` at run time — e.g. `npm install -g npm@11.9.0` in
      `release.yml` (needed for OIDC trusted-publishing support). Bump the pin
      deliberately; Renovate tracks it via the npm datasource.
- [ ] `npm publish --dry-run` runs before the real `npm publish` and fails hard
      (`exit 1`, not just a printed warning) if the output contains
      `"auto-corrected"` — catches npm silently stripping manifest fields (e.g.
      `bin`) before it can reach a real publish.
- [ ] `workflows-lint` (`ci.yml`) runs `zizmor --min-severity medium --config
      .github/zizmor.yml .github/` via `uvx` (no dependency added to the
      package's own graph for a CI-only tool).

---

## `.github/zizmor.yml` — documented exceptions only

Every rule exclusion in this file must carry a comment explaining *why* the
finding is a false positive or already mitigated, not just that it's noisy.
The current entry (`cache-poisoning` ignored for `release.yml`) documents that
the actual mitigation — no `cache:` input on either `setup-node` step in that
file — is already applied, and that zizmor still flags it because
`actions/setup-node@v7` caches by default with no opt-out input exposed.
A new exclusion added without equivalent reasoning is a **Block-tier** finding
in review: it hides a real gap rather than an already-mitigated one.

---

## npm Trusted Publishing (OIDC)

Per-package config, not a repo setting — the `release.yml` header comment
enumerates the manual bootstrap this depends on: reserve the `@ocx-sh` npm org,
publish `0.1.0` once manually with a short-lived automation token (deleted right
after), then register a Trusted Publisher scoped to this exact repo, this exact
workflow file, and the intended branch. `--provenance` additionally needs the
GitHub repo to be public at tag-push time, or it silently attaches no
attestation. None of this makes the workflow file itself invalid before the
bootstrap is done — it's simply inert until a `v*` tag exists to trigger it and
a Trusted Publisher exists to authenticate it. Don't "fix" the inert state by
adding a stored token — see the checklist above.

---

## Severity Classification

| Severity | Definition | Action |
|----------|------------|--------|
| Critical | Credential exposure, permission escalation, or a supply-chain write into a published artifact | MUST fix before merge |
| High | Missing SHA-pin, missing scoped `permissions:`, unpinned tool that produces a release artifact | MUST fix before merge |
| Medium | Undocumented zizmor exclusion, missing dry-run/auto-correction guard | SHOULD fix, can negotiate |
| Low | Style, redundant step, minor improvement | COULD fix, optional |

## Dependency Safety

- `renovate.json` groups routine npm minor/patch bumps, keeps `vitepress`/`vue`
  (alpha-channel, version-locked to each other) as separate manual-review PRs,
  and runs weekly lockfile maintenance.
- `audit-signatures` (`ci.yml`) runs `npm audit signatures` on every PR —
  verifies each resolved dependency's registry signature against npm's public
  key, independent of `npm audit`'s vulnerability-database scan.

## Output Guidelines

- Never expose actual secrets in analysis output.
- Give specific file locations and line numbers.
- Include concrete remediation steps, not just the finding.
- Check workflow YAML and `.github/zizmor.yml` together — a finding "fixed" only
  in one usually isn't fixed.
