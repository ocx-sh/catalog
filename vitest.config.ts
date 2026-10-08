import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .agents/worktrees/ holds ephemeral per-WP checkouts of this repo;
    // without this, vitest double-collects their test/ copies.
    exclude: [...defaultExclude, "**/.agents/**", "**/.ocx-theme-src/**"],
    // Two projects (test/acceptance/helpers.ts documents the contract):
    //  - `unit`: everything but test/acceptance — Astro-free and fast. Its
    //    globalSetup builds dist/ exactly once before any worker starts (see
    //    that file's own docblock for the dist/-race this replaces).
    //  - `acceptance`: test/acceptance/** — its globalSetup builds dist/ (the
    //    same once-guarded step) and then runs the real CLI over the fixture
    //    configs. Vitest only runs a project's globalSetup when the run
    //    selects at least one of its files, so `vitest run test/foo.test.ts`
    //    never starts an Astro build.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...defaultExclude, "**/.agents/**", "**/.ocx-theme-src/**", "test/acceptance/**"],
          globalSetup: ["test/global-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "acceptance",
          include: ["test/acceptance/**/*.test.ts"],
          globalSetup: ["test/acceptance/global-setup.ts"],
          // A real `astro build` per fixture config runs inside the setup;
          // each suite then only reads trees, but staging/CLI suites spawn too.
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // bin shim runs top-level against real process.argv as a subprocess
        // only (see test/cli.test.ts's subprocess smoke); not importable
        // in-process.
        "src/cli/index.ts",
        // Astro templates (src/site/**/*.astro): v8 does not instrument compiled
        // Astro output, so they are covered by the built-HTML acceptance suite
        // and the puppeteer-core/Lighthouse gates instead (ADR D4). Logic lives in src/site/lib,
        // model and client, which stay at 100%.
        "**/*.astro",
        // Ambient type-only declarations — zero executable code, nothing
        // for v8 to instrument.
        "**/*.d.ts",
        // Lighthouse CI configs: CommonJS config objects read by the
        // `@lhci/cli` binary out-of-process during `task quality:web` (the
        // second one for the corporate-size run), never imported into the
        // vitest process — nothing for v8 to instrument.
        ".lighthouserc.cjs",
        ".lighthouserc.bulk.cjs",
        // Web-quality fixture wire index (WP2): committed JSON/markdown/asset
        // fixtures (config.json + p/**) that drive the Lighthouse fixture-site
        // build; data, not executable source.
        "test/fixtures/quality-index/**",
        // Web-quality harness (WP2): the Lighthouse gate lives entirely in
        // `task quality:web` (out-of-process `lhci autorun`), so anything
        // under test/quality/ is scaffolding for that standalone task, not
        // vitest-instrumented code under `src/**`.
        "test/quality/**",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
