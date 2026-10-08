/**
 * Static invariants on this repo's OWN CI lane (`.github/workflows/ci.yml`,
 * `pages.yml`) and the local `install-ocx-theme` action. Text-level on
 * purpose, like release_workflow.test.ts: no YAML parser is a dependency, and
 * each invariant is a line-shape one.
 *
 * Context (C-026): until `@ocx-sh/theme` 0.2.0 is on npm, the manifests carry
 * a local `file:` dependency no runner can resolve. Every job that installs
 * npm dependencies goes through the pinned install-ocx-theme action instead
 * of `npm ci`, and the `file-deps` job keeps the `file:` specifier off `main`.
 * Plan step I.1 removes the action, the guard's expected red and these tests'
 * TEMPORARY block together.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const ci = read(".github/workflows/ci.yml");
const pages = read(".github/workflows/pages.yml");
const action = read(".github/actions/install-ocx-theme/action.yml");

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

  it("the file-deps job says why it is red on the theme-port branch", () => {
    expect(ci).toMatch(/WILL be red on the theme-\s*#?\s*port branch's own PR/);
  });

  it("no job installs with a bare `npm ci` (it cannot follow the lockfile's local link)", () => {
    expect(ci).not.toMatch(/run: npm ci/);
  });

  it.each(["lint", "typecheck", "test", "pack-verify", "audit-signatures", "web-quality"])(
    "the %s job installs through the install-ocx-theme action",
    (name) => {
      expect(jobBlock(ci, name)).toContain("uses: ./.github/actions/install-ocx-theme");
    },
  );
});

describe("install-ocx-theme action — the TEMPORARY theme tarball install", () => {
  it("is marked temporary and removable by plan step I.1", () => {
    expect(action).toContain("TEMPORARY until @ocx-sh/theme 0.2.0 on npm");
    expect(action).toContain("plan step I.1");
  });

  it("checks out ocx-sh/website at one 40-hex SHA with SHA-pinned uses and no persisted credentials", () => {
    expect(action).toMatch(/repository: ocx-sh\/website\n\s+ref: [0-9a-f]{40}\n/);
    expect(action).toContain("persist-credentials: false");
    const uses = [...action.matchAll(/^\s+uses: (\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it("packs without scripts and installs over the file: dependency with npm install", () => {
    expect(action).toContain("npm pack");
    expect(action).toContain("--ignore-scripts");
    expect(action).toContain('pkg set "dependencies.@ocx-sh/theme=file:');
    expect(action).toMatch(/npm --prefix "\$PREFIX" install$/m);
  });

  it("passes inputs through env, never interpolated into the script", () => {
    expect(action).not.toMatch(/run: \|[\s\S]*\$\{\{ inputs\./);
  });

  it("pages.yml docs build uses the same action (one pin) for docs/", () => {
    expect(pages).toMatch(/uses: \.\/\.github\/actions\/install-ocx-theme\n\s+with:\n\s+prefix: docs/);
    expect(pages).not.toContain("repository: ocx-sh/website");
  });
});
