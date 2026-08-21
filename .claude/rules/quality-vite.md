---
paths:
  - "**/vite.config.*"
  - "**/vitest.config.*"
  - "**/.vitepress/config.*"
---

# Vite / VitePress Build Tool Quality

This repo has no hand-authored `vite.config.*` or committed `.vitepress/config.*`
— it programmatically *generates* a VitePress config (`src/build/config_gen.ts`,
a `defineConfig({...})` call emitted as source text) into a per-invocation scratch
root (`src/build/scratch.ts`, `mkdtemp`-based, always disposed). The one config
file that glob-matches in this repo today is `vitest.config.ts`. Everything below
still applies to both: the generator when you touch `config_gen.ts`, and
`vitest.config.ts` directly.

Universal review checklist: `quality-core.md`. TypeScript specifics:
`quality-typescript.md`.

---

## Anti-Patterns

### Block (must fix before merge)

1. **Hardcoded credentials or secrets** in any Vite/Vitest config — use env vars,
   never commit.
2. **Browser API at module scope** in a `src/theme/**/*.vue` component —
   `window`/`document` at import time crashes VitePress's Node pre-render. This
   repo's real pattern (`src/theme/utils/sanitize.ts`): guard with
   `typeof window === 'undefined'` and throw a clear error rather than access
   `undefined`; components that need `document` do it inside `onMounted`
   (`Layout.vue`), never at the top level of `<script setup>`.
3. **A generated config writing outside its scratch root, or an `outDir` that
   nests the scratch root** — `engine.ts`'s `assertOutDirSafe` exists precisely to
   refuse this before the real `vitepress build()` call runs; don't work around it.
4. **Missing env var validation** at config load — validate before use, fail the
   build on invalid/missing values rather than passing `undefined` through.

### Warn (should fix)

- `optimizeDeps.include` as a workaround instead of fixing the underlying ESM
  incompatibility
- No explicit `build.outDir` in a hand-written config — defaults differ between
  app mode and library mode
- `resolve.alias` with absolute paths — use `fileURLToPath(new URL(..., import.meta.url))`
  for portability across the scratch-root/consumer split this repo relies on

---

## VitePress-Specific Gotchas

1. **SSR compat is mandatory** — VitePress pre-renders every page in Node at
   build time. Any browser API touched at import time crashes the build; the
   fix is a runtime guard (see Block #2 above) or deferring the access into a
   lifecycle hook that only fires client-side.
2. **`<ClientOnly>`** for a component that genuinely can't be made SSR-safe
   (third-party charting/rendering libs).
3. **One `.vitepress/config.ts` per site** — VitePress ignores a root
   `vite.config.ts` entirely. `config_gen.ts` is the sole author of the generated
   config in this repo; don't add a second config-emission path.
4. **`vite:` sub-object inside the generated `defineConfig`** — `config_gen.ts`
   sets `vite: { cacheDir: ... }` there rather than emitting a separate Vite
   config, matching how VitePress itself expects Vite options to arrive.

---

## Env Var Discipline

- **`VITE_*` prefix = client-exposure switch** — a prefixed var is inlined into
  the browser bundle at build time. Never prefix a secret `VITE_`.
- Validate env vars at config load; fail fast on missing/invalid rather than
  letting `undefined` propagate into generated config text.
- Never read `process.env` at module scope in `src/theme/**` (client code) — it
  resolves at build time on the machine that ran the build, not per-visitor.

---

## Config Structure Recommendations

- Extract reusable plugin arrays to a local helper — don't duplicate them between
  `vitest.config.ts` and any future `vite.config.ts`.
- Vitest coverage config (`vitest.config.ts`) should keep `coverage.exclude`
  entries commented with *why* (subprocess-only, SSR-render-only, ambient
  `.d.ts`) — this repo's own file does this; match that standard when adding a
  new exclusion rather than adding a bare glob.

---

## Code Review Checklist (Vite/VitePress-Specific)

See `quality-core.md` for the universal checklist. Additions:

- [ ] No secrets or credentials in any Vite/Vitest config
- [ ] No `VITE_` prefix on a server-only env var
- [ ] Browser API access in `src/theme/**/*.vue` guarded for SSR (module-scope
      access is the bug; `onMounted`/lifecycle-hook access is fine)
- [ ] `config_gen.ts` stays the single source that emits the generated
      `.vitepress/config.ts` — no second generator introduced
- [ ] New `vitest.config.ts` coverage excludes carry a comment explaining why
