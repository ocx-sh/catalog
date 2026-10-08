---
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/zizmor.yml"
---

# CI/CD Security Standards

This repo's whole CI/CD security surface is three workflow files —
`.github/workflows/ci.yml` and `.github/workflows/release.yml`, which build,
test, and publish an npm package, and `.github/workflows/pages.yml`, which
builds and checks the Starlight documentation site and, by manual dispatch only,
deploys the redirect stubs to GitHub Pages — plus one local composite action,
`.github/actions/install-ocx-theme` (temporary, see the last checklist item).
No SQL, no user-facing auth, no server. The checklist below is scoped to what
those files actually do; verify every claim against them (and
`.github/zizmor.yml`, `renovate.json`) before asserting it — this file is not
a generic OWASP checklist.

---

## Security Checklist (this repo's workflows)

- [ ] Every `uses:` step is SHA-pinned, with the human-readable tag as a trailing
      comment (`actions/checkout@3d3c...  # v7.0.1`) — matches `renovate.json`'s
      `pinDigests: true` for `github-actions`, which keeps the pin current.
- [ ] Top-level `permissions: {}` in every workflow; each job grants itself only
      what it needs (`contents: read` is the default; the `publish` job in
      `release.yml` additionally needs `id-token: write` for npm trusted
      publishing, and `pages.yml`'s manual `redirect-stubs` job needs `pages: write` +
      `id-token: write` for the Pages deployment). `pages.yml`'s `build` job
      holds `contents: read` only.
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
- [ ] `pages.yml` never publishes anything from a pull request or a push: the
      only deploying job, `redirect-stubs`, is gated on `workflow_dispatch` plus
      an explicit `handoff_done` input, so a fork PR can build the docs but can
      never deploy them.
- [ ] **No `file:` dependency reaches `main`.** The ocx theme is a `file:`
      dependency in the root and `docs/` manifests until `@ocx-sh/theme` 0.2.0
      is on npm, and a `file:` specifier (or a lockfile `resolved: file:…`)
      breaks every consumer install. The guard `scripts/check-no-file-deps.mjs`
      scans both `package.json` AND both lockfiles; `ci.yml` runs it on pull
      requests targeting `main`, and its unit test must stay red on a planted
      specifier in each file kind. `npm audit signatures` (`audit-signatures`)
      cannot verify a `file:` dependency, so the guard, not that job, is the
      control. Landing the real dependency swaps `file:` for `^0.2.0` in both
      manifests and regenerates BOTH lockfiles.
- [ ] A step that installs a dependency from another repository is marked
      `TEMPORARY` with the plan step that removes it, checks that repository
      out at a full 40-hex SHA with `persist-credentials: false` and a sparse
      checkout, and packs it with `--ignore-scripts`. Today that is the
      composite action `.github/actions/install-ocx-theme`, temporary until
      `@ocx-sh/theme` 0.2.0 is on npm (plan step I.1). It checks out
      `ocx-sh/website` at one pinned SHA (bump that one place and every caller
      follows), runs `npm pack --ignore-scripts` on `packages/theme`, points
      the `prefix` manifest's dependency at the tarball and runs `npm install`.
      That last `npm install` **does run lifecycle scripts** of every
      dependency, so every caller must hold `contents: read` only (no
      `id-token`, no `pages`), leaving any script nothing to mint. Callers: the
      `lint`, `typecheck`, `test`, `pack-verify`, `audit-signatures` and
      `web-quality` jobs of `ci.yml`, and `pages.yml`'s `build` job (with
      `prefix: docs`). All hold `contents: read` only; adding the action to a
      job with a wider grant, or to `release.yml`'s `publish` job, is a
      Block-tier finding. A change under the action's directory re-triggers
      `pages.yml` (both of its `paths:` lists name it). Bump the SHA
      deliberately; remove the action when the theme is on npm.

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

Per-package config, not a repo setting — the `release.yml` header comment is
the record of the bootstrap this depended on: reserve the `@ocx-sh` npm org,
publish `0.1.0` once manually with a short-lived automation token (deleted
right after), then register a Trusted Publisher. All of it is done, and
`0.1.1` published through the lane with a real attestation.

The publisher's scope is **org + repo + workflow filename + optional
environment** — npm's form has **no branch field**, so do not describe it as
scoped to a branch; any tag reaching this workflow can publish. This repo
registers no environment, matching a `publish` job that declares none: a
configured environment the job does not set rejects the OIDC exchange.
`--provenance` additionally needs the GitHub repo public at tag-push time, or
it silently attaches no attestation — a private-repo release still succeeds,
just unattested. Never "fix" a failing exchange by adding a stored npm token
— see the checklist above.

---

## Severity Classification

| Severity | Definition | Action |
|----------|------------|--------|
| Critical | Credential exposure, permission escalation, or a supply-chain write into a published artifact | MUST fix before merge |
| High | Missing SHA-pin, missing scoped `permissions:`, unpinned tool that produces a release artifact | MUST fix before merge |
| Medium | Undocumented zizmor exclusion, missing dry-run/auto-correction guard | SHOULD fix, can negotiate |
| Low | Style, redundant step, minor improvement | COULD fix, optional |

## Dependency Safety

- `renovate.json` groups routine npm minor/patch bumps and runs weekly lockfile
  maintenance. `astro` is held to a minor range (`~7.3` in the root manifest),
  and an `astro`/`@astrojs/*` bump merges only with the acceptance project green
  (`npm test` builds real sites); in `docs/`, `astro` and `@astrojs/starlight`
  move as ONE PR together with the matching `@ocx-sh/theme` release, because the
  theme's peer ranges bound them.
- `audit-signatures` (`ci.yml`) runs `npm audit signatures` on every PR —
  verifies each resolved dependency's registry signature against npm's public
  key, independent of `npm audit`'s vulnerability-database scan.
- Both CI and release run Node 24 / npm 11 (`engines.node` is `>=22.13`).

## Output Guidelines

- Never expose actual secrets in analysis output.
- Give specific file locations and line numbers.
- Include concrete remediation steps, not just the finding.
- Check workflow YAML and `.github/zizmor.yml` together — a finding "fixed" only
  in one usually isn't fixed.
