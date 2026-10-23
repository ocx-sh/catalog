# Measurements — ocx theme port (P-gates G.5)

Measured 2026-10-08 on `hex/plan-ocx-theme-port--gates` (base `ee40be4`),
through the real CLI (`ocx-catalog build`) and the real probes in `scripts/`
(`quality-budget.mjs`, `quality-axe.mjs`, `quality-view-switch.mjs`,
`quality-interaction.mjs`, lhci). Chrome 155 via puppeteer-core 24.43.1,
390x844 mobile viewport, WSL2.

Theme under test: `@ocx-sh/theme` from `ocx-website` `73d3fa9` (the same change as `1505195` on another branch), which fixes
the Dialog eager start (below). The islands in this repo (`grid`, `palette`)
are wired to `@ocx-sh/theme/lazy`; their render/search halves load on first
interaction (`grid_session.ts`, `palette_session.ts`).

How it was measured: this worktree's `node_modules` is a symlink to the main
checkout's, and a site built with that as cwd can come out with no stylesheet
links. Every site was therefore built with the worktree's `dist/cli/index.js`
run with cwd = the main checkout (the real path of `node_modules`, as
`test/acceptance/cli.ts` does). All measured pages were checked to link an
`_astro/*.css`: 0 of 9 (fixture), 31 (root), 5 (README-heavy) and 254 (bulk)
pages lacked one.

## Page budgets (C-017)

Budget: HTML <= 14.2 KB gz, pre-input JS <= 11 KiB gz (11,264 B), DOM <= 800,
CLS 0. All gated pages pass; `quality-budget.mjs` exits 0, and its
`--red-demo` exits 0 (DOM bloat, eager script and late shift each reported).

| page | DOM | gz HTML | pre-input JS | provisional/final |
|---|---|---|---|---|
| grid N=24 (root fixture, 24 cards asserted) | 700 | 11,160 B (10.9 KiB) | 11,257 B (11.0 KiB), 15 scripts | final |
| grid 250 (bulk site, first 24 cards in the DOM) | 986 | 9,394 B (9.2 KiB) | 11,257 B (11.0 KiB), 15 scripts | final |
| fixture detail (`/sharkdp/bat/`) | 271 | 6,423 B (6.3 KiB) | 10,361 B (10.1 KiB), 14 scripts | final |
| README-heavy detail (3 synthetic 40 KB READMEs, reported, not gated) | 1,913 | 8,834 B (8.6 KiB) | 10,361 B (10.1 KiB), 14 scripts | final |
| README-heavy detail (real 43 KB README, earlier measurement, not re-run) | 1,675 | 22,482 B (22.0 KiB) | n/a | provisional: carried over, the probe's fixture is the synthetic one |

The landing pages sit 7 B under the pre-input JS budget (11,257 of 11,264 B).
Any change to the eager entry, the shell scripts or the theme's lazy
triggers will move it; the margin is not a design target.

Also measured on every page: CLS 0.000, and 0.000 with images blocked (no
element box moves); heap about 1.0 MiB after GC.

## Pre-input JS: history

Pre-input JS was 38 KiB before the split, 34.2 KiB with the theme defect and
is 11.0 KiB now.

- **Ours (`8038f8f`).** `grid.ts` and `palette.ts` carried their render and
  search halves in the eager entry. Splitting each into an entry and a
  `*_session.ts` loaded by `await import()` on first interaction saved about
  3 KB gz. `test/site/client/eager_entry.test.ts` fails if an entry statically
  imports its session, the filter or the catalog fetch.
- **Theirs, fixed (`ocx-website` `73d3fa9`).** `Dialog.astro` started the
  dialog machine at load when `[data-part="content"]:not([hidden])` matched
  anywhere inside it, including the palette listbox's own content part, which
  pulled about 23 KB gz of dialog, focus trap and combobox machine before any
  input. The four `quality-interaction.mjs` rows that carried a `knownGap`
  mark for it pass unmarked.

The font-preload layout shift seen earlier is gone (CLS 0), fixed on the
theme side by `18d40f0`; there is no workaround left for it.

## Interaction

- **First keystroke on the 250-package bulk landing, 4x CPU throttle:** the
  slowest `key*` event is 0 ms (worst interaction 24 ms, 20 events), against
  a 200 ms budget. The session chunk loads on focus, so
  the first character is typed into a live filter.
- **View switch at 252 packages, 4x CPU, median of 3:** cold first switch
  310 ms (budget 650), cards to table 143 ms (350), table to cards 160 ms
  (350), `?view=table` on arrival 507 ms (1,150). Budgets are about 2x the
  first measurement and are `provisional` until a CI runner has produced a
  few; tighten then.
- **First-interaction gates in Chrome (`quality-interaction.mjs`):** 116
  checks over the `root` and `catalog` (base `/catalog/`) fixture sites, exit
  0, no `XFAIL` row.

## Lighthouse and axe (G.3)

Mobile, throttled, 3 runs per URL, worst score of 27 runs over the 9 fixture
URLs: performance 0.99 (one run, `/contrib/mono/`; the other 26 are 1.00),
accessibility 1.00, best-practices 1.00, SEO 1.00. The performance floor
stays `minScore: 0.96`; the other three are pinned at 1. Bulk landing: accessibility, best-practices and SEO at 1,
`dom-size` <= 1,100, `total-blocking-time` <= 200 ms as errors; performance
is a warning there.

