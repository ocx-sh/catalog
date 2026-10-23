import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // .lhci-site/, .lhci-budget/ and .lighthouseci/ are `task quality:web` scratch — built
    // sites and Lighthouse's reports. All are gitignored, but eslint
    // reads the filesystem, so a lint run after a quality:web run would
    // otherwise report thousands of errors inside minified bundle output.
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".lhci-site/**",
      ".lhci-bulk/**",
      ".lhci-bulk-src/**",
      ".lhci-budget/**",
      ".lighthouseci/**",
      ".lighthouseci-bulk/**",
      // docs site (task docs:build): its own Astro project with its own toolchain,
      // and a build output that ships minified JS bundles js.configs.recommended
      // would otherwise try to parse.
      "docs/**",
      // Agent worktrees (.agents/worktrees/<name>/) are full checkouts with
      // their own tsconfig.json: linting them from the main checkout makes
      // typescript-eslint find several tsconfigRootDir candidates and fail.
      ".agents/**",
      // TEMPORARY until @ocx-sh/theme 0.2.0 on npm (plan step I.1): CI's
      // install-ocx-theme action checks the theme source out here.
      ".ocx-theme-src/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // .cjs is CommonJS by definition — the package is otherwise ESM-only, and
    // the one such file (scripts/lhci-posix-tmpdir.cjs) is a `node --require`
    // preload, which CANNOT be ESM.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
