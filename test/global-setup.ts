import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Runs once in the main process before any test file/worker starts (vitest
 * `globalSetup` contract) — compiles src -> dist so both the bin-shim
 * subprocess smoke (test/cli.test.ts) and the pack-verification gate
 * (test/package.test.ts) see a consistent dist/. Previously test/cli.test.ts
 * rebuilt dist/ itself from a `beforeAll`, which ran concurrently with
 * test/package.test.ts's `npm pack` in a sibling worker — a real race
 * (`npm pack` catching dist/ mid-rewrite, intermittently missing files).
 */
export default function setup() {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`npm run build failed: ${build.stderr}${build.stdout}`);
  }
}
