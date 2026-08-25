// Stand-in for VitePress's `@localSearchIndex` virtual module — see the
// alias in `vitest.config.ts` for why it exists. Shape matches the real
// one: locale index -> lazy loader for that locale's serialized MiniSearch
// JSON. Empty, so `SearchModal.vue`'s `ensureDocsIndex` finds no loader for
// the active locale and returns without building a docs index.
export default {} as Record<string, () => Promise<{ default: string }>>;