axe-core 4.13 (wcag2a, 2aa, 21aa, 22aa, best-practice) is clean on `/`,
`/sharkdp/bat/`, `/404.html` and the docs page, in light and dark, and on
`/` with the palette open. It was shown red by planting an image with no alt
and an empty button (`--red-demo`).

Red states seen: the Lighthouse accessibility floor failed on the real build
(target-size and label-in-name findings, fixed in `MetaRail.astro`,
`DocsSidebar.astro` and `Page.astro` in `9af5433`); the budget probe and axe
each have a `--red-demo` that plants violations and requires them reported
(a DOM bloat, an eager script and a late shift; an image with no alt and an
empty button). `scripts/quality-css-cascade.mjs` and its taskfile step are
deleted.

Every `task quality:web` step was run (same commands, sites built as
described above) and exits 0: lhci fixture and bulk, the 250-package build,
`quality-budget.mjs` and its `--red-demo`, `quality-axe.mjs` and its
`--red-demo`, `quality-view-switch.mjs`.

## Scale: 10,000 packages with READMEs vs E.7

The E.7 section of `research_astro_programmatic_renderer.md` was **re-run**
with the same generator input (`scripts/synthetic-index.mjs 10000 20`, one
unique 20 KB README each) through the real CLI under `/usr/bin/time -v`, once.

| | E.7 (2026-10-07, probe page) | now (full Astro pages, READMEs rendered in the CLI parent) |
|---|---|---|
| wall time | 7 min 13.8 s | 6 min 46.4 s |
| peak RSS, largest process | 1,438,292 KB (1.37 GiB) | 2,895,708 KB (2.76 GiB) |
| `index.html` files | 10,001 | 10,001 |
| output | 1.4 GB | 1.3 GB |
| exit | 0 | 0 |

Time is 6% faster. Peak RSS doubled and is the number to watch: E.7 rendered
READMEs in the Astro child, and `06f1d94` moved the sanitising render into the
CLI parent, so jsdom's footprint now sits in the parent. This run did not
sample the parent and the child separately, so which process peaks is not
established. 2.76 GiB is below the V8 default heap limit seen in E.7
(4,288 MB) and under the 4 GiB stop rule, but it exceeds a 2 GB CI runner. Re-sample per process (`VmHWM`, as E.7 did) before deciding
whether the parent needs recycling its jsdom window more often.

## OQ1 input: README payload vs the 14.2 KB budget

A real README (`commander`'s `Readme.md`, 43 KB raw) rendered to the detail
page gives 22,482 B gz of HTML against 14,200 B (measured before the theme
fix; DOM and HTML did not depend on it). The fixture detail page is
6,423 B, so that one README adds about 16 KB gz, which is 14.5 KB over the
budget. Three synthetic 40 KB READMEs compress to 8.6 KiB (repetitive text),
so the synthetic fixture understates the real cost; use real READMEs for any
future number.

The probe reports the README-heavy page and does not gate it. The fixture
detail page is gated and passes on HTML (6,423 B, 45% of budget). This is the
input for the Spec Delta: exclude the README payload from the detail-page HTML
budget, keep the budget strict on the fixture page, and report a README-heavy
page's number separately. Cost of the alternative: truncating at the 14.2 KB
line would cut about half of this README.

## Status of each number

| thing | state |
|---|---|
| DOM, gz HTML and pre-input JS, the four probe pages | final: theme `73d3fa9`, CSS present on every measured page |
| real-README detail row | provisional: carried over, not re-run |
| view-switch and INP budgets | provisional until a CI runner has produced runs |
| 10k RSS | single run, not split per process |

## Review re-measure of 2026-10-08: 10,000-package RSS split per process

Same generator input as the scale run above (`scripts/synthetic-index.mjs
10000 20`), through the real CLI, sampled per process. This answers the open
question in that section ("which process peaks") and replaces its single-run
RSS row.

| process / setting | peak RSS |
|---|---|
| CLI parent, no heap cap | 2.76 to 2.91 GiB (largest process) |
| CLI parent, no heap cap, forced-GC probe | about 1.15 GiB held |
| Astro child | 1.0 to 1.16 GiB |
| CLI parent, `NODE_OPTIONS=--max-old-space-size=1792` | 1.65 to 1.69 GiB, no heap error |

Reading: the parent is the largest process because it renders and sanitises
every README (`06f1d94`, jsdom). Most of its uncapped peak is uncollected
garbage, not live data: the forced-GC probe held it near 1.15 GiB. A heap cap
of 1792 MiB kept the parent under 1.7 GiB and the build finished without a
JavaScript heap error. `NODE_OPTIONS` reaches both processes, because the Astro
child inherits the environment.

Scope of the claim. "No flag needed" holds on hosts with about 7 GB of RAM or
more. Smaller hosts were not tested, and a 2 GB CI runner is not covered by any
of these runs. The published upgrade note says so.

The "10k RSS" row in the status table above predates this re-measure. It is
split per process here, so it is no longer a single run.
