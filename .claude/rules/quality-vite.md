---
paths:
  - "**/vitest.config.*"
  - "src/site/astro_config.ts"
  - "docs/astro.config.mjs"
---

# Vite / Vitest / Astro Build Tool Quality

This repo has no hand-authored `vite.config.*`. The site is built by Astro
(which drives Vite, Vite 8 / Rolldown): `src/site/astro_config.ts`'s pure
`astroConfig(input)` returns the whole `AstroUserConfig`, and
`src/build/astro_config_file.ts` writes a two-line `astro.config.mjs` into a
per-invocation scratch root that imports it and feeds it the `SiteInput` from
`site.json` (`src/build/scratch.ts`, always disposed). The config files that
glob-match here are `vitest.config.ts`, `astro_config.ts` and the docs site's own
`docs/astro.config.mjs` (a separate Starlight project with its own toolchain).

Universal review checklist: `quality-core.md`. TypeScript specifics:
`quality-typescript.md`.

---

## Anti-Patterns

### Block (must fix before merge)

1. **Hardcoded credentials or secrets** in any Vite/Vitest/Astro config.
2. **Interpolating data into generated config source.** `astro_config_file.ts`
   interpolates exactly two strings, both through `JSON.stringify` (C-040); every
   other value travels in `site.json`. A third interpolation, or one without
   `JSON.stringify`, lets a path or wire value break out of its string literal.
3. **A render writing outside its scratch root or into `outDir` directly.** Astro
   builds into a fresh sibling staging dir and only a successful build is
   promoted (`engine.ts`, C-038); the output guard (`cli/out_dir.ts`, C-036)
   refuses an `--out` overlapping the inputs. Do not work around either.
4. **A programmatic Astro import.** Only `astro_runner.ts` resolves the `astro`
   bin and spawns it; no other `src/**` file value-imports `build|dev|preview|sync`
   from `"astro"` (`import type` and `astro:*` virtual modules are fine).
   `test/build/astro_isolation.test.ts` enforces it (C-025): Vite must never
   share a process with vitest's own module transform.
5. **Missing env validation** at config load: validate, fail the build, never
   pass `undefined` through.

### Warn (should fix)

- `optimizeDeps.include` as a workaround instead of fixing the ESM incompatibility.
- `resolve.alias` with absolute paths; use `fileURLToPath(new URL(..., import.meta.url))`.
- A pinned Astro setting changed silently. C-045 fixes `compressHTML`,
  `build.inlineStylesheets: "never"`, `build.concurrency: 1`,
  `trailingSlash: "always"`, `build.format: "directory"`,
  `devToolbar.enabled: false` and `markdown.syntaxHighlight: false` with an
  explicit processor; `test/site/astro_config.test.ts` pins them.

---

## Astro / Vite gotchas this config encodes

1. **Bundler options live under `vite.build.rolldownOptions` only.** A
   `rollupOptions` key is a silent no-op under Vite 8.
2. **`ssr.noExternal: true` (build only) plus the prerender environment's
   `resolve.noExternal: true`.** Left external, the prerender chunk's bare
   imports resolve from the staging dir upward and can hit an unrelated hoisted
   copy of a package (a `cookie@0.7.2` pulled in by a dev dependency) instead of
   Astro's own. `dev` must NOT set it: the module runner would load CommonJS
   dependencies as ESM and every request dies with `require is not defined`.
3. **`resolve.dedupe: ["astro"]`.** The `file:`-linked theme resolves its own
   copy of Astro; two runtimes make components see a foreign `Astro` global.
4. **The runner strips `BASE_URL` from the child's env.** Vite lets that variable
   shadow the configured `base`; vitest and many CI images export it.
5. **`security.csp` does not hash `is:inline` scripts**, so the theme's hashes are
   passed in (see `subsystem-site.md`).
6. **Dev confinement (C-044):** `127.0.0.1`, `vite.server.fs.strict` with `allow`
   limited to the scratch root, this package's dir and the resolved theme dir.
   Vite's watcher skips `node_modules` (where the scratch root lives), so dev
   re-includes the scratch root with a negated `watch.ignored` glob.

---

## Env Var Discipline

- **`VITE_*` prefix = client-exposure switch**: inlined into the browser bundle.
  Never prefix a secret `VITE_`.
- Never read `process.env` at module scope in `src/site/client/**` or `lib/`
  code that ships to the browser: it resolves on the build machine, not per
  visitor.

---

## Vitest config

`vitest.config.ts` defines two projects, `unit` and `acceptance`, and the 100%
coverage thresholds; `coverage.exclude` is a pinned list, each entry commented
with why (`test/vitest_config.test.ts`). See `subsystem-tests.md`. A new exclude
is a reviewed change to that test and the ADR, never a bare glob.

---

## Code Review Checklist (Vite/Astro-Specific)

See `quality-core.md` for the universal checklist. Additions:

- [ ] No secrets in any config; no `VITE_` prefix on a server-only variable
- [ ] `astro_config_file.ts` still interpolates two `JSON.stringify`'d strings
- [ ] `astroConfig` is still the only emitter of Astro settings (no second config path)
- [ ] Bundler options under `rolldownOptions`; the C-045 settings unchanged
- [ ] No new value import from `"astro"` outside `astro_runner.ts`
- [ ] New `vitest.config.ts` coverage excludes carry a comment and a test update
