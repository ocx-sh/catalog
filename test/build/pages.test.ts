import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createScratchRoot } from "../../src/build/scratch.js";
import { synthesizePages, type PackageRoute } from "../../src/build/pages.js";
import { parse as parseYaml } from "yaml";
import { writeDocsFixture, writeNestedDocsFixture, writePublicDirFixture } from "./helpers.js";

const SRC_DIR = "src";

/** True once `path` exists on disk (file or directory). */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs `fn` against a real scratch root, disposing it afterward regardless
 * of outcome — every test in this file gets its own tree, never shared
 * mutable state. */
async function withScratch<T>(fn: (scratchRoot: string) => Promise<T>): Promise<T> {
  const root = await createScratchRoot();
  try {
    return await fn(root.path);
  } finally {
    await root.dispose();
  }
}

/** A root:true source's route: the URL segments ARE the wire identity, so
 * the namespace/package pair is read straight back off them. */
function route(segments: readonly string[]): PackageRoute {
  return {
    segments,
    namespace: segments[0]!,
    package: segments.slice(1).join("/"),
    wireBase: "",
  };
}

describe("C-005 synthesizePages — always-on root/404 pages", () => {
  it("always writes index.md with layout: catalog, even with zero packages", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [] });
      const content = await readFile(join(scratchRoot, SRC_DIR, "index.md"), "utf8");
      expect(content).toMatch(/^\s*layout:\s*catalog\s*$/m);
    });
  });

  it("always writes 404.md, so VitePress emits a 404 route", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [] });
      expect(await exists(join(scratchRoot, SRC_DIR, "404.md"))).toBe(true);
    });
  });
});

describe("C-005 synthesizePages — publicDir mount", () => {
  it("mounts the resolved publicDir at <srcDir>/public/, preserving nested content", async () => {
    await withScratch(async (scratchRoot) => {
      const publicDirSource = await writePublicDirFixture(scratchRoot);
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [], publicDirSource });

      const topLevel = join(scratchRoot, SRC_DIR, "public", "favicon.svg");
      const nested = join(scratchRoot, SRC_DIR, "public", "nested", "logo.svg");
      expect(await exists(topLevel)).toBe(true);
      expect(await exists(nested)).toBe(true);
      expect(await readFile(nested, "utf8")).toBe(await readFile(join(publicDirSource, "nested", "logo.svg"), "utf8"));
    });
  });

  it("omitting publicDirSource mounts nothing under public/", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [] });
      expect(await exists(join(scratchRoot, SRC_DIR, "public"))).toBe(false);
    });
  });
});

