/**
 * Spec tests for `src/sources/mirror.ts` (C-006 + C-004's per-source
 * placement). MUST fail against the `throw new Error("not implemented")`
 * stubs.
 *
 * PIN (byte-gate critical, per C-004's multi-source model doc comment):
 * `mirrorSources` sorts `extractPackages(source.files)` by qualified
 * package id (`${namespace}/${package}`, lexicographic — `catalog.ts`
 * `catalogIndex`'s own doc: "this function does not itself sort") BEFORE
 * calling `catalogIndex`. Verified against the reference implementation:
 * the index bot's `build_render_plan` (`bot/src/indexbot/core/render.py:329`)
 * does `sorted(packages, key=lambda source: str(source.package_id))`, and
 * `PackageId.__str__` (`bot/src/indexbot/model.py:127-128`) is exactly
 * `f"{self.namespace}/{self.package}"` — plain Python string (== Unicode
 * code point) ordering. `mirror.ts`'s own doc comment already states this
 * sort explicitly; the test below constructs package roots in a
 * DELIBERATELY non-alphabetical `files` Map insertion order to prove the
 * output order comes from the sort, not from map/object iteration order.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareQualifiedIds, mirrorSources, renderHeaders } from "../../src/sources/mirror.js";
import type { ResolvedSourceFiles, WirePath } from "../../src/sources/types.js";
import { bytesEqual, rootJsonBytes, sha256Digest, utf8 } from "./helpers.js";

function source(
  label: string,
  root: boolean,
  entries: readonly (readonly [WirePath, Uint8Array])[],
): ResolvedSourceFiles {
  return { label, root, files: new Map(entries) };
}

const cleanupDirs: string[] = [];

async function tempDistDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readAt(distDir: string, relPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(distDir, relPath)));
}

// Alpha's config.json in a deliberately odd JSON layout — the byte-verbatim
// assertions below would still pass a "parse and pretty-print" bug unless
// the fixture bytes are non-canonical.
const ALPHA_CONFIG = utf8('{ "format_version" : 1 }');
const BETA_CONFIG = utf8('{"format_version":1}');

function alphaSource(): ResolvedSourceFiles {
  // Package roots inserted in Map order zzz, aaa, mmm — none alphabetical —
  // to prove catalog.json's sort comes from mirrorSources, not iteration
  // order.
  return source("alpha", false, [
    ["config.json", ALPHA_CONFIG],
    ["c/index.json", utf8('{"format_version":1,"packages":{}}')],
    ["p/zzz/pkg.json", rootJsonBytes({ name: "ocx.sh/zzz/pkg" })],
    ["p/aaa/pkg.json", rootJsonBytes({ name: "ocx.sh/aaa/pkg" })],
    ["p/mmm/pkg.json", rootJsonBytes({ name: "ocx.sh/mmm/pkg" })],
  ]);
}

function betaSource(): ResolvedSourceFiles {
  return source("beta", true, [
    ["config.json", BETA_CONFIG],
    ["c/index.json", utf8('{"format_version":1,"packages":{}}')],
    ["p/beta-ns/thing.json", rootJsonBytes({ name: "ocx.sh/beta-ns/thing" })],
  ]);
}

describe("mirrorSources — byte-verbatim copy under dist/index/<label>/", () => {
  it("copies every source's files byte-verbatim, unconditionally, even for a root source", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([alphaSource(), betaSource()], distDir);

    expect(bytesEqual(await readAt(distDir, "index/alpha/config.json"), ALPHA_CONFIG)).toBe(true);
    expect(bytesEqual(await readAt(distDir, "index/beta/config.json"), BETA_CONFIG)).toBe(true);
    expect(
      bytesEqual(
        await readAt(distDir, "index/alpha/p/zzz/pkg.json"),
        rootJsonBytes({ name: "ocx.sh/zzz/pkg" }),
      ),
    ).toBe(true);
  });

  it("root: true additionally copies the SAME files to dist root, on top of (not instead of) dist/index/<label>/", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([alphaSource(), betaSource()], distDir);

    // Additional root copy.
    expect(bytesEqual(await readAt(distDir, "config.json"), BETA_CONFIG)).toBe(true);
    expect(
      bytesEqual(await readAt(distDir, "p/beta-ns/thing.json"), rootJsonBytes({ name: "ocx.sh/beta-ns/thing" })),
    ).toBe(true);
    // Never a substitute — index/beta/ copy still exists too.
    expect(bytesEqual(await readAt(distDir, "index/beta/config.json"), BETA_CONFIG)).toBe(true);

    // The non-root source's tree is NEVER also written at dist root.
    await expect(readAt(distDir, "p/zzz/pkg.json")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("no source is skipped — there is no serve flag; a non-root source still gets its full mirror copy", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([alphaSource()], distDir);

    expect(bytesEqual(await readAt(distDir, "index/alpha/p/aaa/pkg.json"), rootJsonBytes({ name: "ocx.sh/aaa/pkg" }))).toBe(
      true,
    );
  });
});

describe("mirrorSources — per-source catalog.json, sorted by qualified package id", () => {
  it("places a non-root source's catalog at /index/<label>/data/catalog/catalog.json, packages sorted lexicographically", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([alphaSource()], distDir);

    const raw = await readAt(distDir, "index/alpha/data/catalog/catalog.json");
    const catalog = JSON.parse(new TextDecoder().decode(raw)) as { packages: { namespace: string; package: string }[] };
    const qualifiedIds = catalog.packages.map((p) => `${p.namespace}/${p.package}`);

    expect(qualifiedIds).toEqual(["aaa/pkg", "mmm/pkg", "zzz/pkg"]);
  });

  it("places a root source's catalog at /data/catalog/catalog.json", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([betaSource()], distDir);

    const raw = await readAt(distDir, "data/catalog/catalog.json");
    const catalog = JSON.parse(new TextDecoder().decode(raw)) as { packages: unknown[] };

    expect(catalog.packages).toHaveLength(1);
  });

  // A per-source catalog sits at `/index/<label>/data/catalog/catalog.json`
  // and is read by a browser at that URL, so the asset links inside it must
  // resolve against the SAME prefix the loop just wrote this source's files
  // to. Emitting `/p/...` here pointed every logo and README at the root
  // source's tree — a different source's packages entirely, or a 404.
  it("a non-root source's catalog links assets under its own /index/<label>/ prefix", async () => {
    const distDir = await tempDistDir();
    const logo = utf8("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const logoHex = sha256Digest(logo).slice("sha256:".length);
    await mirrorSources(
      [
        source("alpha", false, [
          [
            "p/aaa/pkg.json",
            rootJsonBytes({
              name: "ocx.sh/aaa/pkg",
              desc: { title: "Pkg", description: "", keywords: [], logo: sha256Digest(logo) },
            }),
          ],
          [`p/aaa/pkg/o/sha256/${logoHex}.svg`, logo],
        ]),
      ],
      distDir,
    );

    const raw = await readAt(distDir, "index/alpha/data/catalog/catalog.json");
    const catalog = JSON.parse(new TextDecoder().decode(raw)) as { packages: { logoUrl: string | null }[] };

    expect(catalog.packages[0]?.logoUrl).toBe(`/index/alpha/p/aaa/pkg/o/sha256/${logoHex}.svg`);
    // And the bytes really are there, so the URL is not merely well-formed.
    await expect(readAt(distDir, `index/alpha/p/aaa/pkg/o/sha256/${logoHex}.svg`)).resolves.toEqual(logo);
  });

  it("never writes catalog.json into the source's own mirrored tree (it is a derived artifact, not part of files)", async () => {
    const distDir = await tempDistDir();
    await mirrorSources([alphaSource()], distDir);

    await expect(readAt(distDir, "index/alpha/catalog.json")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("mirrorSources — return value", () => {
  it("MirrorResult.written lists the paths this run wrote", async () => {
    const distDir = await tempDistDir();
    const result = await mirrorSources([alphaSource()], distDir);

    expect(result.written).toContain("index/alpha/config.json");
    expect(result.written).toContain("index/alpha/p/aaa/pkg.json");
    expect(result.written).toContain("index/alpha/data/catalog/catalog.json");
  });
});

describe("renderHeaders", () => {
  it("emits the leading /p/* sandbox block only when a root: true source is present, before every /index/<label>/p/* block", () => {
    const headers = renderHeaders([alphaSource(), betaSource()]);
    const rootBlock = "/p/*\n  Content-Security-Policy: sandbox\n  X-Content-Type-Options: nosniff";
    const alphaBlock =
      "/index/alpha/p/*\n  Content-Security-Policy: sandbox\n  X-Content-Type-Options: nosniff";
    const betaBlock = "/index/beta/p/*\n  Content-Security-Policy: sandbox\n  X-Content-Type-Options: nosniff";

    expect(headers).toContain(rootBlock);
    expect(headers).toContain(alphaBlock);
    expect(headers).toContain(betaBlock);
    expect(headers.indexOf(rootBlock)).toBeLessThan(headers.indexOf(alphaBlock));
    expect(headers.indexOf(rootBlock)).toBeLessThan(headers.indexOf(betaBlock));
  });

  it("omits the /p/* block entirely when no source sets root: true", () => {
    const headers = renderHeaders([alphaSource()]);
    const lines = headers.split("\n");

    expect(lines).not.toContain("/p/*");
    expect(headers).toContain("/index/alpha/p/*");
  });

  it("emits exactly one block per distinct label — none for a label with no source", () => {
    const headers = renderHeaders([alphaSource()]);
    const sandboxLineCount = headers.split("\n").filter((line) => line.trim() === "Content-Security-Policy: sandbox")
      .length;

    // Exactly one block: /index/alpha/p/* (no root source, so no bare /p/*).
    expect(sandboxLineCount).toBe(1);
    expect(headers).not.toContain("/index/beta/");
  });
});

describe("mirrorSources — writeDistFile containment backstop (BLOCK A belt-and-braces, 2026-08-22)", () => {
  // walker.ts's assertSafeQualifiedId is the primary fix (rejects a
  // traversal key before any wire path is even built), but this backstop is
  // what actually protects the filesystem if a future caller of
  // writeDistFile ever skips that upstream validation — so it's exercised
  // directly here, at the layer that performs the write.
  it("rejects a source.files key that resolves outside distDir, and never creates the escaped file", async () => {
    const distDir = await tempDistDir();
    const escapePath = "../".repeat(20) + "tmp/canary";
    const malicious = source("evil", false, [["config.json", utf8("{}")], [escapePath, utf8("pwned")]]);

    await expect(mirrorSources([malicious], distDir)).rejects.toThrow(/outside dist dir/);

    // The canary must never land anywhere on disk — in particular not at the
    // exact traversal target the PoC used (20 "../" from a deep tmp dir
    // resolves above filesystem root, so join() clamps it at "/tmp/canary").
    await expect(readFile(join(tmpdir(), "canary"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("mirrorSources — oversized CAS asset is skipped and warned (C-405)", () => {
  // The MAX_CAS_ASSET_BYTES cap is 1 MiB; a content blob one byte past it is
  // not served. A `.json` under o/sha256 (an OCI image index) is structural
  // and NOT capped — skipping it would dangle a package, unlike a logo.
  const OVER_CAP = new Uint8Array(1024 * 1024 + 1);
  const HEX = "a".repeat(64);

  function sourceWithOversizedLogo(): ResolvedSourceFiles {
    return source("alpha", false, [
      ["config.json", utf8("{}")],
      ["p/ns/pkg.json", rootJsonBytes({ name: "ocx.sh/ns/pkg" })],
      [`p/ns/pkg/o/sha256/${HEX}.svg`, OVER_CAP],
      [`p/ns/pkg/o/sha256/${"b".repeat(64)}.md`, utf8("# small readme")],
    ]);
  }

  it("skips the oversized blob (never on disk, absent from written) but keeps a normal one, and warns by name", async () => {
    const distDir = await tempDistDir();
    const warn = vi.fn();

    const result = await mirrorSources([sourceWithOversizedLogo()], distDir, warn);

    await expect(readAt(distDir, `index/alpha/p/ns/pkg/o/sha256/${HEX}.svg`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.written).not.toContain(`index/alpha/p/ns/pkg/o/sha256/${HEX}.svg`);
    // The under-cap readme and the root are still mirrored.
    expect(bytesEqual(await readAt(distDir, `index/alpha/p/ns/pkg/o/sha256/${"b".repeat(64)}.md`), utf8("# small readme"))).toBe(
      true,
    );
    expect(result.written).toContain("index/alpha/p/ns/pkg.json");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`p/ns/pkg/o/sha256/${HEX}.svg`);
  });

  it("warns to stderr by default when no warn sink is passed (production path)", async () => {
    const distDir = await tempDistDir();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    let emitted: string;
    try {
      await mirrorSources([sourceWithOversizedLogo()], distDir);
      // Capture BEFORE mockRestore — it clears mock.calls.
      emitted = stderr.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      stderr.mockRestore();
    }

    expect(emitted).toContain(`p/ns/pkg/o/sha256/${HEX}.svg`);
  });
});

describe("compareQualifiedIds", () => {
  // A real three-way comparator, unit-tested directly: `mirrorSources`'s own
  // call path can never produce two packages with the same qualified id
  // (each comes from one unique `files` Map key), so the tie case has no
  // reachable test through `mirrorSources` itself — see the function's own
  // doc comment.
  it("orders by qualified id ascending", () => {
    const a = { packageId: { namespace: "aaa", package: "pkg" } };
    const b = { packageId: { namespace: "zzz", package: "pkg" } };
    expect(compareQualifiedIds(a, b)).toBeLessThan(0);
    expect(compareQualifiedIds(b, a)).toBeGreaterThan(0);
  });

  it("returns exactly 0 for equal qualified ids (a real tie, not a two-outcome shortcut)", () => {
    const a = { packageId: { namespace: "ns", package: "pkg" } };
    const b = { packageId: { namespace: "ns", package: "pkg" } };
    expect(compareQualifiedIds(a, b)).toBe(0);
  });
});

// Deliberately NOT tested: "two sources with the same label => error, never
// a silent overwrite". mirror.ts's own doc comment explicitly disclaims
// this — "Trusts, rather than re-checks ... every source.label is already
// unique ... a caller that skips those steps before calling this function
// gets undefined (not safety-checked here a second time) behavior." Writing
// a test that demands an error here would assert behavior the design record
// says mirrorSources will NOT provide. Duplicate-label rejection is already
// covered at its documented layer: labels.ts's checkLabelConflicts
// (test/sources/labels.test.ts) — flagged as a design-record note, not
// invented.
