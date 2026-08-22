# Research: Initial-status review — @ocx-sh/catalog @ 03cda12

Whole-repo hex-review, tier high. 8 reviewer panels + 2 recons. Feeds the
SOTA/quality/tooling improvement round. Verdict: **Request Changes** (Block-tier
findings present; all trivially fixable or test-quality). No runtime Block.

RCA — four systemic roots (each spawns a work cluster):

- **R1 Doc/state drift.** Repo published + got a remote faster than its docs;
  no doc-sync gate. AGENTS.md/product-context.md/release.yml all say
  "unpublished, no remote, commit to main". (spec Block×3, docs High)
- **R2 Genesis-as-index baked into the theme.** Theme authored against the
  reference consumer index.ocx.sh, not the "renders ANY index/mirror" contract:
  hardcoded `ocx.sh/` install prefix (→ wrong uninstallable command on a
  corporate mirror), hardcoded org links, index-specific docs nav. (arch High×1
  + Warn×2)
- **R3 Buffer-everything + unbounded fan-out.** Back-pressure discipline
  (walker.ts Semaphore) applied nowhere else: whole index in RAM across the
  VitePress build (~2.7 GB @5k pkgs), root double-copy (68% of dist), unbounded
  page-write Promise.all (EMFILE @5k), serial mirror writes. Fast at 124 pkgs
  (7.65 s build); ceiling ~4-5k. (perf High×1 + Warn×3, arch Warn×2)
- **R4 Web quality never gated.** 100% unit coverage created false confidence —
  it measures code execution, not rendered-output quality or assertion strength.
  No a11y/SEO/perf budget; several vacuous-green tests. The goal's
  "non-trivial quality like lighthouse" targets this root. (sota Warn cluster,
  tests Block×2)

## Consolidated findings (max-wins severity, deduped across reviewers)

### Block / near-Block
- Stale project state across AGENTS.md:31-35,90-91,139 + product-context.md:86-91
  (always-loaded) + release.yml:1-34 header + CHANGELOG (0.1.1 "published" —
  UNVERIFIED, CI publish failed on missing trusted publisher). → R1
- Hardcoded `ocx.sh/` brand prefix, 5 theme components (PackageCard.vue:33,
  PackageTable.vue:25, InstallRow.vue:18, IdentityBlock.vue:28,
  CopyContextMenu.vue:50) → corporate mirror emits wrong `ocx add ocx.sh/...`.
  `pkg.name` already carries the real prefix. → R2
- Vacuous test: css_order.test.ts:81 never asserts themeIdx>-1 (the ONLY backing
  for src/theme/index.mts coverage exclusion). → R4
- Lexical-only XSS test readme_pane_wiring.test.ts:20 — never asserts sanitized
  output reaches DOM; mount + `<script>` payload needed. → R4

### High
- walker.ts:382-395 collectCasRefs raw TypeError on absent tags/desc — caught to
  exit 65 but names no file (diagnostic gap vs types.ts validateRootShape). +test
- path.ts:137-159 walkTree no visited-realpath set → verified unbounded build
  hang from a hostile symlink DAG (path+git sources). Thread a Set.
- mirror.ts:109-115 same-origin untrusted mirrored content; sole control is the
  Cloudflare-only `_headers` CSP sandbox — inert in dev + GH Pages/S3/nginx,
  unchecked. Restrict p/ walk to wire extensions + document header as hard
  precondition.
- config_gen.ts:301 dead `descLookup` in siteData — 80% of every-page metadata
  chunk, +170 B/pkg, zero runtime consumer. Delete one line.
- pages.ts:134-142 unbounded Promise.all page writes → EMFILE @5k. Bound w/
  Semaphore.
- Layout.vue:5-14 no route split — grid ships the whole detail subsystem (62% of
  theme source unreachable from grid). defineAsyncComponent.
- config_gen.ts:305-320 detail pages SSR no content + preload no data → 3
  sequential RTTs to first paint. Preload /p/<key>.json.
- UX: whole-package `status:'yanked'` invisible everywhere (card/table/detail/
  banner/filter). Extend deprecated pattern.
- UX: useCatalog.ts:50-69 every fetch failure → EMPTY_CATALOG → "no packages
  yet" (5xx/malformed indistinguishable from 404). Add error state.
