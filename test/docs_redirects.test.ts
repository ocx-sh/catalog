import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * C-048 / S-019: once ocx.sh/apps/catalog/ serves the docs, every old
 * ocx-sh.github.io/catalog/<page>/ URL must serve a meta-refresh stub to its
 * new counterpart. The tree is produced by the real entrypoint pages.yml's
 * `redirect-stubs` job runs (scripts/gen-docs-redirects.mjs) from
 * docs/redirects.json, and every target is checked against the docs CONTENT
 * tree (docs/src/content/docs), not a build, so this needs no docs build.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const contentRoot = join(repoRoot, "docs/src/content/docs");

// Every URL the MkDocs site served at the seam (the commit before the Starlight
// port), listed by hand on purpose: a page dropped from redirects.json must turn
// this red, so the list cannot be derived from the file under test.
const OLD_URLS = [
  "",
  "explanation/",
  "explanation/index-vs-catalog/",
  "explanation/multi-source-model/",
  "explanation/security-and-trust-model/",
  "how-to/",
  "how-to/configure-sources/",
  "how-to/customize-branding-and-docs/",
  "how-to/customize-components/",
  "how-to/deploy-on-github-pages/",
  "how-to/deploy-on-gitlab-pages/",
  "how-to/preview-locally-with-dev/",
  "how-to/quickstart/",
  "ops/",
  "ops/hosting-and-headers/",
  "ops/known-limitations/",
  "ops/troubleshooting/",
  "reference/",
  "reference/ci-rendering/",
  "reference/cli/",
  "reference/config-schema/",
  "reference/output-layout/",
  "reference/theme-tokens/",
];

interface RedirectConfig {
  from: string;
  to: string;
  anchors: string;
  redirects: Record<string, string>;
}

const config = JSON.parse(readFileSync(join(repoRoot, "docs/redirects.json"), "utf8")) as RedirectConfig;

/** Page paths ("" for the home page) Starlight serves for docs/src/content/docs/**. */
function contentPagePaths(): Set<string> {
  const pages = new Set<string>();
  for (const entry of readdirSync(contentRoot, { recursive: true, encoding: "utf8" })) {
    const m = /^(.*?)(?:\/?index)?\.mdx?$/.exec(entry);
    if (m) pages.add(m[1] === "" ? "" : `${m[1]}/`);
  }
  return pages;
}

describe("docs redirect stubs (C-048, S-019)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("has a redirect entry for every page the old site served", () => {
    const missing = OLD_URLS.filter((url) => !(url in config.redirects));
    expect(missing, "old URLs without a redirect entry").toEqual([]);
  });

  it("points every redirect at a page that exists in the docs content tree", () => {
    const pages = contentPagePaths();
    const dangling = Object.entries(config.redirects).filter(([, target]) => !pages.has(target));
    expect(dangling, "redirect targets with no page in docs/src/content/docs").toEqual([]);
  });

  it("writes a canonical meta-refresh stub for every old URL through the real entrypoint", () => {
    const out = mkdtempSync(join(tmpdir(), "docs-redirects-"));
    dirs.push(out);

    const run = spawnSync("node", ["scripts/gen-docs-redirects.mjs", "--out", out], { cwd: repoRoot, encoding: "utf8" });
    expect(run.status, `stderr: ${run.stderr}`).toBe(0);

    for (const oldUrl of OLD_URLS) {
      const target = `https://ocx.sh/apps/catalog/${config.redirects[oldUrl]}`;
      const stub = readFileSync(join(out, oldUrl, "index.html"), "utf8");
      expect(stub, `stub for /catalog/${oldUrl}`).toContain(`<meta http-equiv="refresh" content="0; url=${target}">`);
      expect(stub, `stub for /catalog/${oldUrl}`).toContain(`<link rel="canonical" href="${target}">`);
    }
  });

  it("refuses a page path that could escape the output directory", () => {
    const out = mkdtempSync(join(tmpdir(), "docs-redirects-"));
    dirs.push(out);
    const bad = mkdtempSync(join(tmpdir(), "docs-redirects-bad-"));
    dirs.push(bad);

    const run = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import { generateStubs } from ${JSON.stringify(join(repoRoot, "scripts/gen-docs-redirects.mjs"))};
         generateStubs({ to: "https://ocx.sh/apps/catalog/", redirects: { "../escape/": "" } }, ${JSON.stringify(out)});`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("invalid page path");
  });

  it("documents that anchors are not redirected, and never puts one in a URL", () => {
    expect(config.anchors).toMatch(/not redirected/);
    for (const [oldUrl, target] of Object.entries(config.redirects)) {
      expect(oldUrl + target, "a '#' in a redirect URL").not.toContain("#");
    }
  });
});
