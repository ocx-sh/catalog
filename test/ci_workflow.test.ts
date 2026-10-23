/**
 * Static invariants on this repo's OWN CI lane (`.github/workflows/ci.yml`,
 * `pages.yml`). Text-level on purpose, like release_workflow.test.ts: no YAML
 * parser is a dependency, and each invariant is a line-shape one.
 *
 * Context (C-026): `@ocx-sh/theme` comes from npm, so every job installs with a
 * plain `npm ci`, and the `file-deps` job keeps a `file:` specifier off `main`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const ci = read(".github/workflows/ci.yml");
const pages = read(".github/workflows/pages.yml");

function jobBlock(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `job "${name}" not found`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("ci.yml — Node 24 and the file: guard (C-026)", () => {
  it("every job that sets up Node asks for Node 24", () => {
    const versions = [...ci.matchAll(/node-version: "(\d+)"/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(["24"]));
  });

  it("the file-deps job runs the guard on pull requests targeting main only", () => {
    const job = jobBlock(ci, "file-deps");
    expect(job).toContain("if: github.event_name == 'pull_request' && github.base_ref == 'main'");
    expect(job).toContain("run: task check:no-file-deps");
  });

  it.each(["lint", "typecheck", "test", "pack-verify", "audit-signatures", "web-quality"])("the %s job installs with a plain npm ci", (name) => {
    expect(jobBlock(ci, name)).toMatch(/- run: npm ci\n/);
  });

  it("no workflow uses the retired install-ocx-theme action", () => {
    expect(ci + pages).not.toContain("install-ocx-theme");
  });

  it("the docs build installs docs/ dependencies with npm ci", () => {
    expect(pages).toMatch(/- run: npm ci\n\s+working-directory: docs/);
  });
});
