import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAstroConfig } from "../../src/build/astro_config_file.js";

const HOSTILE = [
  ['a"b', "double quote"],
  ["a\\b", "backslash"],
  ["a${process.exit(1)}b", "template placeholder"],
  ["a\nb", "newline"],
  ["a\u2028b\u2029c", "U+2028 / U+2029"],
  ['"; process.exit(1); //', "string breakout"],
] as const;

const STRING_LITERAL = String.raw`"(?:[^"\\]|\\.)*"`;
const LINE_ONE = new RegExp(String.raw`^import \{ readFileSync \} from "node:fs"; import \{ astroConfig \} from (${STRING_LITERAL});$`);
const LINE_TWO = new RegExp(String.raw`^export default astroConfig\(JSON\.parse\(readFileSync\((${STRING_LITERAL}), "utf8"\)\)\.astro\);$`);

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "ocx-astro-config-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("writeAstroConfig (C-040)", () => {
  it("writes <scratch>/astro.config.mjs and returns its path", async () => {
    const file = await writeAstroConfig(scratch, "file:///pkg/dist/site/astro_config.js", join(scratch, "site.json"));
    expect(file).toBe(join(scratch, "astro.config.mjs"));
    expect((await readFile(file, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it.each(HOSTILE)("round-trips %j (%s) in both interpolated strings and nothing else", async (hostile) => {
    const url = `file:///pkg/${hostile}/astro_config.js`;
    const sitePath = `/scratch/${hostile}/site.json`;
    const file = await writeAstroConfig(scratch, url, sitePath);
    const lines = (await readFile(file, "utf8")).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    const one = LINE_ONE.exec(lines[0] ?? "");
    const two = LINE_TWO.exec(lines[1] ?? "");
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(JSON.parse(one?.[1] ?? "")).toBe(url);
    expect(JSON.parse(two?.[1] ?? "")).toBe(sitePath);
  });

  it.each(HOSTILE)("a real import with %j (%s) in the site path hands the file's astro input to astroConfig", async (hostile) => {
    const siteDir = join(scratch, `site-${hostile}`);
    await mkdir(siteDir);
    const sitePath = join(siteDir, "site.json");
    await writeFile(sitePath, JSON.stringify({ astro: { base: "/x/" }, other: "ignored" }));
    const stub = join(scratch, "stub_astro_config.mjs");
    await writeFile(stub, "export const astroConfig = (input) => ({ received: input });\n");
    const file = await writeAstroConfig(scratch, pathToFileURL(stub).href, sitePath);
    const mod = (await import(pathToFileURL(file).href)) as { default: unknown };
    expect(mod.default).toEqual({ received: { base: "/x/" } });
  });
});
