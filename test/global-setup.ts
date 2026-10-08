import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Builds `dist/` once per vitest run, however many projects ask for it. The
 * promise lives on `globalThis` because the unit and acceptance projects each
 * load their own copy of a setup module; the shared main process is what makes
 * "once" true across them.
 */
const DIST_BUILD = Symbol.for("ocx-catalog.test.distBuild");

export function ensureDist(): void {
  const shared = globalThis as { [DIST_BUILD]?: true };
  if (shared[DIST_BUILD]) return;
  const build = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`npm run build failed: ${build.stderr}${build.stdout}`);
  }
  shared[DIST_BUILD] = true;
}

/**
 * The UNIT setup (vitest `unit` project's `globalSetup`): runs once in the
 * main process before any test file/worker starts — compiles src -> dist so
 * both the bin-shim subprocess smoke (test/cli.test.ts) and the
 * pack-verification gate (test/package.test.ts) see a consistent dist/.
 * Previously test/cli.test.ts rebuilt dist/ itself from a `beforeAll`, which
 * ran concurrently with test/package.test.ts's `npm pack` in a sibling worker
 * — a real race (`npm pack` catching dist/ mid-rewrite, intermittently
 * missing files). It builds no site: the acceptance project's own setup
 * (test/acceptance/global-setup.ts) does that, and only when acceptance files
 * are selected.
 */
export default function setup() {
  ensureDist();
}
