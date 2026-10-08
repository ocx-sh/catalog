/**
 * Lighthouse CI config for `task quality:web` (C-017). Consumed OUT-OF-PROCESS
 * by the `@lhci/cli` binary — never imported into the vitest process (hence its
 * `vitest.config.ts` coverage exclusion). `task quality:web` builds the
 * committed fixture index at `test/fixtures/quality-index/` into `.lhci-site/`,
 * and lhci audits every emitted page (the landing page, the 404 and one detail
 * page per fixture package) on the default mobile preset.
 *
 * ## Floors: the theme's bar, then a margin only where a timing needs one
 *
 * The target is 100 in all four categories on every content-class page, which
 * is what `@ocx-sh/theme`'s own gate holds (`ocx-theme-quality`). Measured on
 * the Astro output (Chrome 155, 3 runs/page, all 9 pages), the median of every
 * page is:
 *
 *   category         measured median       floor
 *   accessibility    100 (every page)      1.00   error
 *   best-practices   100 (every page)      1.00   error
 *   seo              100 (every page)      1.00   error
 *   performance      99-100                0.96   error
 *
 * The three deterministic categories hold the literal maximum: they are
 * counts of failing audits, not timings, so a margin would only hide a
 * regression. Performance is a timing aggregate, so it keeps a 0.03 margin
 * below the measured floor for run-to-run variance. The theme's Dialog
 * start-up fix has landed (ocx-website 73d3fa9; no palette dialog machine
 * loads before input any more), and the latest run scores 1.00 on 26 of 27
 * runs, one run on `/contrib/mono/` at 0.99 (see the measurement report): the
 * floor stays at 0.96 until a CI runner has produced a few more runs.
 *
 * Re-measure when the theme or the fixture changes; never lower a floor to
 * make a regression pass. The medians come from the headless Chrome that
 * `task quality:web` selects (see that task and
 * `scripts/lhci-posix-tmpdir.cjs`); a different browser build shifts them.
 *
 * Every floor was shown red once, by planting its regression into a copy of the
 * built site: an image without `alt` and an unlabelled button (accessibility),
 * an inline script the CSP refuses, which logs a console error
 * (best-practices), a removed `<title>` and `meta description` (seo), and a
 * blocking 400 KB script (performance). See the G.3 report for the transcripts.
 *
 * ## Why category assertions and NOT `preset: 'lighthouse:no-pwa'`
 *
 * That preset asserts individual audits at `error` (`unused-css-rules`,
 * `unused-javascript`, ...), which the theme's chrome fails on any page by
 * construction. Category assertions hold the line against a future regression
 * in whichever audits make up a category without re-opening the "author names
 * every audit by hand" maintenance burden the preset carries.
 */
module.exports = {
  ci: {
    collect: {
      // WP1 contract: the fixture site is built to .lhci-site/.
      staticDistDir: '.lhci-site',
      numberOfRuns: 3,
      // Audit EVERY emitted page (default caps autodiscovery at 5), so a
      // regression on any package's detail page or the 404 page reds the gate.
      maxAutodiscoverUrls: 0,
      settings: {
        // chrome-launcher autodetects when CHROME_PATH is unset (CI provides
        // its own chrome); `task quality:web` fills it in locally from a
        // puppeteer-cached Chrome when the shell has not set it.
        chromePath: process.env.CHROME_PATH || undefined,
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 1 }],
        'categories:seo': ['error', { minScore: 1 }],
        'categories:performance': ['error', { minScore: 0.96 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
