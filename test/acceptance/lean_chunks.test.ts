/**
 * C-017 — what the built `_astro/` holds after the lean-preload and eager-chunk settings (`lean_preload.ts`,
 * `astro_config.ts`): no preload helper to ship, no dependency tables, and the trigger layer in one chunk.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHtml, site, siteLog } from "./helpers.js";

async function chunks(): Promise<{ name: string; code: string }[]> {
  const dir = join(site("root"), "_astro");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".js"));
  return Promise.all(names.map(async (name) => ({ name, code: await readFile(join(dir, name), "utf8") })));
}

const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^'"`();]*?\bfrom)?\s*["'`]\.\/([^"'`]+\.js)["'`]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g;
/** Rolldown's runtime leaf (`__exportAll`): 158 B no group can capture. Two chunks import it, so it stays out of the count. */
const RUNTIME_LEAF = /^rolldown-runtime\./;

const edges = (code: string, pattern: RegExp): string[] => [...code.matchAll(pattern)].map((m) => m[1]!);

/**
 * What the browser does after the page's own scripts ran, per lazy chunk reachable from them: the number of sequential
 * round trips it takes to have the chunk and all its static imports, i.e. the shortest static-import distance at which
 * each chunk is first discovered (an import is fetched the moment its importer is parsed, so siblings and re-imports
 * cost nothing), maximised over the chunk's graph. The page's own module scripts, the chunks they import statically and
 * the eager chunk are already there when an island's lazy `import()` fires, and do not count.
 */
