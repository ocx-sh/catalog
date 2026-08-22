# ADR: Task-orchestrated tooling, ocx dogfooding, and a web quality gate

- Status: accepted (autonomous plan round, 2026-08-22)
- Deciders: owner (async), meta-orchestrator
- Context input: `research_initial_review_2026-08-22.md`, recon of
  `ocx-sdk-python`, live data check of `ocx-sh/index`.

## Decision 1 — One command surface: `task`, provisioned by `ocx`

Adopt the `ocx-sdk-python` pattern verbatim in shape: a root `taskfile.yml` is
the single entry point for every dev/CI action; `ocx.toml` + `ocx.lock` pin the
CLI tools (`task`, `git-cliff`, `actionlint`, `lychee`, `gitleaks`); CI installs
`ocx` via `setup-ocx@25fa771f…  # v1` then runs **every** step as
`ocx run -- task <name>`. Node/npm themselves stay on `actions/setup-node`
(they are the package's own toolchain, not an ocx-provisioned CLI).

- **Options weighed:** (a) keep npm scripts + marketplace actions for the four
  tools; (b) hybrid (task locally, raw commands in CI); (c) full task+ocx.
- **Chosen (c)** — the goal mandates identical local/CI invocation and ocx
  dogfooding; (a) drifts local vs CI, (b) keeps two definitions of each check.
- **Cost:** one new innovation token (task) — bounded, already proven in the
  sibling repo; `ocx.lock` per-platform digests are the supply-chain control.
- **Invariant preserved:** the OIDC release lane (`release.yml`) keeps its
  substance — SHA-pins, `permissions:` scoping, `--ignore-scripts` publish,
  no stored token. Task-routing wraps the existing steps; it does not relax
  them. `release:prepare` is a *local* task (git-cliff bump + changelog +
  verify), never the publish itself.

## Decision 2 — Web quality gate: Lighthouse CI over a committed fixture index

Add `@lhci/cli@0.15.1` in `staticDistDir` mode, `lighthouse:no-pwa` preset,
run through `task quality:web` identically locally and in CI, against a site
built over a **self-contained committed fixture index** under
`test/fixtures/quality-index/` — never `../index` (absent in CI).

- **Options weighed:** (a) lhci staticDistDir; (b) Playwright + axe-core;
  (c) Unlighthouse; (d) pa11y-ci.
- **Chosen (a)** — reuses the ubuntu-24.04 runner's preinstalled Chrome (no
  browser download), gates performance/a11y/best-practices/SEO in one tool.
  (b) is 300–500 MB and overlaps lhci's a11y category; (c) needs a served,
  crawled site; (d) is a11y-only.
- **Threshold discipline (binding — repo's unchecked-green rule):** measure the
  built fixture site first, set each assertion just below the observed score,
  then PROVE the gate reds by a deliberate regression before it lands. A
  threshold never seen fail is not a gate. `a11y`/`best-practices`/`seo` =
  `error`, `performance` = `warn` (SSG perf is dominated by content weight the
  gate should observe, not block on).
- **Fixture rationale:** a ~6–10 package hand-authored wire tree exercises grid
  + detail + docs + a yanked + a deprecated + a multi-platform package + a
  license/source-bearing package — enough to score every audit lhci runs,
  small enough to commit and rebuild in seconds.

## Decision 3 — Keyboard operability supersedes owner spec #44 for the toolbar

`CatalogPage.vue:92` records a deliberate owner decision (spec #44, reaffirmed
2026-08-05): Tab reaches only search → cards; every toolbar control carries
`tabindex="-1"`. This is a **WCAG 2.1.1 (A)** failure: platform/keyword
filtering, sort, and view switching become mouse-only, and the Lighthouse a11y
gate (Decision 2) cannot pass with it in place.

- **Decision:** restore natural keyboard operability of the toolbar controls.
  Spec #44 is **superseded for interactive toolbar controls**; it may still
  govern non-interactive/roving concerns.
- **Reversibility:** two-way — a recorded product decision the owner can
  reinstate. This ADR is the record of the override and its reason (Level-A
  conformance + the quality gate the owner asked for). If the owner rejects it,
  the fallback is a roving-tabindex path that keeps a single tab-stop but makes
  every control reachable via arrow keys — still Level-A, closer to #44's
  intent — at higher implementation cost.
- Flagged in the handoff as a **deferred owner-judgment item**, not silently
  applied.

## Decision 4 — License / source surfaced from OCI annotations (renderer-only)

Real index data carries `org.opencontainers.image.{licenses,source,revision}`
on the CAS image-index manifests and `repository` on every package root. Read
and display them — a pure renderer change, no new wire field, no index write.
Full signature-verification provenance (sigstore, build-time) stays **deferred**
(bigger, and the descriptors are only *discarded* today, not a regression to
surface now).

## Consequences

- Scale ceilings (build RAM, root double-copy, catalog.json sharding, the
  serializeCatalog byte-parity gate) are **out of scope** here and belong in a
  later "catalog at scale" ADR — recorded, not fixed, because no consumer is
  near the ceiling (fast at 124 pkgs: 7.65 s build).
- The version-grammar four-way port and the theme-extension seam remain
  deferred pending a second real consumer.