- SOTA: catalog toolbar keyboard-unreachable (deliberate tabindex=-1,
  FilterChips/CatalogPage/SearchInput/ResultMeta/InstallRow) — WCAG 2.1.1 A.
  CONFLICTS with owner spec #44 (CatalogPage.vue:92); reconcile toward
  operability (required for the quality gate).
- SOTA: no canonical URL (cleanUrls:true guarantees dupes); landing page no
  <h1>; provenance descriptors fetched then DISCARDED (catalog.ts:239); no
  license/source-repo link (check OCI annotations in real index data first).

### Warn (grouped)
- Perf: mirror serial writes (2.6x slower), root double-copy 2x disk, dompurify
  static in entry chunk, build RSS slope, Logo SVG inlined into every page (56%
  of all HTML), per-page <title> never set (126/143 = "OCX Index"), no CAS size
  cap (238 KB SVG for a 34px tile), 39 dead .woff files, no font preload.
- Sec: superseded_by protocol-relative href (DeprecationBanner.vue:20),
  nav[].link javascript: (fork-PR reachable via generated CI), c/index.json no
  entry cap.
- Arch: 3 reverse layer edges (build→cli/out_dir; sources→viewmodel for
  DIGEST_RE/assertSafePackagePath + catalogIndex/serializeCatalog), hardcoded
  org links (footer/empty-state), static index-specific docs nav.
- Tests: golden corpus single-package only (no multi/empty), orphan-worker
  vacuous assert (pgrep→[] passes), CI-invariants never mutation-tested (unchecked
  green on security-critical output), no YAML-parse of rendered CI.
- SOTA a11y/SEO: no skip link, no grid list semantics, filter count not announced,
  nested-interactive sort control (axe WILL flag), skeletons not aria-hidden, no
  og:image, no robots.txt, no color-scheme, no RSS (site-wide derivable).
- Docs: CHANGELOG no link refs / no [Unreleased]; README missing node floor,
  --out default, configVersion; schema descriptions absent for sources/brand/
  nav/ci; 6 rule-drift items (DIGEST_RE char class, realpath attribution,
  satisfies example, theme-token claim, tests caller count, plan paths).

## Recommended quality-gate stack (rev-sota)
`@lhci/cli@0.15.1` staticDistDir mode, `lighthouse:no-pwa` preset, reuses the
ubuntu-24.04 runner's preinstalled Chrome (no browser download). perf=warn,
a11y/best-practices/seo=error. Thresholds MEASURED-then-ratcheted, proven red by
regression (unchecked-green rule). `lycheeverse/lychee-action` only if
link-check wanted (we run lychee via ocx/task instead). Rejected:
playwright+axe (heavy, overlaps), unlighthouse (needs served site), vitest-axe
(stalled, happy-dom-incompatible).

## Deferred / owner's-call (out of this round)
- root:true double-copy policy (legacy-compat for index.ocx.sh deploy shape).
- serializeCatalog byte-parity gate vs product-context "free to evolve"
  (ADR-worthy: catalog-at-scale — RAM + sharding + parity, one ADR).
- 4-way version-grammar port (Rust→Python→TS×2), eslint boundary.
- theme extension seam (needs a real 2nd consumer).
- multi-source non-root detail pages (wireBase unread — known 0.1.0 limitation).
- dependency/dependents, SBOM, version-diff, download counts (upstream/non-goal).
- --smoke assertion depth (plan WP-14, owner-deferred).

## Tooling target (recon of ocx-sdk-python)
ocx.toml pins task/git-cliff/actionlint/lychee/gitleaks; ocx.lock per-platform
digests. CI: `setup-ocx@25fa771f8572572dc64528db89560de68a163a0e # v1` then every
step `ocx run -- task <name>`. taskfile: default→verify; verify chain;
lint:actions/lint:links/secrets; changelog/changelog:preview; release:prepare
(BUMP enum auto|patch|minor|major, VERSION pin, git-cliff --bumped-version,
bump manifest, regen CHANGELOG, run verify, print manual commit/tag/push).
cliff.toml: conventional, tag_pattern v[0-9].*, initial_tag v0.1.0,
features_always_bump_minor, breaking NOT major (pre-1.0). No marketplace actions
for the four tools — all via ocx-provisioned binaries in task targets.
Test data: ../index = 124 pkgs / 1997 CAS objects; root config.json absent by
design (bot-rendered).
