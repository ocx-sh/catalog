import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { DEFAULT_PINS } from "../../src/ci/pins.js";
import { renderCi } from "../../src/ci/render.js";
import { assertGithubInvariants } from "./invariants.js";
import { withTempDir } from "./helpers.js";

/** The 40-hex SHA half of a `DEFAULT_PINS` value, dropping its `  # vX` tag
 * comment — the bare ref a `uses:` line pins to. */
function shaOf(pin: string): string {
  return pin.slice(0, 40);
}

// C-901 — mutation tests. Each proves the structural invariant gate can go
// RED: take a real `renderCi` output, mutate it to violate exactly one of the
// four load-bearing CI-security invariants, and assert `assertGithubInvariants`
// rejects the mutation while accepting the untouched render. A green assertion
// no red input could ever fail is not a check — these supply the red input.
describe("C-901 generated-workflow security invariants can go RED", () => {
  it("accepts the real render and rejects a mutable (non-SHA) uses: ref", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const real = file?.content ?? "";

      expect(() => assertGithubInvariants(real)).not.toThrow();

      const mutated = real.replace(`@${shaOf(DEFAULT_PINS["actions/checkout"])}`, "@main");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/not SHA-pinned/);
    });
  });

  it("rejects a missing workflow-level permissions block", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const real = file?.content ?? "";

      const mutated = real.replace("permissions: {}\n", "");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/is missing \(inherits a broad default\)/);
    });
  });

  it("rejects an over-broad workflow-level permissions grant", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const real = file?.content ?? "";

      const mutated = real.replace("permissions: {}", "permissions: write-all");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/not default-deny/);
    });
  });

  it("rejects a job that escalates itself to a write scope", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const real = file?.content ?? "";

      // String.replace hits the first job's `contents: read` only — enough to
      // trip the per-job least-privilege guard on the build job.
      const mutated = real.replace("contents: read", "contents: write");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/exceeds read-only least privilege/);
    });
  });

  it("rejects a checkout step that persists credentials", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const real = file?.content ?? "";

      const mutated = real.replace("persist-credentials: false", "persist-credentials: true");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/persist-credentials/);
    });
  });

  it("holds for the bun render too (setup-bun swapped in for setup-node)", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github", packageManager: "bun" }, dir);
      const real = file?.content ?? "";

      expect(real).toContain("oven-sh/setup-bun@");
      expect(() => assertGithubInvariants(real)).not.toThrow();

      const mutated = real.replace(`@${shaOf(DEFAULT_PINS["oven-sh/setup-bun"])}`, "@v2");
      expect(mutated).not.toBe(real);
      expect(() => assertGithubInvariants(mutated)).toThrow(/not SHA-pinned/);
    });
  });
});

// C-902 — structural YAML assertions. Parse the rendered file and assert
// job/permissions/pin structure from the PARSED object, not a `toBe`/`toContain`
// on a hand-authored fixture string.
describe("C-902 rendered CI files satisfy the invariants structurally", () => {
  it("github render: default-deny top-level, read-only jobs, SHA-pinned uses, hardened checkout", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "github" }, dir);
      const workflow = parse(file?.content ?? "") as {
        permissions: unknown;
        jobs: Record<
          string,
          { permissions: unknown; steps: { uses?: string; with?: Record<string, unknown> }[] }
        >;
      };

      // Invariant 1: workflow-level default-deny.
      expect(workflow.permissions).toEqual({});

      // Both jobs the template renders are present and read-only (invariant 2).
      expect(Object.keys(workflow.jobs).sort()).toEqual(["build", "verify-catalog-ci"]);
      for (const job of Object.values(workflow.jobs)) {
        expect(job.permissions).toEqual({ contents: "read" });
      }

      // Invariant 4: every uses: ref is a 40-hex SHA; invariant 3: every
      // checkout persists no credentials.
      const usesRefs = Object.values(workflow.jobs)
        .flatMap((job) => job.steps)
        .filter((step) => step.uses !== undefined)
        .map((step) => step.uses as string);
      expect(usesRefs.length).toBeGreaterThan(0);
      for (const uses of usesRefs) {
        expect(uses).toMatch(/@[0-9a-f]{40}$/);
      }
      const checkoutSteps = Object.values(workflow.jobs)
        .flatMap((job) => job.steps)
        .filter((step) => step.uses?.startsWith("actions/checkout@"));
      expect(checkoutSteps.length).toBeGreaterThan(0);
      for (const step of checkoutSteps) {
        expect(step.with?.["persist-credentials"]).toBe(false);
      }
    });
  });

  // GitLab decision: NOT byte-pinned. The four invariants (workflow
  // `permissions: {}`, per-job least privilege, `persist-credentials: false`,
  // SHA-pinned `uses:`) are GitHub-Actions concepts with no GitLab-CI
  // equivalent — GitLab has no permissions model, no `uses:` action refs (it
  // runs `image:` + `script:`), and no checkout step (the runner clones
  // automatically). So this asserts GitLab's real structure AND that none of
  // those GitHub keys leak into the render, from the parsed object.
  it("gitlab render: real structure present, and no GitHub-invariant surface leaks in", async () => {
    await withTempDir(async (dir) => {
      const [file] = await renderCi({ forge: "gitlab" }, dir);
      const pipeline = parse(file?.content ?? "") as Record<string, { image?: unknown }>;

      expect(Object.keys(pipeline).sort()).toEqual(["catalog:build", "catalog:verify"]);
      for (const job of Object.values(pipeline)) {
        expect(typeof job.image).toBe("string");
        expect(job.image).not.toBe("");
      }

      // The GitHub-only invariant keys have no GitLab surface: prove they are
      // absent from the parsed structure, not merely from the raw bytes.
      const serialized = JSON.stringify(pipeline);
      expect(serialized).not.toContain("permissions");
      expect(serialized).not.toContain("uses");
      expect(serialized).not.toContain("persist-credentials");
    });
  });
});
