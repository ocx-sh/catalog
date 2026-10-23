# Integration — ocx theme port (plan step I.1)

Branch `hex/plan-ocx-theme-port` at `ec26fa6`, 2026-10-08. Reads: the plan's
P-final, C-048, C-049, the ADR, `measurements_ocx_theme_port.md`,
`migration_ocx_sh_index_0.6.md`.

## 1. Results

| # | Command | Outcome |
|---|---|---|
| 1 | `task verify` (run by the orchestrator, not re-run here) | green at `ec26fa6`: 136 files / 1933 tests; re-run green at `23b12cd` code (docs index fix; later commits are docs-only): 136 files / 1942 tests, coverage 100/100/100/100, pack-smoke OK |
| 2 | `CHROME_PATH=<puppeteer chrome 155> task quality:web` | exit 0, 6m24s. Budget probe, axe, view-switch and Lighthouse all pass; every red-demo goes red |
| 2a | Lighthouse, 9 URLs x 3 runs (fixture site) | worst across the 27 runs: performance 99, accessibility 100, best-practices 100, SEO 100. `lhci` assertions passed |
| 2b | Lighthouse, bulk 250 landing x 3 | 100 / 100 / 100 / 100 |
| 2c | Budget probe (mobile 390x844) | grid N=24: DOM 700, HTML 10.9 KiB gz, JS 11.0 KiB gz, CLS 0. Fixture detail: DOM 271, HTML 6.3 KiB, JS 10.1 KiB. Grid 250: DOM 986, 24 cards. INP 16 ms (worst 24 ms, budget 200) |
| 2d | axe | clean on `/`, `/sharkdp/bat/`, `/404.html`, a docs page and the open palette, light and dark |
| 2e | view-switch at 252 packages, 4x CPU | first switch 320 ms (650), cards to table 158 (350), table to cards 160 (350), table URL on arrival 530 (1150) |
| 3 | `node dist/cli/index.js build --config ../index/catalog.config.json --out $SCRATCH/index-render` | exit 0, 143 pages in 1.8 s. No config change needed for the build (see 3a) |
| 3a | `git -C ../index status --porcelain` before and after | identical (one pre-existing ` M bot-tools/pyproject.toml`); nothing written under `../index` |
| 4 | `task dev:indexes` then `task dev:catalog CASE=multi-root` | seeded 9 trees, `../index` untouched. Dev server up in about 4 s: `/` 200, `/acme/gadget/` 200, `/acme/gadget` (no slash) 404. SIGINT left no child process. Visual comparison is the owner's |
| 5 | `rg -n "R9-SKIP" test` | empty (exit 1). Request 9 does not block 0.6.0 |
| 6 | `rg -n '"file:' package.json docs/package.json package-lock.json docs/package-lock.json` | exactly 4 hits: `package.json:58`, `package-lock.json:14`, `docs/package.json:14`, `docs/package-lock.json:11`; all `@ocx-sh/theme` at `file:/home/mherwig/dev/ocx-website/packages/theme` |

### 3a. Render against the live index (read-only GETs of `index.ocx.sh`)

The `../index` checkout is `9eba2cc` (2026-08-27) and behind live, so package
counts differ by data, not by the port.

| Aspect | Live (VitePress, older catalog) | Port render | Verdict |
|---|---|---|---|
| Packages in `catalog.json` | 131 | 125 | expected: live has 6 newer packages (`adoptium/temurin`, `anchore/grant`, `asciinema/agg`, `asciinema/asciinema`, `herdrdev/herdr`, `project-zot/zot`); the port has none live lacks |
| `catalog.json` keys | `generated`, `indexes`, `packages` | same; per-package keys identical | expected |
| `indexes[0]` | `{name, root, count}` | adds `default`, `excludeFromAll` | expected: from 0.5.x (`dff888a`, 2026-09-29), not the port |
| Package page route | `/sharkdp/bat` 200; `/sharkdp/bat/` 308 to no-slash; canonical no-slash | `/sharkdp/bat/index.html`; canonical `/sharkdp/bat/` | expected: new URL shape per ADR (OQ3), redirect map in the migration notes |
| Pages checked | `/`, `/sharkdp/bat`, `/astral-sh/uv`, `/jqlang/jq` all 200 | all three exist as `<ns>/<pkg>/index.html` | expected |
| Sitemap | 150 URLs: `/`, `/404`, 131 packages, 17 docs | 143 URLs: `/`, 125 packages, 17 docs; no `/404` | expected: 404 no longer listed |
| Docs section landings | `/docs`, `/docs/{explanation,how-to,ops,reference}` | `/docs/index/`, `/docs/<section>/index/` at 8178851 | regression vs 0.5.3; fixed in 23b12cd (`index.md` → `/docs/`, `/docs/<section>/`) |
| `/docs/privacy` | 200 | `/docs/privacy/` | expected (trailing slash) |
| Wire files `/p/<ns>/<pkg>.json` | served, `content-security-policy: sandbox` on Cloudflare | byte-identical to the source tree (`cmp` on `sharkdp/bat.json`) | expected; live bytes differ only because live data is newer |
| `_headers` | Cloudflare | `/p/*` and `/index/ocx.sh/p/*` carry sandbox + nosniff | expected (inert on Bunny, see C-049) |
| Generator | `VitePress v2.0.0-alpha.19` | Astro | expected |

