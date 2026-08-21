import vue from "@vitejs/plugin-vue";
import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  // Lets vitest/vite resolve `.vue` SFC imports (theme components) —
  // WP-03: no ported test currently imports one directly, but coverage
  // collection walks every file `coverage.include` matches, .vue included.
  plugins: [vue()],
  test: {
    // .agents/worktrees/ holds ephemeral per-WP checkouts of this repo;
    // without this, vitest double-collects their test/ copies.
    exclude: [...defaultExclude, "**/.agents/**"],
    // Builds dist/ exactly once before any worker starts — see the file's
    // own docblock for the dist/-race this replaces.
    globalSetup: ["test/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // bin shim runs top-level against real process.argv as a subprocess
        // only (see test/cli.test.ts's subprocess smoke); not importable
        // in-process.
        "src/cli/index.ts",
        // dev.ts's forked worker (C-005/S-003 "Vite-in-Vite pitfall" — see
        // its own doc) — runs as a genuinely separate `node` process
        // (fork()-ed against its compiled dist/ output), never imported
        // in-process by anything, same "subprocess only" reasoning as the
        // bin shim above. test/build/dev.test.ts's real devServer() calls
        // are this module's functional coverage instead.
        "src/build/dev_worker.ts",
        // SFC internals (`<script setup>` logic) aren't unit-testable via
        // plain branch coverage the way composables/utils are — golden
        // fixtures + a smoke gate cover them instead (WP-03 decision).
        "**/*.vue",
        // Ambient type-only declarations — zero executable code, nothing
        // for v8 to instrument.
        "**/*.d.ts",
        // Theme registration entry: re-exports Layout.vue (itself excluded
        // above) + side-effect CSS imports. Importing it for coverage would
        // force-load the whole component graph through Vite's transform
        // pipeline — same "smoke gate, not branch coverage" call as the
        // SFCs it wires together (WP-03 decision, flagged for review).
        "src/theme/index.mts",
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
