/**
 * C-504: a signed `c/index.json` carries a top-level `expires`; the walker
 * must still yield exactly its package roots, and the trust-model page must
 * describe the signed-catalog model rather than "never digest-verified".
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUrlSource } from "../../src/sources/walker.js";
import { bytesEqual, rootJsonBytes, sha256Digest, utf8 } from "./helpers.js";

const BASE_URL = "https://example.test/idx";
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readUrlSource — signed c/index.json with expires", () => {
  it("yields the roots of an index carrying `expires`", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "catalog-walker-signed-"));
    cleanup.push(cacheDir);
    const root = rootJsonBytes({ name: "ocx.sh/ns/pkg" });
    const index = utf8(
      JSON.stringify({
        format_version: 1,
        expires: "2030-01-01T00:00:00Z",
        packages: { "ns/pkg": sha256Digest(root) },
      }),
    );
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/config.json")) return new Response('{"format_version":1}', { status: 200 });
      if (url.endsWith("/c/index.json")) return new Response(Buffer.from(index), { status: 200 });
      if (url.endsWith("/p/ns/pkg.json")) return new Response(Buffer.from(root), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await readUrlSource({ url: BASE_URL }, { cacheDir, fetchImpl });

    expect([...result.keys()].sort()).toEqual(["c/index.json", "config.json", "p/ns/pkg.json"]);
    expect(bytesEqual(result.get("c/index.json")!, index)).toBe(true);
    expect(bytesEqual(result.get("p/ns/pkg.json")!, root)).toBe(true);
  });
});

describe("security-and-trust-model page", () => {
  it("no longer calls the catalog never digest-verified", async () => {
    const page = await readFile("docs/src/content/docs/explanation/security-and-trust-model.md", "utf8");
    expect(page).not.toMatch(/never\s+digest-verified/);
    expect(page).not.toMatch(/undigested/);
    expect(page).toMatch(/signed/i);
    expect(page).toMatch(/expires/);
  });
});