describe("C-005/S-008 synthesizePages — depth-N -> file mapping", () => {
  it("depth 1 (namespace only) writes <srcDir>/<ns>.md", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["standalone"])] });
      expect(await exists(join(scratchRoot, SRC_DIR, "standalone.md"))).toBe(true);
    });
  });

  it("depth 2 (namespace/package) writes <srcDir>/<ns>/<pkg>.md", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
      expect(await exists(join(scratchRoot, SRC_DIR, "kitware", "cmake.md"))).toBe(true);
    });
  });

  it("depth 3+ writes one file at the full segment path — S-008's named case (p/a/b/c.json => route /a/b/c)", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["a", "b", "c"])] });
      expect(await exists(join(scratchRoot, SRC_DIR, "a", "b", "c.md"))).toBe(true);
    });
  });

  it("route/file mapping is opaque-segment based, never a two-segment split", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["a", "b", "c"])] });
      // Never collapsed to a [ns]/[pkg]-shaped two-segment file...
      expect(await exists(join(scratchRoot, SRC_DIR, "a", "b.md"))).toBe(false);
      // ...and never expanded into a nested index page either — exactly the
      // one file at the exact segment path.
      expect(await exists(join(scratchRoot, SRC_DIR, "a", "b", "c", "index.md"))).toBe(false);
      expect(await exists(join(scratchRoot, SRC_DIR, "a", "b", "c.md"))).toBe(true);
    });
  });

  it("synthesizes every package in one call, at depths 1/2/3+ together, without cross-contamination", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({
        scratchRoot,
        srcDir: SRC_DIR,
        packages: [route(["standalone"]), route(["kitware", "cmake"]), route(["a", "b", "c"])],
      });
      expect(await exists(join(scratchRoot, SRC_DIR, "standalone.md"))).toBe(true);
      expect(await exists(join(scratchRoot, SRC_DIR, "kitware", "cmake.md"))).toBe(true);
      expect(await exists(join(scratchRoot, SRC_DIR, "a", "b", "c.md"))).toBe(true);
    });
  });

  it("a zero-package call still succeeds (no packages resolved yet is a valid interim state)", async () => {
    await withScratch(async (scratchRoot) => {
      await expect(synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [] })).resolves.not.toThrow();
    });
  });

  // Layout.vue (WP-03, verbatim-lifted, already merged) dispatches purely on
  // `frontmatter.layout` ('catalog' | 'detail' | else DocLayout) — without
  // `layout: detail`, a synthesized package page would silently fall through
  // to DocLayout instead of rendering DetailPage.vue. pages.ts's own
  // docblock never mentions this frontmatter key (it only discusses the
  // now-REFUTED `params` field — see this WP's report), but it's a hard
  // requirement of already-merged code, not a guess.
  it("each synthesized package page's frontmatter sets layout: detail", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
      const content = await readFile(join(scratchRoot, SRC_DIR, "kitware", "cmake.md"), "utf8");
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toMatch(/^\s*layout:\s*detail\s*$/m);
    });
  });

  // The multi-source mount prefix's ONLY channel to the browser: a
  // client-side wire fetch on a detail page has no other way to learn that
  // its source was mirrored under `index/<label>/` rather than at the site
  // root. DetailPage.vue reads this key back off `useData().frontmatter` and
  // hands it to usePackageRoot / useImageIndex / utils/cas.ts.
  it("a non-root source's page carries its wireBase in frontmatter", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({
        scratchRoot,
        srcDir: SRC_DIR,
        packages: [
          {
            segments: ["corp", "kitware", "cmake"],
            namespace: "kitware",
            package: "cmake",
            wireBase: "index/corp",
          },
        ],
      });
      // The FILE lives at the index-qualified route, while `ns`/`pkg` stay
      // the wire identity — a CAS URL built from the route would ask for a
      // namespace called `corp`, which does not exist.
      const content = await readFile(join(scratchRoot, SRC_DIR, "corp", "kitware", "cmake.md"), "utf8");
      expect(content).toMatch(/^\s*layout:\s*detail\s*$/m);
      expect(content).toMatch(/^\s*ns:\s*"kitware"\s*$/m);
      expect(content).toMatch(/^\s*pkg:\s*"cmake"\s*$/m);
      expect(content).toMatch(/^\s*wireBase:\s*"index\/corp"\s*$/m);
    });
  });

  // The root:true source keeps byte-identical frontmatter to what this
  // function wrote before wireBase existed — an emitted `wireBase: ''` would
  // be dead weight on every page of the single-source case that is the
  // overwhelming majority of deployments.
  it("the root:true source's page omits the wireBase key entirely", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
      const content = await readFile(join(scratchRoot, SRC_DIR, "kitware", "cmake.md"), "utf8");
      expect(content).toBe('---\nlayout: detail\nns: "kitware"\npkg: "cmake"\n---\n');
    });
  });

  // Regression guard for a fixture-drift class this repo has actually hit:
  // `namespace`/`package` are required PackageRoute fields, but nothing
  // stops a test helper from building one without them — TypeScript can't
  // catch it (test/ isn't in tsconfig.json's include, subsystem-tests.md),
  // so a missing field only fails at `npm test` time, silently, as
  // `undefined` interpolated straight into a page's frontmatter.
  it("a synthesized page's frontmatter never carries the literal string undefined", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route(["kitware", "cmake"])] });
      const content = await readFile(join(scratchRoot, SRC_DIR, "kitware", "cmake.md"), "utf8");
      expect(content).not.toMatch(/:\s*"?undefined"?/);
    });
  });

  // A `path`/`git` source's namespace and package segments are real directory
  // names, and `extractPackages` validates neither — `assertSafePackagePath`
  // sits behind `casUrl`'s null-digest early return, so a package with no
  // `desc` block reaches page synthesis unchecked. A dirent may legally
  // contain `'` and a newline on every filesystem this runs on.
  //
  // Hand-quoting with `'…'` therefore let such a name CLOSE the quote and
  // append frontmatter keys of its own. `head:` is the one that matters:
  // VitePress renders it into the built page's `<head>`, so a source this
  // renderer only mirrors could put its own `<script>` on the page. The
  // `_headers` sandbox does not cover synthesized pages.
  //
  // `JSON.stringify` is the fix — YAML 1.2 is a JSON superset, so the value
  // can only parse back as one string, whatever bytes it holds.
  describe("frontmatter escaping — untrusted wire segments cannot inject a key", () => {
    const HOSTILE_NS = 'x\'\nhead:\n  - - script\n    - {}\n    - "alert(document.domain)"\nz: \'';

    it("a namespace carrying a quote and newlines stays one scalar", async () => {
      await withScratch(async (scratchRoot) => {
        const hostile: PackageRoute = {
          segments: ["safe", "widget"],
          namespace: HOSTILE_NS,
          package: "widget",
          wireBase: "",
        };
        await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [hostile] });
        const content = await readFile(join(scratchRoot, SRC_DIR, "safe", "widget.md"), "utf8");

        const parsed = parseYaml(content.replace(/^---\n/, "").replace(/---\n$/, "")) as Record<string, unknown>;
        // The whole assertion: no THIRD key appeared. `head` is what an
        // injection would add, and it is the one that executes.
        expect(Object.keys(parsed)).toEqual(["layout", "ns", "pkg"]);
        expect(parsed.ns).toBe(HOSTILE_NS);
        expect(parsed.head).toBeUndefined();
      });
    });

    it("a package segment carrying a quote and newlines stays one scalar", async () => {
      await withScratch(async (scratchRoot) => {
        const hostile: PackageRoute = {
          segments: ["safe", "other"],
          namespace: "safe",
          package: HOSTILE_NS,
          wireBase: "",
        };
        await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [hostile] });
        const content = await readFile(join(scratchRoot, SRC_DIR, "safe", "other.md"), "utf8");

        const parsed = parseYaml(content.replace(/^---\n/, "").replace(/---\n$/, "")) as Record<string, unknown>;
        expect(Object.keys(parsed)).toEqual(["layout", "ns", "pkg"]);
        expect(parsed.pkg).toBe(HOSTILE_NS);
      });
    });

    // `wireBase` is label-derived and so far better constrained, but it rides
    // the same channel and is escaped by the same rule — one mechanism, no
    // per-field reasoning about which values happen to be safe today.
    it("wireBase is escaped on the same terms", async () => {
      await withScratch(async (scratchRoot) => {
        const route: PackageRoute = {
          segments: ["corp", "safe", "widget"],
          namespace: "safe",
          package: "widget",
          wireBase: 'index/corp\nhead: "x"',
        };
        await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [route] });
        const content = await readFile(join(scratchRoot, SRC_DIR, "corp", "safe", "widget.md"), "utf8");

        const parsed = parseYaml(content.replace(/^---\n/, "").replace(/---\n$/, "")) as Record<string, unknown>;
        expect(Object.keys(parsed)).toEqual(["layout", "ns", "pkg", "wireBase"]);
      });
    });
  });
});

