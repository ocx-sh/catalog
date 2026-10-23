import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogJsonMentions, FIXTURE_DIR, listTree, normalizeAssetPath, runCli, treeHash } from "./helpers.js";

/** The harness's own pins: a hash that cannot go red, or a normaliser that eats real names, would hide drift in every suite. */

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("treeHash", () => {
  it("is equal for an identical copy and red for a one-byte change, an added file and an excluded path", async () => {
    const a = await mkdtemp(join(tmpdir(), "accept-hash-a-"));
    const b = join(await mkdtemp(join(tmpdir(), "accept-hash-b-")), "copy");
    cleanup.push(a, join(b, ".."));
    await cp(join(FIXTURE_DIR, "public-fixture"), a, { recursive: true });
    await cp(a, b, { recursive: true });

    const before = await treeHash(a);
    expect(await treeHash(b)).toBe(before);

    await writeFile(join(b, "favicon.svg"), "<svg/>x");
    expect(await treeHash(b)).not.toBe(before);
    expect(await treeHash(b, { exclude: ["favicon.svg"] })).toBe(await treeHash(a, { exclude: ["favicon.svg"] }));

    await writeFile(join(a, "extra.txt"), "x");
    expect(await listTree(a)).toContain("extra.txt");
    expect(await treeHash(a)).not.toBe(before);
  });
});

describe("normalizeAssetPath", () => {
  it.each([
    ["_astro/create-machine.CGqJIen6.js", "_astro/create-machine.js"],
    ["_astro/collapsible.zag.-Hn5w3Fk.js", "_astro/collapsible.zag.js"],
    ["_astro/ibm-plex-sans-greek-400-normal._efipK4i.woff2", "_astro/ibm-plex-sans-greek-400-normal.woff2"],
    ["favicon.svg", "favicon.svg"],
    ["p/cloud/helm-lite.json", "p/cloud/helm-lite.json"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeAssetPath(input)).toBe(expected);
  });
});

describe("runCli", () => {
  it("runs the shipped CLI and returns its exit code", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("build");
  });
});

describe("catalogJsonMentions", () => {
  const footer = '<footer><a href="/data/catalog/catalog.json">catalog json</a></footer>';

  it("ignores the footer link, and is red for a preload, a script or a data attribute naming catalog.json", () => {
    expect(catalogJsonMentions(`<html><body>${footer}</body></html>`)).toEqual([]);
    expect(catalogJsonMentions(`<html><head><link rel="preload" href="/data/catalog/catalog.json"></head><body>${footer}</body></html>`)).toHaveLength(1);
    expect(catalogJsonMentions(`<html><body><script>fetch("/data/catalog/catalog.json")</script></body></html>`)).toHaveLength(1);
    expect(catalogJsonMentions(`<html><body><div data-src="/data/catalog/catalog.json"></div></body></html>`)).toHaveLength(1);
    expect(catalogJsonMentions(`<html><body><a href="/data/catalog/catalog.json">outside the footer</a></body></html>`)).toHaveLength(1);
  });
});
