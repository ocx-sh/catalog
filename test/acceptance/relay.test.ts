/**
 * C-046 render subprocess relay, through the CLI: every line the `astro` child
 * prints (stdout and stderr alike) reaches this process's STDERR prefixed
 * `ocx-catalog: `, stdout stays empty, and a non-zero
 * child exit is exit 1 with the child's own diagnostics relayed first.
 *
 * Needs the `root` site.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createProject, plantedFailure, runBuild, siteLog, type Project } from "./helpers.js";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

describe("C-046 relay prefix", () => {
  it("a successful build: stdout is empty, every stderr line is prefixed and Astro's build log is among them", () => {
    const log = siteLog("root");
    const output = lines(log.stderr);

    expect(log.code).toBe(0);
    expect(log.stdout).toBe("");
    expect(output.length).toBeGreaterThan(10);
    expect(output.filter((line) => !line.startsWith("ocx-catalog: "))).toEqual([]);
    expect(output.some((line) => line.includes("[build]"))).toBe(true);
    expect(output.some((line) => line.includes("Complete!"))).toBe(true);
  });

  it("a failing child: its stderr is relayed prefixed, then the CLI exits 1 naming the child's code", async () => {
    const project = await createProject();
    projects.push(project);

    const result = await runBuild(project.config, project.out, { env: plantedFailure("render", project.out) });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const stderr = lines(result.stderr);
    expect(stderr).toContain("ocx-catalog: planted astro failure");
    expect(stderr).toContain("ocx-catalog build: astro build exited with code 3");
    expect(stderr.indexOf("ocx-catalog: planted astro failure")).toBeLessThan(
      stderr.indexOf("ocx-catalog build: astro build exited with code 3"),
    );
  });
});
