import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderReadmes } from "../../src/build/readmes.js";
import { readSanitizedHtml } from "../../src/site/lib/sanitizedHtml.js";
import type { SiteModel } from "../../src/site/model/index.js";

const INDEX_B = fileURLToPath(new URL("../fixtures/site/index-b", import.meta.url));
const HOSTILE = "/p/hostile/readme/o/sha256/73bf7621173355e68eb275a065cd44c95fcb7307e479bbba03fa43b2a2963443.md";

const cleanup: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "readmes-"));
  cleanup.push(dir);
  return dir;
}

/** Only the fields `renderReadmes` reads. */
const modelOf = (readme: Record<string, string | null>): SiteModel =>
  ({
    routes: Object.keys(readme),
    readme,
    details: Object.fromEntries(Object.keys(readme).map((key) => [key, { name: `idx/${key}` }])),
  }) as unknown as SiteModel;

describe("renderReadmes", () => {
  it("writes the sanitised HTML of each route to <scratch>/readme/<hash>.html and returns the absolute paths", async () => {
    const root = await scratch();
    const files = await renderReadmes(root, INDEX_B, modelOf({ "hostile/readme": HOSTILE, "no/readme": null }));

    const file = files["hostile/readme"] as string;
    expect(file.startsWith(join(root, "readme") + "/")).toBe(true);
    expect(file).toMatch(/\/[0-9a-f]{64}\.html$/);
    const html = await readFile(file, "utf8");
    expect(html).toContain("<h1>Hostile README</h1>");
    expect(html).not.toMatch(/<script|<img[^>]*onerror|href="javascript/i);
    expect(files["no/readme"]).toBeNull();
    expect(await readdir(join(root, "readme"))).toHaveLength(1);
  });

  it("writes under the staging scratch but returns paths under the live scratch root", async () => {
    const stage = await scratch();
    const live = await scratch();
    const files = await renderReadmes(stage, INDEX_B, modelOf({ "hostile/readme": HOSTILE }), live);

    const file = files["hostile/readme"] as string;
    expect(file.startsWith(join(live, "readme") + "/")).toBe(true);
    expect(await readdir(join(stage, "readme"))).toEqual([file.slice(file.lastIndexOf("/") + 1)]);
  });

  it("gives a route whose README cannot be rendered null, warns once naming it, and still renders the others", async () => {
    const root = await scratch();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const files = await renderReadmes(
      root,
      INDEX_B,
      modelOf({ "gone/readme": "/p/gone/readme/o/sha256/missing.md", "hostile/readme": HOSTILE }),
    );

    expect(files["gone/readme"]).toBeNull();
    expect(files["hostile/readme"]).not.toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain('README for "idx/gone/readme" unavailable');
  });

  it("falls back to the route key when the model has no detail for it", async () => {
    const root = await scratch();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const model = { ...modelOf({ "a/b": "/p/a/b/missing.md" }), details: {} } as unknown as SiteModel;
    await renderReadmes(root, INDEX_B, model);
    expect(String(write.mock.calls[0]?.[0])).toContain('README for "a/b" unavailable');
  });
});

describe("readSanitizedHtml", () => {
  it("returns the file's content", async () => {
    const dir = await scratch();
    await mkdir(join(dir, "readme"));
    await writeFile(join(dir, "readme", "x.html"), "<p>ok</p>");
    expect(await readSanitizedHtml(join(dir, "readme", "x.html"))).toBe("<p>ok</p>");
  });

  it("rejects when the file is missing (a build bug, not a README fault)", async () => {
    await expect(readSanitizedHtml(join(await scratch(), "none.html"))).rejects.toThrow(/ENOENT/);
  });
});
