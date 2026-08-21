import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // src/theme/**/*.vue: verbatim-lifted VitePress theme (WP-03) — no
    // eslint-plugin-vue wired up yet (smallest option for this WP; add it
    // in a follow-up if the theme needs its own lint pass, see WP-03 report).
    ignores: ["dist/**", "coverage/**", "node_modules/**", "src/theme/**/*.vue"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Design-record ruling (WP-05): src/viewmodel/version_order.ts (Python
    // indexbot port) and src/theme/utils/version.ts (Rust ocx_lib port)
    // implement DIFFERENT version grammars for different purposes — a
    // future "dedupe these, they look similar" refactor would silently
    // corrupt one side's latestVersion computation. Forbid the import edge
    // in either direction so that mistake fails lint, not code review.
    files: ["src/viewmodel/version_order.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/theme/utils/version*"] }],
    },
  },
  {
    files: ["src/theme/utils/version.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/viewmodel/version_order*"] }],
    },
  },
);
