/**
 * C-025 — Astro isolation. The Astro programmatic API (`build`, `dev`,
 * `preview`, `sync`) must never run inside the `ocx-catalog` process: a second
 * Vite instance in the CLI process is the "Vite-in-Vite" pitfall
 * (`src/build/dev_worker.ts`'s doc), so every Astro run goes through the one
 * runner that resolves the `astro` bin and spawns it as a child.
 *
 * Statically enforced here over `src/**`:
 *  - no value import of `build|dev|preview|sync` from `"astro"` (`import type`,
 *    inline `type` specifiers, `astro:*` virtual modules, `astro/*` subpaths
 *    like `astro/config` and plain strings are allowed);
 *  - the `astro/package.json` / `bin/astro` resolution lives only in
 *    `src/build/astro_runner.ts`.
 *
 * The scanner is exercised on planted-violation strings below, so this check
 * has a reachable red state (it also went red on a planted file once — see the
 * CW.2 commit's evidence line). The env-var and `ocx-catalog ci` halves of
 * C-025 are owned by P-engine (E.4, E.9).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(repoRoot, "src");
const RUNNER = "src/build/astro_runner.ts";
const SCANNED = /\.(?:ts|mts|js|mjs|vue|astro)$/;
const PROGRAMMATIC = new Set(["build", "dev", "preview", "sync"]);

/** Code lines only: whole-line comments are dropped so prose cannot trip the scan. */
function codeOf(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

function clauseIsValueImport(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return false;
  const braces = /\{([^}]*)\}/.exec(trimmed);
  const outsideBraces = trimmed.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  // A default or namespace binding hands out the whole module, build() included.
  if (outsideBraces !== "") return true;
  if (!braces) return false;
  return (braces[1] ?? "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== "" && !specifier.startsWith("type "))
    .some((specifier) => PROGRAMMATIC.has(specifier.split(/\s+as\s+/)[0] ?? ""));
}

/** Every C-025 violation in one source file, as `<path>: <reason>` lines. */
function astroViolations(path: string, text: string): string[] {
  const code = codeOf(text);
  const found: string[] = [];
  const staticImport = /^\s*(?:import|export)\s+([^;"']*?)\s*from\s*["']astro["']/gm;
  for (const match of code.matchAll(staticImport)) {
    const clause = match[1] ?? "";
    if (/^export\s*\*/.test(match[0].trim()) || clauseIsValueImport(clause)) {
      found.push(`${path}: value import of the astro programmatic API`);
    }
  }
  if (/\b(?:import|require)\(\s*["']astro["']\s*\)/.test(code)) {
    found.push(`${path}: dynamic load of "astro"`);
  }
  if (path !== RUNNER && /astro\/package\.json|bin\/astro|resolve\(\s*["']astro["']/.test(code)) {
    found.push(`${path}: resolves the astro bin outside ${RUNNER}`);
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("C-025 astro isolation", () => {
  it("no src/** file value-imports the programmatic API or resolves the astro bin outside the runner", () => {
    const violations = walk(srcRoot)
      .filter((file) => SCANNED.test(file))
      .flatMap((file) => astroViolations(relative(repoRoot, file), readFileSync(file, "utf8")));
    expect(violations).toEqual([]);
  });

  describe("the scanner goes red on a planted violation", () => {
    it.each([
      ['import { build } from "astro";'],
      ["import { dev as startDev } from 'astro';"],
      ['import { type AstroConfig, sync } from "astro";'],
      ['import astro from "astro";'],
      ['import * as astro from "astro";'],
      ['export { preview } from "astro";'],
      ['export * from "astro";'],
      ['const { build } = await import("astro");'],
      ['const astro = require("astro");'],
      ['import {\n  build,\n} from "astro";'],
    ])("flags %s", (planted) => {
      expect(astroViolations("src/build/other.ts", planted)).not.toEqual([]);
    });

    it.each([
      ['const bin = require.resolve("astro/package.json");'],
      ['const bin = join(dir, "bin/astro");'],
      ['const url = import.meta.resolve("astro");'],
    ])("flags %s outside the runner and allows it inside", (planted) => {
      expect(astroViolations("src/build/other.ts", planted)).not.toEqual([]);
      expect(astroViolations(RUNNER, planted)).toEqual([]);
    });
  });

  describe("the scanner allows the sanctioned forms", () => {
    it.each([
      ['import type { AstroConfig } from "astro";'],
      ['import type { build } from "astro";'],
      ['import { type AstroConfig, type AstroIntegration } from "astro";'],
      ['import { defineConfig } from "astro/config";'],
      ['import content from "astro:content";'],
      ['import { getCollection } from "astro:content";'],
      ['export type { AstroConfig } from "astro";'],
      ['const hook = "astro:config:setup";'],
      ['const note = "import { build } from \\"astro\\"";'],
      ["// import { build } from \"astro\";"],
      [" * import { build } from \"astro\";"],
    ])("allows %s", (source) => {
      expect(astroViolations("src/build/other.ts", source)).toEqual([]);
    });
  });
});
