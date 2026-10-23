/**
 * The internal Astro integration: `astro:config:setup` reads `site.json`,
 * `injectRoute` x4 from this package's own location, imports the consumer
 * stylesheet (`consumerCss`) into every page so Vite bundles it, exposes the model as
 * `virtual:ocx-catalog/site`, `updateConfig` (`ssr.noExternal`) and
 * `addWatchFile(site.json)`; `astro:server:setup` adds `site.json` to the
 * watcher. Type-only import of "astro" (C-025): the hooks are plain functions
 * Astro calls, tested in-process with spies.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AstroIntegration } from "astro";
import { containConsumerCss, recordViolation } from "./css_containment.js";
import { leanPreload } from "./lean_preload.js";

const VIRTUAL_ID = "virtual:ocx-catalog/site";
/** The `\0` prefix is Vite's convention for ids no other plugin may transform. */
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Pages ship beside this module: `src/site/pages` under vitest, `dist/site/pages` after build. */
const page = (name: string): URL => new URL(`./pages/${name}.astro`, import.meta.url);

/** @param sitePath absolute path of `<scratch>/site.json` */
export const catalog = (sitePath: string): AstroIntegration => ({
  name: "ocx-catalog",
  hooks: {
    "astro:config:setup": ({ injectRoute, injectScript, updateConfig, addWatchFile }) => {
      // The model minus the `astro` key (the SiteInput `astro.config.mjs` reads
      // from the same file — scratch paths the pages must never see). Re-serialized,
      // so the text is a valid JS expression.
      const model = JSON.parse(readFileSync(sitePath, "utf8")) as Record<string, unknown>;
      const publicDir = (model.astro as { publicDir?: unknown } | undefined)?.publicDir;
      delete model.astro;
      // The consumer stylesheet: imported from every page's frontmatter, so Vite bundles it from its own
      // location (relative `@import`/`url()` resolve; minified, content-hashed) like the theme's sheets.
      // Its graph must stay inside the config directory (`css_containment.ts`).
      const { consumerCss, consumerRoot } = model;
      delete model.consumerCss;
      delete model.consumerRoot;
      let contain = {};
      if (typeof consumerCss === "string") {
        if (typeof consumerRoot !== "string") throw new Error("site.json: consumerCss without consumerRoot would bundle an unchecked stylesheet");
        if (typeof publicDir !== "string") throw new Error("site.json: consumerCss without astro.publicDir would bundle an unchecked stylesheet");
        // The scratch root holding `site.json` is the Astro (so Vite) root.
        const scratch = dirname(sitePath);
        const vite = { root: scratch, publicDir };
        contain = { css: { postcss: { plugins: [containConsumerCss(consumerCss, consumerRoot, recordViolation(scratch), vite)] } } };
        injectScript("page-ssr", `import ${JSON.stringify(consumerCss)};`);
      }
      const siteJson = JSON.stringify(model);
      injectRoute({ pattern: "/", entrypoint: page("index") });
      injectRoute({ pattern: "/404", entrypoint: page("404") });
      injectRoute({ pattern: "/docs/[...slug]", entrypoint: page("docs") });
      injectRoute({ pattern: "/[...pkg]", entrypoint: page("package") });
      updateConfig({
        vite: {
          ...contain,
          plugins: [
            {
              name: "ocx-catalog:site",
              resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
              load: (id) => (id === RESOLVED_ID ? `export default ${siteJson};` : undefined),
            },
            leanPreload(),
          ],
          ssr: { noExternal: ["@ocx-sh/catalog", "@ocx-sh/theme"] },
        },
      });
      addWatchFile(sitePath);
    },
    "astro:server:setup": ({ server }) => {
      server.watcher.add(sitePath);
    },
  },
});