async function lazyRounds(path: string): Promise<Map<string, number>> {
  const all = await chunks();
  const code = new Map(all.map(({ name, code }) => [name, code]));
  const staticOf = (name: string): string[] => edges(code.get(name) ?? "", STATIC_IMPORT).filter((dep) => !RUNTIME_LEAF.test(dep));
  const doc = await readHtml(site("root"), path);
  const scripts = [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((el) => el.getAttribute("src")!.split("/").pop()!);
  const loaded = new Set<string>();
  for (const queue = [...scripts]; queue.length > 0; ) {
    const name = queue.pop()!;
    if (!loaded.has(name)) {
      loaded.add(name);
      queue.push(...staticOf(name));
    }
  }
  const lazy = new Set<string>();
  for (const queue = [...loaded]; queue.length > 0; ) {
    for (const target of edges(code.get(queue.pop()!) ?? "", DYNAMIC_IMPORT))
      if (!loaded.has(target) && !lazy.has(target)) {
        lazy.add(target);
        queue.push(target);
      }
  }
  const rounds = new Map<string, number>();
  for (const root of lazy) {
    const seen = new Set([root]);
    let frontier = [root];
    let depth = 0;
    while (frontier.length > 0) {
      depth += 1;
      frontier = frontier.flatMap(staticOf).filter((dep) => !loaded.has(dep) && !seen.has(dep) && seen.add(dep));
    }
    rounds.set(root.replace(/\.[\w-]{8}\.js$/, ""), depth);
  }
  return rounds;
}

describe("C-017 the built scripts carry no Vite preload machinery", () => {
  it("has no dependency table in any chunk, and no copy of Vite's preload helper", async () => {
    const all = await chunks();
    expect(all.length).toBeGreaterThan(0);
    for (const { name, code } of all) {
      expect(code, name).not.toContain("__vite__mapDeps");
      // The real helper feature-detects `modulepreload` and builds <link> elements; the stub does neither.
      expect(code, name).not.toContain("modulepreload");
    }
  });

  it("puts the trigger layer in one eager chunk that the landing's island scripts import", async () => {
    const all = await chunks();
    const eager = all.find(({ name }) => name.startsWith("eager."));
    expect(eager, "an eager chunk").toBeDefined();
    // The trigger layer's own state contract is in it, once.
    expect(all.filter(({ code }) => code.includes("zagState") && code.includes("[ocx] Zag failed to start"))).toHaveLength(1);
    const doc = await readHtml(site("root"), "/");
    const scripts = [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((el) => el.getAttribute("src")!.split("/").pop()!);
    const importing = all.filter(({ name, code }) => scripts.includes(name) && code.includes(`./${eager!.name}`));
    expect(importing.length).toBeGreaterThan(1);
  });

  it("keeps the lazy machines out of the eager chunk", async () => {
    const eager = (await chunks()).find(({ name }) => name.startsWith("eager."));
    expect(eager!.code).not.toContain("createMachine");
    expect(eager!.code).not.toContain("copy-menu");
  });
});

describe("C-017 lazy chunk chains stay at most two round trips deep", () => {
  // No preload hints (lean_preload.ts), so the browser walks a lazy chunk's static imports one level per round trip.
  for (const path of ["/", "/tools/modern/"]) {
    it(`every lazy chunk reachable from ${path} is its own chunk plus at most the shared core`, async () => {
      const rounds = await lazyRounds(path);
      const deep = [...rounds].filter(([, depth]) => depth > 2);
      expect(deep, "lazy chunks more than two levels deep").toEqual([]);
      // The control: the measure sees real chains, not an empty graph.
      expect(rounds.size).toBeGreaterThan(3);
      expect(Math.max(...rounds.values())).toBe(2);
    });
  }

  it("measures the mobile menu, dialog and copy-menu machines (the former 6, 5 and 4 deep chains) at two on both pages", async () => {
    for (const path of ["/", "/tools/modern/"]) {
      const rounds = await lazyRounds(path);
      for (const machine of ["mobile-menu.zag", "dialog.zag", "copy-menu.zag"]) expect(rounds.get(machine), `${machine} on ${path}`).toBe(2);
    }
  });

  it("builds without a deprecation warning from the bundler or from Astro", () => {
    const { stdout, stderr } = siteLog("root");
    expect(`${stdout}\n${stderr}`).not.toMatch(/deprecat/i);
  });
});

describe("C-017 each module the config calls eager really lands in the eager chunk", () => {
  const markers: [string, string | RegExp][] = [
    ["ui/lazy.mjs", "[ocx] Zag failed to start"],
    ["ui/zag.mjs", "data-zag-props is not an object"],
    ["ui/value-set.mjs", /zagProps=JSON\.stringify\(\{\.\.\.\w+,defaultValue:\w+\}\);for\(let \w+ of \w+\.querySelectorAll\(`\[data-part="item"\]`\)/],
    ["site/lib/dom.ts", /dataset\.copy=JSON\.stringify\(\{\.\.\.\w+,link:new URL/],
    // The stub (`export const __vitePreload = (load) => load()`, minified to an identity call) next to a call of it wrapping an `import()`.
    ["the preload helper stub", /\b(\w+)=(\w+)=>\2\(\)[,;][^]*\b\1\(\(\)=>import\(`/],
  ];
  for (const [module, marker] of markers) {
    it(`${module} is in the eager chunk, and in no other`, async () => {
      const all = await chunks();
      const holders = all.filter(({ code }) => (typeof marker === "string" ? code.includes(marker) : marker.test(code))).map(({ name }) => name.split(".")[0]);
      expect(holders).toEqual(["eager"]);
    });
  }

  it("keeps the zag machines' shared internals in one zag-core chunk", async () => {
    const all = await chunks();
    expect(all.filter(({ name }) => name.startsWith("zag-core."))).toHaveLength(1);
    // The former intermediate chunks are gone: nothing named after a @zag-js package's entry file survives beside it.
    expect(all.filter(({ name }) => /^(?:dist|dismissable-layer|create-machine|state)\./.test(name)).map(({ name }) => name)).toEqual([]);
  });
});

describe("C-017 the LogoTile install script stays external", () => {
  it("is in the landing HTML as a script src only, never as an inline copy, and ships as one file", async () => {
    const dir = join(site("root"), "_astro");
    const doc = await readHtml(site("root"), "/");
    const html = doc.documentElement.outerHTML;
    // The install script is the only code that sets `data-retried`; the lazy tile filler only clears it.
    expect(html).not.toContain("data-retried");
    const tags = [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src*="LogoTile"]')];
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags.map((tag) => tag.getAttribute("src"))).size).toBe(1);
    const holders = (await readdir(dir)).filter((name) => name.endsWith(".js"));
    const withInstall: string[] = [];
    for (const name of holders) if ((await readFile(join(dir, name), "utf8")).includes("setAttribute(`data-retried`")) withInstall.push(name);
    expect(withInstall).toHaveLength(1);
    expect(withInstall[0]).toMatch(/^LogoTile\.astro_astro_type_script/);
  });
});
