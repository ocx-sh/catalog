/**
 * The lean preload helper (C-017). Vite wraps every dynamic `import()` in `__vitePreload(factory, deps)` and
 * ships a 2 KB helper that `<link rel=modulepreload>`s the chunk's static dependencies and its CSS. Every
 * lazy island here loads on interaction, and none of its chunks carries CSS (Astro hoists component styles to the page),
 * so the helper and every chunk's `__vite__mapDeps` table of dependency URLs are pure pre-input weight.
 * The stub keeps the call shape and drops both; `generateBundle` fails the build the day a lazy chunk does carry CSS,
 * which the stub would never load. The stub keys on Vite's internal helper id (`HELPER_ID`): `buildEnd` fails the build
 * when a dynamic import exists but that module never loaded (Vite renamed it), and `lean_preload.test.ts` compares the id
 * with the one in the installed Vite source.
 */
import type { Plugin } from "vite";

export const HELPER_ID = "\0vite/preload-helper.js";
const STUB = "export const __vitePreload = (load) => load();";

export const leanPreload = (): Plugin => {
  let sawHelper = false;
  return {
    name: "ocx-catalog:lean-preload",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    // Astro replaces the build's `modulePreload` outright; an environment hook layers on top of that.
    configEnvironment: (name) => (name === "client" ? { build: { modulePreload: { polyfill: false, resolveDependencies: () => [] } } } : undefined),
    load(id) {
      if (id !== HELPER_ID) return undefined;
      sawHelper = true;
      return STUB;
    },
    buildEnd() {
      if (sawHelper) return;
      const dynamic = [...this.getModuleIds()].some((id) => (this.getModuleInfo(id)?.dynamicallyImportedIds.length ?? 0) > 0);
      if (dynamic) this.error(`the build has dynamic imports but never loaded Vite's preload helper (${JSON.stringify(HELPER_ID)}); Vite renamed it, so the lean stub no longer applies`);
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle))
        if (chunk.type === "chunk" && chunk.viteMetadata && chunk.viteMetadata.importedCss.size > 0 && chunk.isDynamicEntry)
          this.error(`lazy chunk ${chunk.fileName} carries CSS (${[...chunk.viteMetadata.importedCss].join(", ")}); the lean preload helper would never load it`);
    },
  };
};
