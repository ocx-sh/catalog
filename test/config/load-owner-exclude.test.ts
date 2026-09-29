/**
 * Spec tests for two optional keys: top-level `ownerUrl` (an owner-profile
 * link template) and per-source `excludeFromAll`. Both are read by the theme
 * only — `loadConfig`'s job is to accept the legal shapes and reject the rest
 * with the loader's usual `INVALID_TYPE`/`UNKNOWN_KEY` diagnostics.
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { withTempDir, writeConfig, loadConfigError, MINIMAL_VALID } from "./helpers.js";

describe("ownerUrl", () => {
  it("absent -> config.ownerUrl stays undefined", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(await writeConfig(dir, MINIMAL_VALID));
      expect(loaded.config.ownerUrl).toBeUndefined();
    });
  });

  it.each([
    ["a GitLab template", "https://gitlab.com/{login}"],
    ["a self-hosted http forge", "http://git.internal:3000/{login}"],
    ["a template with a suffix", "https://gitlab.example/{login}/-/projects"],
    ["a placeholder in the query", "https://forge.example/u?name={login}"],
    ["a placeholder as a subdomain", "https://{login}.example.test/"],
  ])("accepts %s", async (_label, ownerUrl) => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl }));
      expect(loaded.config.ownerUrl).toBe(ownerUrl);
    });
  });

  it("rejects a template without {login}, naming the key", async () => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(
        await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl: "https://gitlab.com/people" }),
      );
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain('"ownerUrl"');
      expect(error.message).toContain("{login}");
      expect(error.message).toContain("found 0");
    });
  });

  it("rejects a template with {login} twice", async () => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(
        await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl: "https://gitlab.com/{login}/{login}" }),
      );
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("found 2");
    });
  });

  it.each([
    ["javascript:", "javascript:alert(1)//{login}"],
    ["ftp:", "ftp://gitlab.com/{login}"],
  ])("rejects a %s template", async (_label, ownerUrl) => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl }));
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("an http(s) URL");
    });
  });

  it.each([
    ["relative", "/people/{login}"],
    ["not a URL at all", "not a url {login}"],
  ])("rejects a template that is %s", async (_label, ownerUrl) => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl }));
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("absolute URL");
    });
  });

  it("rejects an empty or non-string ownerUrl like any other string field", async () => {
    await withTempDir(async (dir) => {
      const empty = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl: "" }));
      expect(empty.code).toBe("INVALID_TYPE");
      const number = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, ownerUrl: 5 }));
      expect(number.message).toContain("must be a string");
    });
  });
});

describe("sources[].excludeFromAll", () => {
  it("absent -> undefined on every variant", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(
        await writeConfig(dir, {
          sources: [{ path: "a" }, { url: "https://example.com" }, { git: "https://example.com/r.git" }],
          brand: { title: "x" },
        }),
      );
      expect(loaded.sources.map((source) => source.entry.excludeFromAll)).toEqual([undefined, undefined, undefined]);
    });
  });

  it("true and false are carried through on path, url and git entries", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(
        await writeConfig(dir, {
          sources: [
            { path: "a", excludeFromAll: true },
            { url: "https://example.com", excludeFromAll: false },
            { git: "https://example.com/r.git", excludeFromAll: true },
          ],
          brand: { title: "x" },
        }),
      );
      expect(loaded.sources.map((source) => source.entry.excludeFromAll)).toEqual([true, false, true]);
    });
  });

  it("is independent of root and default: all three may sit on one entry", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(
        await writeConfig(dir, {
          sources: [{ path: "a", root: true, default: true, excludeFromAll: true }],
          brand: { title: "x" },
        }),
      );
      expect(loaded.sources[0]?.entry).toMatchObject({ root: true, default: true, excludeFromAll: true });
    });
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects %s, naming sources[i].excludeFromAll", async (_label, excludeFromAll) => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(
        await writeConfig(dir, { sources: [{ path: "a" }, { path: "b", excludeFromAll }], brand: { title: "x" } }),
      );
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("sources[1].excludeFromAll");
    });
  });

  it("is still a closed shape: a misspelt sibling is UNKNOWN_KEY", async () => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(
        await writeConfig(dir, { sources: [{ path: "a", excludeFromall: true }], brand: { title: "x" } }),
      );
      expect(error.code).toBe("UNKNOWN_KEY");
    });
  });
});
