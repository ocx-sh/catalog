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
 * It is the only page whose cost could move with catalog size — a detail page
 * renders one package whether the index holds six or six hundred, and the
 * fixture run beside this one already audits every one of those. Auditing 250
 * identical detail pages would cost minutes and measure nothing new, so the
 * URL is listed explicitly rather than left to autodiscovery.
 *
 * ## Floors
 *
 * The landing page ships a fixed window of 24 server-rendered cards whatever
 * the catalog size, so the bulk page should score like the fixture one. Measured
 * on the Astro output (Chrome 155, 3 runs, 250 packages), medians:
 *
 *   category         measured     floor
 *   accessibility    100          1.00   error
 *   best-practices   100          1.00   error
 *   seo              100          1.00   error
 *   performance      99-100       1.00   warn
 *
 *   audit                  measured    floor
 *   dom-size               986         1100   error  (deterministic)
 *   total-blocking-time    0 ms        200 ms error
 *
 * The performance SCORE is a timing aggregate that a shared GitHub runner moves
 * more than any margin allows for (the VitePress-era gate went red on a page
 * that had regressed nothing:
 * https://github.com/ocx-sh/catalog/actions/runs/34779144840), so it stays a
 * visible warn and the two quantities that the window bounds actually pin are
 * the errors:
 *
 *   `dom-size` is an element count, the same on every machine; 986 is 24 cards
 *   of the fixture's richest card shape plus the chrome, and it must not grow
 *   with the catalog (the pre-window, pre-bounds page had 7,579 elements at
 *   250 packages).
 *
 *   `total-blocking-time` is the one timing the catalog size drives: nothing
 *   builds before input, so it measures 0 ms; 200 ms is Lighthouse's own
 *   "good" threshold.
 *
 * Every floor was shown red once by planting its regression into a copy of the
 * built site; see the G.3 report.
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
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 1 }],
        'categories:seo': ['error', { minScore: 1 }],
        'categories:performance': ['warn', { minScore: 1 }],
        'dom-size': ['error', { maxNumericValue: 1100 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci-bulk' },
  },
};
