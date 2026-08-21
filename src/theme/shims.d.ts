// Ambient module shims for asset types tsc has no native understanding of.
// `.vue` SFC internals are NOT typechecked by plain `tsc` (that needs
// `vue-tsc`) — this shim only lets `.ts`/`.mts` files that *import* a `.vue`
// component resolve a type for it. Standard Vue+TS scaffold shim (see
// `create-vue`'s `env.d.ts`); intentionally the smallest option: full
// `vue-tsc` SFC-internal typechecking was considered and skipped — SFC
// internals are gated by the golden-diff fixtures + smoke instead (ADR),
// and vue-tsc would add a toolchain dep for checks the byte-gate already
// subsumes on a verbatim lift.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// Side-effect CSS imports (`import './styles/base.css'`, `@fontsource/*`) —
// no exports needed, just lets tsc resolve the specifier.
declare module '*.css'
