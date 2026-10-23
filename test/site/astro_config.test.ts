/**
 * C-043 / C-044 / C-045 — the pinned Astro settings `astroConfig` must emit.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { astroConfig, codeSplitting, inlineLimit, viteErrorText, type SiteInput } from "../../src/site/astro_config.js";

const input: SiteInput = {
  base: "/catalog/",
  siteUrl: "https://example.org/catalog/",
  outDir: "/scratch/staging",
  publicDir: "/scratch/public",
  cacheDir: "/scratch/.cache",
  sitePath: "/scratch/site.json",
  cspHashes: ["sha256-AAAA", "sha256-BBBB"],
  fsAllow: ["/scratch", "/pkg", "/theme"],
};

describe("astroConfig pins (C-045)", () => {
  it("pins the output and routing settings", () => {
    const config = astroConfig(input);
    expect(config.base).toBe("/catalog/");
    expect(config.trailingSlash).toBe("always");
    expect(config.build?.format).toBe("directory");
    expect(config.build?.inlineStylesheets).toBe("never");
    expect(config.build?.concurrency).toBe(1);
    expect(config.compressHTML).toBeTypeOf("boolean");
    expect(config.devToolbar?.enabled).toBe(false);
  });

  it("names the markdown processor and leaves syntax highlighting off without a docs mount", () => {
    const config = astroConfig(input);
    expect(config.markdown?.syntaxHighlight).toBe(false);
    expect(config.markdown?.processor?.name).toBe("satteri");
  });

  it("D-175 highlights docs fences with Shiki on a theme of --ocx-color-code-* variables, never a colour literal", () => {
    const markdown = astroConfig({ ...input, docsDir: "/site/docs" }).markdown;
    expect(markdown?.syntaxHighlight).toBe("shiki");
    const theme = JSON.stringify(markdown?.shikiConfig?.theme);
    for (const role of ["bg", "fg", "comment", "string", "keyword", "number", "function", "variable", "deleted"]) {
      expect(theme, role).toContain(`var(--ocx-color-code-${role})`);
    }
    expect(theme).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(theme).not.toContain("italic");
  });

  it("runs the docs markdown plugin only when a docs directory is set", () => {
    expect(astroConfig(input).markdown?.processor?.options?.hastPlugins).toEqual([]);
    const withDocs = astroConfig({ ...input, docsDir: "/site/docs" });
    expect(withDocs.markdown?.processor?.options?.hastPlugins).toHaveLength(1);
  });

  it("configures the bundler only under rolldownOptions", () => {
    const config = astroConfig(input);
    expect(JSON.stringify(config)).not.toContain("rollupOptions");
    expect(config.vite?.build).toHaveProperty("rolldownOptions");
  });

  it("C-017 groups the always-eager trigger layer, preload stub and dom helpers into one chunk, anchored to the theme and site paths", () => {
    const [eager] = codeSplitting("/theme/src", "/pkg/dist/site").groups;
    expect(eager?.name).toBe("eager");
    for (const id of [
      "/theme/src/components/ui/lazy.mjs",
      "/theme/src/components/ui/zag.mjs",
      "/theme/src/components/ui/value-set.mjs?v=1",
      "\0vite/preload-helper.js",
      "/pkg/dist/site/lib/dom.js",
      "/pkg/dist/site/lib/dom.ts",
    ]) expect(eager?.test(id), id).toBe(true);
    // Windows ids reach the bundler with backslashes.
    expect(codeSplitting("C:/theme/src", "C:/pkg/dist/site").groups[0]?.test("C:\\theme\\src\\components\\ui\\lazy.mjs")).toBe(true);
    // Controls: a same-named file elsewhere, the machines, the runtime and the lazy session stay out (they load on interaction).
    for (const id of [
      "/other/ui/lazy.mjs",
      "/node_modules/some-lib/components/ui/zag.mjs",
      "/other/site/lib/dom.js",
      "/theme/src/components/ui/zag-runtime.mjs",
      "/theme/src/components/toggle-group.zag.mjs",
      "/pkg/src/site/client/grid_session.ts",
    ]) expect(eager?.test(id), id).toBe(false);
  });

  it("C-017 puts the shared @zag-js internals and the theme's shared zag helpers in one chunk, and nothing else", () => {
    const zag = codeSplitting("/theme/src", "/pkg/dist/site").groups[1];
    expect(zag?.name).toBe("zag-core");
    expect(zag?.minShareCount).toBe(2);
    for (const id of [
      "/repo/node_modules/@zag-js/dialog/dist/index.mjs",
      "/repo/node_modules/.pnpm/@zag-js+core@1.0.0/node_modules/@zag-js/core/dist/index.mjs",
      "/theme/src/components/ui/zag-runtime.mjs",
      "/theme/src/components/ui/drawer.zag.mjs",
      "/theme/src/components/copy.mjs",
      "/theme/src/components/toast.mjs?v=1",
    ]) expect(zag?.test(id), id).toBe(true);
    for (const id of [
      "/repo/node_modules/@zag-js-not/x.mjs",
      "/repo/node_modules/zag-js/x.mjs",
      "/other/components/ui/zag-runtime.mjs",
      "/other/components/copy.mjs",
      "/theme/src/components/toast.zag.mjs",
      "/theme/src/components/ui/lazy.mjs",
      "/theme/src/components/ui/select.zag.mjs",
    ]) expect(zag?.test(id), id).toBe(false);
  });

  it("C-017 resolves the theme and the site directory itself, and uses rolldown's codeSplitting (advancedChunks is deprecated)", () => {
    const output = astroConfig(input).vite?.build?.rolldownOptions?.output as Record<string, unknown>;
    expect(output["advancedChunks"]).toBeUndefined();
    const groups = (output["codeSplitting"] as ReturnType<typeof codeSplitting>).groups;
    expect(groups.map((group) => group.name)).toEqual(["eager", "zag-core"]);
    // The real resolved paths: the theme's lazy.mjs and this package's own dom helper are eager, wherever they live on disk.
    const themeSrc = dirname(createRequire(import.meta.url).resolve("@ocx-sh/theme/tokens.css"));
    expect(groups[0]?.test(`${themeSrc}/components/ui/lazy.mjs`)).toBe(true);
    expect(groups[0]?.test(fileURLToPath(new URL("../../src/site/lib/dom.ts", import.meta.url)))).toBe(true);
  });

  it("C-017 keeps the LogoTile script an external file (inlined it would ship once per rendered tile), and the default for the rest", () => {
    const limit = astroConfig(input).vite?.build?.assetsInlineLimit;
    expect(limit).toBe(inlineLimit);
    expect(inlineLimit("_astro/LogoTile.astro_astro_type_script_index_0_lang.DK0gApY7.js")).toBe(false);
    expect(inlineLimit("_astro/Select.astro_astro_type_script_index_0_lang.DK0gApY7.js")).toBeUndefined();
  });

  it("points cacheDir, outDir and publicDir at the given paths", () => {
    const config = astroConfig(input);
    expect(config.cacheDir).toBe("/scratch/.cache");
    expect(config.outDir).toBe("/scratch/staging");
    expect(config.publicDir).toBe("/scratch/public");
  });

  it("enables site and the sitemap only with a siteUrl", () => {
    const config = astroConfig(input);
    expect(config.site).toBe("https://example.org/catalog/");
    const withoutSiteUrl: SiteInput = { ...input, siteUrl: undefined };
    expect(astroConfig(withoutSiteUrl).site).toBeUndefined();
  });

  it("registers the catalog integration and, with a siteUrl, the sitemap", () => {
    const names = (astroConfig(input).integrations ?? []).flat().map((integration) => (integration || undefined)?.name);
    expect(names).toContain("@astrojs/sitemap");
    expect(names).toHaveLength(2);
  });

  it("registers only the catalog integration without a siteUrl", () => {
    const names = (astroConfig({ ...input, siteUrl: undefined }).integrations ?? [])
      .flat()
      .map((integration) => (integration || undefined)?.name);
    expect(names).toEqual(["ocx-catalog"]);
  });

  it("resolves a single astro runtime for the theme's .astro files", () => {
    expect(astroConfig(input).vite?.resolve?.dedupe).toEqual(["astro"]);
  });

  it("bundles every dependency into the server and prerender chunks, so none resolves from the staging dir", () => {
    // Real-build regression: left external, the prerender chunk's `cookie` import resolved to a
    // hoisted cookie@0.7.2 (no `parseCookie`) instead of Astro's own cookie@2.
    const vite = astroConfig(input).vite;
    expect(vite?.ssr?.noExternal).toBe(true);
    expect(vite?.environments?.prerender?.resolve?.noExternal).toBe(true);
  });

  it("leaves dependencies external under dev (a port): inline CommonJS fails with 'require is not defined'", () => {
    const vite = astroConfig({ ...input, port: 4400 }).vite;
    expect(vite?.ssr).toBeUndefined();
    expect(vite?.environments).toBeUndefined();
  });
});

describe("astroConfig page CSP (C-043)", () => {
  it("is enabled with the theme's script hashes and a locked-down policy", () => {
    const csp = astroConfig(input).security?.csp;
    expect(csp).toBeTruthy();
    const policy = JSON.stringify(csp);
    expect(policy).toContain("sha256-AAAA");
    expect(policy).toContain("sha256-BBBB");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("'unsafe-inline'");
    expect(policy).not.toContain("script-src *");
  });
});

describe("astroConfig dev confinement (C-044)", () => {
  it("binds 127.0.0.1 on the requested port with strictPort", () => {
    const config = astroConfig({ ...input, port: 4400 });
    expect(config.server?.host).toBe("127.0.0.1");
    expect(config.server?.port).toBe(4400);
    expect(config.vite?.server?.strictPort).toBe(true);
  });

  it("re-includes the scratch root in Vite's watcher so a site.json swap restarts Astro (build leaves the defaults)", () => {
    const sitePath = "/cache/node_modules/.cache/ocx-catalog/ocx-catalog-1-a(b)/site.json";

    expect(astroConfig({ ...input, port: 4400, sitePath }).vite?.server?.watch?.ignored).toEqual([
      "!/cache/node_modules/.cache/ocx-catalog/ocx-catalog-1-a\\(b\\)/**",
    ]);
    expect(astroConfig({ ...input, sitePath }).vite?.server?.watch).toBeUndefined();
  });

  it("confines vite fs access to strict mode with exactly the given allow list", () => {
    const config = astroConfig({ ...input, port: 4400 });
    expect(config.vite?.server?.fs?.strict).toBe(true);
    expect(config.vite?.server?.fs?.allow).toEqual(["/scratch", "/pkg", "/theme"]);
  });

  it("binds 127.0.0.1 without a port or strictPort when none is requested", () => {
    const config = astroConfig(input);
    expect(config.server?.host).toBe("127.0.0.1");
    expect(config.server).not.toHaveProperty("port");
    expect(config.vite?.server).not.toHaveProperty("strictPort");
  });

  it("turns the dev toolbar off", () => {
    const config = astroConfig({ ...input, port: 4400 });
    expect(config.devToolbar?.enabled).toBe(false);
  });
});

describe("viteErrorText (dev): Vite's Error objects reach Astro's string-only logger as text", () => {
  const install = () => {
    const seen: [unknown, unknown][] = [];
    const logger = { error: (msg: unknown, opts?: { error?: unknown }) => void seen.push([msg, opts]) };
    viteErrorText.configureServer({ config: { logger } });
    return { logger, seen };
  };

  it("passes a string message through unchanged", () => {
    const { logger, seen } = install();
    logger.error("plain", { error: undefined });
    expect(seen).toEqual([["plain", { error: undefined }]]);
  });

  it("turns an Error into its stack and keeps the Error as opts.error", () => {
    const { logger, seen } = install();
    const failure = new Error("ENOENT: gone");
    logger.error(failure);
    expect(seen[0]?.[0]).toBe(failure.stack);
    expect(seen[0]?.[1]).toEqual({ error: failure });
  });

  it("uses the message when an Error has no stack, and keeps an explicit opts.error", () => {
    const { logger, seen } = install();
    const failure = new Error("no stack");
    failure.stack = undefined;
    const other = new Error("other");
    logger.error(failure, { error: other });
    expect(seen[0]).toEqual(["no stack", { error: other }]);
  });

  it("stringifies a non-Error value", () => {
    const { logger, seen } = install();
    logger.error(42);
    expect(seen[0]).toEqual(["42", { error: 42 }]);
  });

  it("is wired into dev only", () => {
    const base = { base: "/", outDir: "/o", publicDir: "/p", cacheDir: "/c", sitePath: "/s/site.json", cspHashes: [], fsAllow: [] };
    expect(astroConfig({ ...base, port: 4321 }).vite?.plugins).toEqual([viteErrorText]);
    expect(astroConfig(base).vite?.plugins).toBeUndefined();
  });
});
