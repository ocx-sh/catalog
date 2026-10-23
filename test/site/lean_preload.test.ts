/**
 * C-017 — the lean preload helper: Vite's 2 KB `__vitePreload` and every lazy import's `__vite__mapDeps` table are
 * pre-input weight on pages whose lazy chunks load on interaction. The plugin swaps the helper for a stub, empties the
 * dependency lists, and fails the build the day a lazy chunk carries CSS the stub would never load.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HELPER_ID, leanPreload } from "../../src/site/lean_preload.js";

type Hooks = {
  name: string;
  enforce: string;
  applyToEnvironment: (environment: { config: { consumer: string } }) => boolean;
  configEnvironment: (name: string) => { build: { modulePreload: { polyfill: boolean; resolveDependencies: () => string[] } } } | undefined;
  load: (id: string) => string | undefined;
  buildEnd: (this: { getModuleIds: () => string[]; getModuleInfo: (id: string) => { dynamicallyImportedIds: string[] } | null; error: (message: string) => never }) => void;
  generateBundle: (this: { error: (message: string) => never }, options: unknown, bundle: Record<string, unknown>) => void;
};
const fresh = () => leanPreload() as unknown as Hooks;
const plugin = fresh();
const chunk = (fileName: string, css: string[], isDynamicEntry: boolean) => ({
  type: "chunk",
  fileName,
  isDynamicEntry,
  viteMetadata: { importedCss: new Set(css) },
});
const run = (bundle: Record<string, unknown>) => {
  const error = vi.fn((message: string): never => {
    throw new Error(message);
  });
  plugin.generateBundle.call({ error }, {}, bundle);
};

describe("leanPreload", () => {
  it("runs before Vite's own helper plugin, on the browser build only", () => {
    expect(plugin.name).toBe("ocx-catalog:lean-preload");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.applyToEnvironment({ config: { consumer: "client" } })).toBe(true);
    expect(plugin.applyToEnvironment({ config: { consumer: "server" } })).toBe(false);
  });

  it("serves a stub for Vite's preload helper and leaves every other module alone", () => {
    expect(plugin.load("\0vite/preload-helper.js")).toBe("export const __vitePreload = (load) => load();");
    expect(plugin.load("/src/other.js")).toBeUndefined();
  });

  it("empties the client build's dependency lists, and touches no other environment", () => {
    const { modulePreload } = plugin.configEnvironment("client")!.build;
    expect(modulePreload.polyfill).toBe(false);
    expect(modulePreload.resolveDependencies()).toEqual([]);
    expect(plugin.configEnvironment("ssr")).toBeUndefined();
  });

  it("passes a bundle whose lazy chunks carry no CSS", () => {
    expect(() =>
      run({
        "a.js": chunk("a.js", [], true),
        "b.js": chunk("b.js", ["page.css"], false),
        "c.js": { type: "chunk", fileName: "c.js", isDynamicEntry: true },
        "page.css": { type: "asset", fileName: "page.css" },
      }),
    ).not.toThrow();
  });

  it("fails the build on a lazy chunk that carries CSS", () => {
    expect(() => run({ "a.js": chunk("a.js", ["a.css"], true) })).toThrow(/lazy chunk a\.js carries CSS \(a\.css\)/);
  });

  it("targets the helper id that the installed Vite really uses", () => {
    // Read from Vite's source, not restated: if Vite renames its helper, this goes red before the build silently stops stubbing it.
    const chunks = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "dist", "node", "chunks");
    const declared = readdirSync(chunks)
      .filter((name) => name.endsWith(".js"))
      .map((name) => /const preloadHelperId = "([^"\n]+)";/.exec(readFileSync(join(chunks, name), "utf8"))?.[1])
      .find((literal) => literal !== undefined);
    expect(declared, "Vite's `preloadHelperId` declaration").toBeDefined();
    expect(HELPER_ID).toBe(declared!.replaceAll("\\0", "\0"));
    expect(plugin.load(HELPER_ID)).toContain("__vitePreload");
  });

  describe("buildEnd", () => {
    const graph = (dynamicIds: Record<string, string[]>) => {
      const error = vi.fn((message: string): never => {
        throw new Error(message);
      });
      return {
        getModuleIds: () => Object.keys(dynamicIds),
        getModuleInfo: (id: string) => (id === "gone" ? null : { dynamicallyImportedIds: dynamicIds[id] ?? [] }),
        error,
      };
    };

    it("fails the build when dynamic imports exist and the helper never loaded (Vite renamed it)", () => {
      expect(() => fresh().buildEnd.call(graph({ "/a.js": ["/b.js"] }))).toThrow(/never loaded Vite's preload helper/);
    });

    it("passes once the helper loaded, and passes a build with no dynamic import at all", () => {
      const seen = fresh();
      seen.load(HELPER_ID);
      expect(() => seen.buildEnd.call(graph({ "/a.js": ["/b.js"] }))).not.toThrow();
      expect(() => fresh().buildEnd.call(graph({ "/a.js": [], gone: [] }))).not.toThrow();
    });
  });
});
