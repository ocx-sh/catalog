/**
 * C-026 guard (`scripts/check-no-file-deps.mjs`): red on a planted `file:`
 * specifier in each of the four scanned file kinds, green on a clean tree.
 * The repo's own tree is deliberately NOT asserted here — it carries the local
 * theme dependency until plan step I.1 swaps it for `^0.2.0`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findFileDeps } from "../scripts/check-no-file-deps.mjs";

const script = fileURLToPath(new URL("../scripts/check-no-file-deps.mjs", import.meta.url));

const CLEAN_MANIFEST = { name: "x", dependencies: { "@ocx-sh/theme": "^0.2.0" } };
const CLEAN_LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { "@ocx-sh/theme": "^0.2.0" } },
    "node_modules/@ocx-sh/theme": {
      version: "0.2.0",
      resolved: "https://registry.npmjs.org/@ocx-sh/theme/-/theme-0.2.0.tgz",
    },
  },
};

const roots: string[] = [];

function tree(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "ocx-catalog-file-deps-"));
  roots.push(root);
  const all: Record<string, unknown> = {
    "package.json": CLEAN_MANIFEST,
    "package-lock.json": CLEAN_LOCK,
    "docs/package.json": CLEAN_MANIFEST,
    "docs/package-lock.json": CLEAN_LOCK,
    ...files,
  };
  for (const [name, json] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), JSON.stringify(json));
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("check-no-file-deps", () => {
  it("is green on a tree with only registry specifiers", () => {
    expect(findFileDeps(tree({}))).toEqual([]);
  });

  it("is green when docs/ has no manifest or lockfile at all", () => {
    const root = tree({});
    rmSync(join(root, "docs"), { recursive: true });
    expect(findFileDeps(root)).toEqual([]);
  });

  const plantedManifest = { name: "x", dependencies: { "@ocx-sh/theme": "file:../theme" } };
  const plantedLock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@ocx-sh/theme": "file:../theme" } },
      "node_modules/@ocx-sh/theme": { resolved: "../theme", link: true },
    },
  };

  it.each([
    ["package.json", plantedManifest],
    ["package-lock.json", plantedLock],
    ["docs/package.json", plantedManifest],
    ["docs/package-lock.json", plantedLock],
  ])("is red on a planted local specifier in %s", (file, planted) => {
    const found = findFileDeps(tree({ [file]: planted })) as { file: string }[];
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((entry) => entry.file === file)).toBe(true);
  });

  it("flags a lockfile `resolved: file:` tarball path and a `link:` specifier", () => {
    const root = tree({
      "package-lock.json": { packages: { "node_modules/a": { resolved: "file:../a.tgz" } } },
      "package.json": { dependencies: { b: "link:../b" } },
    });
    expect(findFileDeps(root)).toEqual([
      { file: "package.json", path: "$.dependencies.b", value: "link:../b" },
      { file: "package-lock.json", path: "$.packages.node_modules/a.resolved", value: "file:../a.tgz" },
    ]);
  });

  it("scans arrays too (a workspaces-style list of specifiers)", () => {
    const root = tree({ "package.json": { bundleDependencies: ["file:../x"] } });
    expect(findFileDeps(root)).toEqual([
      { file: "package.json", path: "$.bundleDependencies[0]", value: "file:../x" },
    ]);
  });

  it("CLI: exits 1 naming the offender when red, 0 when green", () => {
    const red = spawnSync("node", [script, tree({ "package.json": plantedManifest })], {
      encoding: "utf8",
    });
    expect(red.status).toBe(1);
    expect(red.stderr).toContain("package.json $.dependencies.@ocx-sh/theme = file:../theme");
    const green = spawnSync("node", [script, tree({})], { encoding: "utf8" });
    expect(green.status).toBe(0);
    expect(green.stderr).toContain("check-no-file-deps: OK");
  });

  it("CLI: defaults to this repository's root when given no argument", () => {
    const result = spawnSync("node", [script], { encoding: "utf8" });
    expect([0, 1]).toContain(result.status);
    expect(result.stderr).toMatch(/check-no-file-deps: (OK|FAILED)/);
  });
});
