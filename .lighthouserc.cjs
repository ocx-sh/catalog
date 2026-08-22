/**
 * Lighthouse CI config for `task quality:web` (WP2, C-201/C-203). Consumed
 * OUT-OF-PROCESS by the `@lhci/cli` binary — never imported into the vitest
 * process (hence its `vitest.config.ts` coverage exclusion). `task
 * quality:web` builds the committed fixture index at
 * `test/fixtures/quality-index/` into `.lhci-site/`, and lhci audits every
 * emitted page against the category thresholds below.
 *
 * ## Thresholds: measured, then ratcheted (C-203, unchecked-green discipline)
 *
 * A gate whose red state was never observed is not a gate. These numbers are
 * the MEASURED category medians of the fixture site (3 runs/page, all 8 pages
 * — index, 404, and one detail page per fixture package), then dropped by a
 * >=0.03 margin so ordinary run-to-run variance never reds the build while a
 * real regression still does. Re-measure and re-ratchet when the theme or the
 * fixture changes; never raise a threshold above a level the site actually
 * clears.
 *
 *   category         min median across pages   threshold (floor - margin)
 *   accessibility    1.00  (every page)         0.97   error
 *   best-practices   0.96  (404, contrib/mono)  0.93   error
 *   seo              1.00  (every page)         0.97   error
 *   performance      0.88  (acme/husk)          0.85   warn
 *
 * The medians above are the ones the headless Chrome that `task quality:web`
 * selects actually produces (see that task and
 * `scripts/lhci-posix-tmpdir.cjs`); a different browser build shifts them, so
 * re-measure rather than carrying numbers across setups.
 *
 * The a11y assertion's RED state was proven by a deliberate regression (a
 * no-alt `<img>`, an empty `<button>`, and an unlabeled `<input>` added to the
 * landing page dropped index.html a11y from 0.92 to 0.77 — median over 3 runs
 * — failing the 0.84 error gate with exit code 1), then reverted to confirm
 * green. See the WP2 completion report for the transcript.
 *
 * ## Why category assertions and NOT `preset: 'lighthouse:no-pwa'`
 *
 * C-201 named that preset, but it asserts individual audits at `error`
 * (`color-contrast`, `link-name`, `link-in-text-block`, `font-size`,
 * `unused-css-rules`, `unused-javascript`, ...). WP2's shipped theme failed
 * several of those (the header brand link had no accessible name; a handful
 * of design tokens missed WCAG contrast) — WP6 (2026-08-22) closed every
 * `color-contrast`/`link-name`/`link-in-text-block` failure the fixture site
 * produced (accessibility now medians 1.00 on all 8 pages; see
 * `src/theme/styles/tokens/palette.css`'s own docblock for the token-level
 * fix). `unused-css-rules`/`unused-javascript` remain real (VitePress ships
 * more JS/CSS than the landing page uses) and still out of scope. Category
 * assertions are kept rather than switching to the preset regardless: they
 * hold the line against any FUTURE regression in whichever audits make up a
 * category, without re-opening the "author names every audit by hand"
 * maintenance burden the preset carries.
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
        'categories:accessibility': ['error', { minScore: 0.97 }],
        'categories:best-practices': ['error', { minScore: 0.93 }],
        'categories:seo': ['error', { minScore: 0.97 }],
        'categories:performance': ['warn', { minScore: 0.85 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