describe("C-005/S-006 synthesizePages — docs mount placement", () => {
  it("mounts the resolved docs directory at <srcDir>/docs/, preserving its content", async () => {
    await withScratch(async (scratchRoot) => {
      const docsSourceDir = await writeDocsFixture(scratchRoot);
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [], docsSourceDir });

      const mounted = join(scratchRoot, SRC_DIR, "docs", "guide.md");
      expect(await exists(mounted)).toBe(true);
      const [original, copy] = await Promise.all([
        readFile(join(docsSourceDir, "guide.md"), "utf8"),
        readFile(mounted, "utf8"),
      ]);
      expect(copy).toBe(original);
    });
  });

  it("omitting docsSourceDir mounts nothing under docs/", async () => {
    await withScratch(async (scratchRoot) => {
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [] });
      expect(await exists(join(scratchRoot, SRC_DIR, "docs"))).toBe(false);
    });
  });

  it("a NESTED docs tree (subdirectory content, S-006's named case) is mounted in full, not just its top-level files", async () => {
    await withScratch(async (scratchRoot) => {
      const docsSourceDir = await writeNestedDocsFixture(scratchRoot);
      await synthesizePages({ scratchRoot, srcDir: SRC_DIR, packages: [], docsSourceDir });

      const topLevel = join(scratchRoot, SRC_DIR, "docs", "guide.md");
      const nested = join(scratchRoot, SRC_DIR, "docs", "guides", "sub.md");
      expect(await exists(topLevel)).toBe(true);
      expect(await exists(nested)).toBe(true);
      expect(await readFile(nested, "utf8")).toBe(await readFile(join(docsSourceDir, "guides", "sub.md"), "utf8"));
    });
  });
});

/*
 * NOT covered here (design gaps flagged in the WP-06 report, not invented
 * into assertions against an interface that doesn't expose them):
 *
 * - "a root whose name prefix mismatches its path -> build error naming
 *   both" (S-008, BuildError DATA per build/errors.ts's own doc example):
 *   `PackageRoute` carries only `segments`/`wireBase`, no `name` field to
 *   cross-check against a path — this validation cannot live in
 *   `synthesizePages` as currently typed. It belongs upstream (the source
 *   layer resolving wire roots into `PackageRoute[]`, or engine.ts's own
 *   pre-synthesis step), neither of which exists in this tree yet.
 * - Exact identity-encoding mechanism (how a rendered page communicates its
 *   own ns/pkg to DetailPage.vue) beyond the `layout: detail` frontmatter
 *   key: the STEP-0 spike REFUTED literal frontmatter `params` being read
 *   by `useData().params` on a plain (non-`[param]`) file — see the WP-06
 *   report for the empirical evidence. The documented fallback
 *   (`useData().page.relativePath`) needs no frontmatter at all, so this
 *   file does not assert on any specific extra frontmatter key for identity.
 */