Config cross-check against `migration_ocx_sh_index_0.6.md`: the index's
`catalog.config.json` (`$schema` into `node_modules`, `publicDir`, `docs`,
`ci.packageManager: "bun"`) builds unchanged. Everything the 0.6 move changes
is outside that file: `package.json` (drop `vitepress`/`vue`, `^0.6`),
`bun.lock`, `--out` and `site:preview`, the golden manifest, the 16 docs pages'
VitePress-isms, and the Node >= 22.13 runner requirement. The package ships
`src/config/schema`, so the `$schema` path still resolves.

## 2. Theme `v0.2.0` landing checklist

Do these in order the day `@ocx-sh/theme@0.2.0` is on npm.

1. Docs PR first: it is the first consumer and proves the tarball.
2. In `package.json` and `docs/package.json` swap `file:/home/mherwig/dev/ocx-website/packages/theme` for `^0.2.0`.
3. Regenerate BOTH `package-lock.json` and `docs/package-lock.json` from clean installs (`rm -rf node_modules`, `npm install`; same under `docs/`). A lock edited by hand keeps the `file:` resolution.
4. Delete `.github/actions/install-ocx-theme/` and its `uses:` in `.github/workflows/ci.yml` and `pages.yml`. Update `test/ci_workflow.test.ts`, which reads the action file.
5. Remove the `.ocx-theme-src` ignores in `.gitignore`, `eslint.config.js` (line 31) and `vitest.config.ts` (lines 7, 22).
6. `task check:no-file-deps` must go green (it is the guard; it fails today by design while the 4 entries exist).
7. Run `task verify`, `task quality:web`, the acceptance suite and `task docs:build` on the clean installs, then the tarball gates (`task pack-smoke`).
8. Only then merge; `ci.yml` currently builds the theme from `ocx-website` `9543500` (`origin/feat/phase3-pilots`), which goes away with step 4.

## 3. Owner hand-off

### Landing order

SHAs verified against `git log` on this branch (all present).

| Step | What | Commits |
|---|---|---|
| 1 | P0a, main-landable alone | `9dcb951..2239639` (`9dcb951`, `944cc60`, `2239639`) |
| 2 | P0b, main-landable alone | `906c4f7..dc1f149` (`906c4f7`, `bdd8b90`, `8d30984`, `dc1f149`) |
| 3 | Docs series, needs theme `v0.2.0` on npm first | `3a5391e..f78be5f` (8 commits, scaffold to lock) |
| 4 | The rest: engine, site, dev, purge, pack, gates, rules, this artifact | everything after `f78be5f` up to the tip |

Commits `667c2e9` (lint ignore) and the agent-config commits between the
ranges are not in any series; they ride with the step that follows them.
Steps 1-2 cherry-pick or PR from the branch. 0.6.0 stays unreleased until
steps 3-4, theme `v0.2.0`, and the C-049 probe.

### Actions

| Item | Owner action |
|---|---|
| C-049 Bunny probe | Before `ocx.sh/catalog/` serves 0.6.0: `curl -sI https://ocx.sh/catalog/p/<ns>/<pkg>.json` and `…/catalog/index/<label>/p/…` must show `content-security-policy: sandbox` and `x-content-type-options: nosniff`. Needs the website-owned `catalog-sandbox` edge rule. `_headers` is inert on Bunny |
| C-048 docs host move | After `ocx.sh/apps/catalog/` serves the docs, dispatch the `redirect-stubs` job in `pages.yml` (manual; deploys meta-refresh stubs for every old `ocx-sh.github.io/catalog/<page>/`). Then switch `README.md`'s docs pointer to the new host |
| `ocx-sh/index` 0.6 migration | Follow `.claude/artifacts/migration_ocx_sh_index_0.6.md`: manifests, `bun.lock`, `--out`, `site:preview`, golden manifest regeneration, redirect map for `/<ns>/<pkg>` to `/<ns>/<pkg>/`, Node >= 22.13 on the runner |
| OQ1 Spec Delta sign-off | The README-heavy detail page is over the 14.2 KB gz HTML budget: real 43 KB `commander` README gives 22,482 B gz (about 14.5 KB over; fixture detail 6,423 B). The probe reports it and does not gate it (3 synthetic 40 KB READMEs: 8.6 KiB, which understates real text). Sign off: exclude README payload from the detail HTML budget, keep it strict on the fixture page |
| Visual comparison | Owner's: `task dev:catalog CASE=multi-root` against live `index.ocx.sh`. Only HTTP status was checked here |

### Deferred items

| Item | Where |
|---|---|
| S-012 wording: a git source failure exits 65, the scenario says 69 | CLI error mapping, plan S-012 |
| Docs-mount links are not rewritten (the `index.md` routing gap is fixed in 23b12cd) | docs mount |
| Sätteri ignores `{#id}` heading ids (see migration notes, heading ids) | README and docs rendering |
| `ci` bun variant installs bun only, no `setup-node`; a runner without Node >= 22.13 fails | `src/ci/render.ts:60` |
| Bunny trailing-slash redirect (`/x` to `/x/`) is unverified; dev already 404s on `/acme/gadget` without the slash | C-049 probe, add the redirect check |
| Stale VitePress/Vue wording in comments | `src/sources/walker.ts:40`, `src/build/sources_pipeline.ts:45,64,426`, `src/site/lib/{installFlavors,cas,platforms,osGlyphs,copyActions,monogram,readmeMarkdown}.ts` |
| The R.5 dead-glob `awk` only checks the first glob under each `paths:` | plan R.5 check |
| CI theme pin is `ocx-website` `9543500` (`origin/feat/phase3-pilots`), temporary | `.github/actions/install-ocx-theme/action.yml:26` |
| Lighthouse: one of 27 fixture runs scored performance 99 (gate passes on the aggregate) | `quality:web`; watch on CI runners |
