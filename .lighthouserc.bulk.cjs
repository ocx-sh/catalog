/**
 * Lighthouse CI config for the CORPORATE-SIZE run of `task quality:web`.
 * Consumed out-of-process by the `@lhci/cli` binary, like `.lighthouserc.cjs`
 * beside it (hence the same `vitest.config.ts` coverage exclusion).
 *
 * `scripts/quality-site.mjs` clones `test/fixtures/quality-index/` up to 250
 * packages in a scratch copy and builds it into `.lhci-bulk/`; this audits the
 * result.
 *
 * ## Why the landing page only
 *
 * It is the only page whose cost moves with catalog size — a detail page
 * renders one package whether the index holds six or six hundred, and the
 * fixture run beside this one already audits every one of those. Auditing 250
 * identical detail pages would cost minutes and measure nothing new, so the
 * URL is listed explicitly rather than left to autodiscovery.
 *
 * ## Thresholds
 *
 * Measured medians of the bulk landing page, then dropped by a >=0.03 margin
 * so ordinary run-to-run variance never reds the build while a real
 * regression still does — the same discipline, and the same re-measure rule,
 * as `.lighthouserc.cjs`. The three non-performance categories are held at
 * their fixture-run levels so a size-dependent regression in any of them
 * still reds.
 *
 *   category         bulk median   threshold
 *   accessibility    1.00          0.97   error
 *   best-practices   1.00          0.93   error
 *   seo              1.00          0.97   error
 *   performance      0.93          0.90   warn
 *
 * Both numbers this gate moved are the reason it exists — at 250 packages
 * and before the two rendering bounds, this page scored 0.74 performance
 * (950ms total blocking time, 7,579 DOM elements) and 0.96 accessibility
 * (122 monogram tiles failing contrast on two hues the six-package fixture
 * never draws). It now medians 0.93 and 1.00: 110ms blocking, 1,688
 * elements. The fixture run scores a flat 1.00 in all four categories
 * throughout and saw none of it.
 *
 * ## Why the performance SCORE is a warn and the two bounds are the errors
 *
 * The score is a timing-derived aggregate, and a shared GitHub runner moves
 * it more than any margin measured elsewhere allows for: the first main run
 * after the bounds landed scored 0.89 three times in a row against the 0.90
 * error and went red on a page that had regressed nothing
 * (https://github.com/ocx-sh/catalog/actions/runs/34779144840). So the gate
 * asserts the two quantities the bounds actually changed, each with a margin
 * a real regression clears and runner noise does not:
 *
 *   audit                  bounded   pre-bounds   threshold
 *   dom-size               1,688     7,579        3000   error  (deterministic)
 *   total-blocking-time    110ms     950ms        500ms  error
 *
 * `dom-size` is an element count — the same on every machine — and catches
 * either rendering bound coming loose. `total-blocking-time` is the one
 * timing that the size actually drives, held at ~5x its bounded value and
 * half its pre-bounds one. The score stays visible as a warn.
 */
module.exports = {
  ci: {
    collect: {
      staticDistDir: '.lhci-bulk',
      url: ['http://localhost/index.html'],
      numberOfRuns: 3,
      settings: {
        chromePath: process.env.CHROME_PATH || undefined,
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.97 }],
        'categories:best-practices': ['error', { minScore: 0.93 }],
        'categories:seo': ['error', { minScore: 0.97 }],
        'categories:performance': ['warn', { minScore: 0.9 }],
        'dom-size': ['error', { maxNumericValue: 3000 }],
        'total-blocking-time': ['error', { maxNumericValue: 500 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci-bulk' },
  },
};
