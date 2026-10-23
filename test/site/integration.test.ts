/**
 * C-025 — the internal integration's hooks, called in-process with spies (no
 * Astro import).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../../src/site/integration.js";

interface InjectedRoute {
  pattern: string;
  entrypoint: URL;
}
interface VitePlugin {
  name: string;
  resolveId: (id: string) => string | undefined;
  load: (id: string) => string | undefined;
}
interface ConfigSetup {
  injectRoute: ReturnType<typeof vi.fn<(route: InjectedRoute) => void>>;
  updateConfig: ReturnType<typeof vi.fn<(config: { vite: { plugins: VitePlugin[]; ssr: { noExternal: string[] } } }) => void>>;
  addWatchFile: ReturnType<typeof vi.fn<(path: string) => void>>;
  injectScript: ReturnType<typeof vi.fn<(stage: string, content: string) => void>>;
}

let dir: string;
let sitePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "integration-test-"));
  sitePath = join(dir, "site.json");
  writeFileSync(sitePath, JSON.stringify({ base: "/", routes: ["acme/tool"] }));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runConfigSetup(): ConfigSetup {
  const spies: ConfigSetup = { injectRoute: vi.fn(), updateConfig: vi.fn(), addWatchFile: vi.fn(), injectScript: vi.fn() };
  const hook = catalog(sitePath).hooks["astro:config:setup"] as (options: ConfigSetup) => void;
  hook(spies);
  return spies;
}

describe("catalog integration: astro:config:setup", () => {
  it("is named after the package", () => {
    expect(catalog(sitePath).name).toBe("ocx-catalog");
  });

  it("injects the four routes from this package's own pages", () => {
    const { injectRoute } = runConfigSetup();
    const routes = injectRoute.mock.calls.map(([route]) => [route.pattern, fileURLToPath(route.entrypoint)]);
    const pages = fileURLToPath(new URL("../../src/site/pages/", import.meta.url));
    expect(routes).toEqual([
      ["/", `${pages}index.astro`],
      ["/404", `${pages}404.astro`],
      ["/docs/[...slug]", `${pages}docs.astro`],
      ["/[...pkg]", `${pages}package.astro`],
    ]);
  });

  it("keeps this package and the theme in the transformed graph", () => {
    const { updateConfig } = runConfigSetup();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0]?.[0].vite.ssr.noExternal).toEqual(["@ocx-sh/catalog", "@ocx-sh/theme"]);
  });

  it("serves site.json as the virtual:ocx-catalog/site module", () => {
    const { updateConfig } = runConfigSetup();
    const plugin = updateConfig.mock.calls[0]?.[0].vite.plugins[0] as VitePlugin;
    const resolved = plugin.resolveId("virtual:ocx-catalog/site");
    expect(resolved).toBe("\0virtual:ocx-catalog/site");
    expect(plugin.load(resolved as string)).toBe('export default {"base":"/","routes":["acme/tool"]};');
  });

  it("keeps the astro SiteInput out of the served module", () => {
    writeFileSync(sitePath, JSON.stringify({ base: "/", astro: { outDir: "/scratch/staging" }, routes: [] }));
    const { updateConfig } = runConfigSetup();
    const plugin = updateConfig.mock.calls[0]?.[0].vite.plugins[0] as VitePlugin;
    expect(plugin.load("\0virtual:ocx-catalog/site")).toBe('export default {"base":"/","routes":[]};');
  });

  it("D-144 imports the consumer stylesheet into every page, so Vite bundles it from where it lives", () => {
    writeFileSync(sitePath, JSON.stringify({ base: "/", routes: [], consumerCss: "/proj/theme/site.css", consumerRoot: "/proj", astro: { publicDir: "/scratch/public" } }));
    const { injectScript, updateConfig } = runConfigSetup();
    expect(injectScript).toHaveBeenCalledExactlyOnceWith("page-ssr", 'import "/proj/theme/site.css";');
    const plugin = updateConfig.mock.calls[0]?.[0].vite.plugins[0] as VitePlugin;
    expect(plugin.load("\0virtual:ocx-catalog/site")).toBe('export default {"base":"/","routes":[]};');
  });

  it("D-144 checks the stylesheet's graph with a PostCSS plugin, and keeps the paths out of the served module", () => {
    writeFileSync(sitePath, JSON.stringify({ base: "/", routes: [], consumerCss: "/proj/theme/site.css", consumerRoot: "/proj", astro: { publicDir: "/scratch/public" } }));
    const { updateConfig } = runConfigSetup();
    const config = updateConfig.mock.calls[0]?.[0] as unknown as { vite: { css: { postcss: { plugins: { postcssPlugin: string }[] } } } };
    expect(config.vite.css.postcss.plugins.map((plugin) => plugin.postcssPlugin)).toEqual(["ocx-catalog:contain-consumer-css"]);
    const plugin = config.vite.plugins?.[0] as unknown as VitePlugin;
    expect(plugin.load("\0virtual:ocx-catalog/site")).not.toContain("proj");
  });

  it("D-144 refuses to bundle a stylesheet with no directory to contain it in", () => {
    writeFileSync(sitePath, JSON.stringify({ base: "/", routes: [], consumerCss: "/proj/theme/site.css" }));
    expect(() => runConfigSetup()).toThrow("consumerCss without consumerRoot");
  });

  it("D-144 refuses to bundle a stylesheet with no publicDir to judge its root-relative url()s against", () => {
    writeFileSync(sitePath, JSON.stringify({ base: "/", routes: [], consumerCss: "/proj/theme/site.css", consumerRoot: "/proj" }));
    expect(() => runConfigSetup()).toThrow("consumerCss without astro.publicDir");
  });

  it("D-144 injects nothing when no css is configured", () => {
    const { injectScript, updateConfig } = runConfigSetup();
    expect(injectScript).not.toHaveBeenCalled();
    expect(updateConfig.mock.calls[0]?.[0].vite).not.toHaveProperty("css");
  });

  it("C-017 registers the lean preload helper beside the site module", () => {
    const { updateConfig } = runConfigSetup();
    expect(updateConfig.mock.calls[0]?.[0].vite.plugins.map((plugin) => plugin.name)).toEqual(["ocx-catalog:site", "ocx-catalog:lean-preload"]);
  });

  it("leaves every other module id to the other plugins", () => {
    const { updateConfig } = runConfigSetup();
    const plugin = updateConfig.mock.calls[0]?.[0].vite.plugins[0] as VitePlugin;
    expect(plugin.resolveId("./other.js")).toBeUndefined();
    expect(plugin.load("./other.js")).toBeUndefined();
  });

  it("watches site.json", () => {
    const { addWatchFile } = runConfigSetup();
    expect(addWatchFile).toHaveBeenCalledWith(sitePath);
  });

  it("fails loudly when site.json is missing", () => {
    rmSync(sitePath);
    expect(() => runConfigSetup()).toThrow(/ENOENT/);
  });
});

describe("catalog integration: astro:server:setup", () => {
  it("adds site.json to the dev server's file watcher", () => {
    const add = vi.fn();
    const hook = catalog(sitePath).hooks["astro:server:setup"] as (options: { server: unknown }) => void;
    hook({ server: { watcher: { add } } });
    expect(add).toHaveBeenCalledWith(sitePath);
  });
});
