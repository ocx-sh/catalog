/**
 * C-043 / C-044 / C-045 — the pinned Astro settings `astroConfig` must emit.
 */
import { describe, expect, it } from "vitest";
import { astroConfig, type SiteInput } from "../../src/site/astro_config.js";

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

  it("names the markdown processor and turns syntax highlighting off", () => {
    const config = astroConfig(input);
    expect(config.markdown?.syntaxHighlight).toBe(false);
    expect(config.markdown?.processor?.name).toBe("satteri");
  });

  it("rewrites docs links only when a docs directory is set", () => {
    expect(astroConfig(input).markdown?.processor?.options?.hastPlugins).toEqual([]);
    const withDocs = astroConfig({ ...input, docsDir: "/site/docs" });
    expect(withDocs.markdown?.processor?.options?.hastPlugins).toHaveLength(1);
  });

  it("configures the bundler only under rolldownOptions", () => {
    const config = astroConfig(input);
    expect(JSON.stringify(config)).not.toContain("rollupOptions");
    expect(config.vite?.build).toHaveProperty("rolldownOptions");
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
