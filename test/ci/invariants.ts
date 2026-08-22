import { parse } from "yaml";

/**
 * Structural encoding of the four load-bearing output invariants the CI
 * renderer must never regress (AGENTS.md "Generated Files",
 * `.claude/rules/subsystem-ci-renderer.md` "Output invariants"). There is no
 * src-side validator for these today — the invariants live in the
 * hand-authored templates, and `pins.ts`' `COMMIT_SHA_RE` only guards
 * *carried-forward* pins, not the rendered whole. This helper is that missing
 * gate, kept test-side: parse the rendered YAML and assert each invariant from
 * the parsed object so a mutation is caught by shape, not by a fixture byte.
 *
 * Used both ways on purpose (see invariants.test.ts): GREEN against a real
 * `renderCi` output, RED against a render deliberately mutated to break one
 * invariant — the whole point being to prove each guard can go red, not just
 * that today's fixture happens to be green.
 */

/** A generated `uses:` ref must be a full 40-hex commit SHA — the same shape
 * `pins.ts`' `COMMIT_SHA_RE` enforces on carried-forward pins. YAML parsing
 * has already stripped the trailing `  # vX` tag comment, so the scalar is
 * exactly `owner/action@<ref>`. */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

interface WorkflowStep {
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  permissions?: unknown;
  steps?: WorkflowStep[];
}

interface Workflow {
  permissions?: unknown;
  jobs?: Record<string, WorkflowJob>;
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

/**
 * Throws an `Error` naming the first violated invariant, or returns normally
 * when all four hold, for a rendered GitHub Actions workflow:
 *
 *   1. workflow-level `permissions: {}` (default-deny),
 *   2. per-job least privilege — every job declares `permissions` and grants
 *      no write-level scope,
 *   3. `persist-credentials: false` on every `actions/checkout` step,
 *   4. every `uses:` ref is a 40-hex commit SHA.
 */
export function assertGithubInvariants(content: string): void {
  const workflow = parse(content) as Workflow;

  if (workflow.permissions === undefined) {
    throw new Error("invariant 1: workflow-level `permissions` is missing (inherits a broad default)");
  }
  if (!isEmptyObject(workflow.permissions)) {
    throw new Error("invariant 1: workflow-level `permissions` is not default-deny `{}`");
  }

  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    assertJobLeastPrivilege(jobName, job);
    for (const step of job.steps ?? []) {
      assertStepPinned(jobName, step);
      assertCheckoutHardened(jobName, step);
    }
  }
}

function assertJobLeastPrivilege(jobName: string, job: WorkflowJob): void {
  const permissions = job.permissions;
  if (permissions === undefined) {
    throw new Error(`invariant 2: job "${jobName}" declares no \`permissions\` (inherits a broad default)`);
  }
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    throw new Error(`invariant 2: job "${jobName}" \`permissions\` is not a scope map`);
  }
  for (const [scope, level] of Object.entries(permissions)) {
    if (level !== "read" && level !== "none") {
      throw new Error(`invariant 2: job "${jobName}" grants ${scope}: ${String(level)} — exceeds read-only least privilege`);
    }
  }
}

function assertStepPinned(jobName: string, step: WorkflowStep): void {
  if (step.uses === undefined) return;
  const ref = step.uses.slice(step.uses.lastIndexOf("@") + 1);
  if (!COMMIT_SHA_RE.test(ref)) {
    throw new Error(`invariant 4: job "${jobName}" step \`uses: ${step.uses}\` is not SHA-pinned`);
  }
}

function assertCheckoutHardened(jobName: string, step: WorkflowStep): void {
  if (step.uses === undefined || !step.uses.startsWith("actions/checkout@")) return;
  if (step.with?.["persist-credentials"] !== false) {
    throw new Error(`invariant 3: job "${jobName}" actions/checkout must set persist-credentials: false`);
  }
}
