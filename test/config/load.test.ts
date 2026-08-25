import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/load.js";
import { ConfigError } from "../../src/config/errors.js";
import {
  withTempDir,
  writeConfig,
  writeRawConfig,
  loadConfigError,
  MINIMAL_VALID,
  FULL_VALID,
} from "./helpers.js";

describe("C-002 loadConfig happy paths", () => {
  it("loads a minimal config (one path source + brand.title)", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.sources).toEqual([{ path: "packages" }]);
      // No wordmark, no logo — both stay absent rather than being defaulted
      // here; the theme owns the `wordmark ?? title` fallback.
      expect(loaded.config.brand).toEqual({ title: "My Catalog" });
    });
  });

  it("loads a full config with every optional field populated", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, FULL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.configVersion).toBe(1);
      expect(loaded.config.brand).toEqual({
        title: "My Catalog",
        wordmark: "my.catalog.example",
        logo: "assets/logo.svg",
      });
      expect(loaded.config.nav).toEqual([{ text: "Docs", link: "/docs/" }]);
      expect(loaded.config.footer).toEqual({ links: [{ text: "Status", link: "/status" }] });
      expect(loaded.config.docs).toBe("docs");
      expect(loaded.config.docsNav).toEqual([{ text: "Guide", link: "/docs/guide" }]);
      expect(loaded.config.css).toBe("styles/custom.css");
      expect(loaded.config.publicDir).toBe("static");
      expect(loaded.config.ci?.forge).toBe("github");
      expect(loaded.config.$schema).toBe(FULL_VALID.$schema);
      expect(loaded.config.siteUrl).toBe("https://example.test");
      expect(loaded.config.description).toBe("A test catalog.");
      expect(loaded.config.favicon).toBe("/favicon.svg");
      expect(loaded.sources).toHaveLength(3);
      expect(loaded.sources[2]?.entry).toMatchObject({
        git: "https://example.com/repo.git",
        ref: "main",
        dir: "catalog",
      });
    });
  });

  it("normalizes an absent configVersion to 1 in the returned config", async () => {
    // Ruling: absent configVersion normalizes to exactly 1 in
    // LoadedConfig.config.configVersion, not left undefined.
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.configVersion).toBe(1);
    });
  });

  it("returns configDir as the config file's absolute containing directory", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.configDir).toBe(dir);
    });
  });

  it("resolves each source's label to its explicit value or null when absent", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [
          { path: "a", label: "primary" },
          { path: "b" },
        ],
        brand: { title: "Shape Check" },
      });
      const loaded = await loadConfig(configPath);
      expect(loaded.sources).toHaveLength(2);
      expect(loaded.sources[0]).toEqual({
        entry: expect.objectContaining({ path: "a", label: "primary" }),
        label: "primary",
      });
      expect(loaded.sources[1]).toEqual({
        entry: expect.objectContaining({ path: "b" }),
        label: null,
      });
    });
  });
});

describe("C-002 loadConfig error codes", () => {
  it("MISSING_FILE: names the missing path", async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, "catalog.config.json");
      const error = await loadConfigError(missing);
      expect(error.code).toBe("MISSING_FILE");
      expect(error.message).toContain(missing);
    });
  });

  it("INVALID_JSON: unparseable file contents", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeRawConfig(dir, "{ not valid json");
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_JSON");
    });
  });

  it("READ_ERROR: a non-ENOENT fs error (e.g. a directory) is distinct from MISSING_FILE", async () => {
    await withTempDir(async (dir) => {
      // Pass the directory itself as configPath: readFile on a directory
      // fails with EISDIR, not ENOENT — must not be misreported as "not found".
      const error = await loadConfigError(dir);
      expect(error.code).toBe("READ_ERROR");
    });
  });

  describe("INVALID_TYPE: top-level config is not a plain object", () => {
    it("rejects a top-level null", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, null);
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
      });
    });

    it("rejects a top-level array, naming it as an array in the message", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, [1, 2, 3]);
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("array");
      });
    });

    it("rejects a top-level string", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, "hello");
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
      });
    });
  });

  describe("INVALID_TYPE", () => {
    it("rejects sources that is not an array", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { sources: "nope", brand: { title: "x" } });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("sources");
      });
    });

    it("rejects brand missing title", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { sources: [{ path: "a" }], brand: {} });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("title");
      });
    });

    it("rejects brand.title that is not a string", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: "a" }],
          brand: { title: 42 },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("title");
      });
    });

    it("rejects a sources[] entry's path that is null, reporting null (not object)", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: null }],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("null");
      });
    });

    it("rejects a sources[] entry's root that is not a boolean", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: "a", root: "yes" }],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("root");
      });
    });

    it("rejects a sources[] entry that is not an object", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { sources: [null], brand: { title: "x" } });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("sources[0]");
      });
    });

    it("rejects a brand that is not an object", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { sources: [{ path: "a" }], brand: "x" });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("brand");
      });
    });

    it("rejects a nav entry that is not an object", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { ...MINIMAL_VALID, nav: [null] });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("nav[0]");
      });
    });

    it("rejects a ci that is not an object", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { ...MINIMAL_VALID, ci: 5 });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("ci");
      });
    });

    it("rejects a ci.forge outside the github/gitlab enum, naming allowed values", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { ...MINIMAL_VALID, ci: { forge: "bitbucket" } });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("github");
        expect(error.message).toContain("gitlab");
      });
    });

    it("accepts ci.packageManager npm and bun", async () => {
      await withTempDir(async (dir) => {
        const npmPath = await writeConfig(dir, { ...MINIMAL_VALID, ci: { forge: "github", packageManager: "npm" } });
        expect((await loadConfig(npmPath)).config.ci?.packageManager).toBe("npm");
      });
      await withTempDir(async (dir) => {
        const bunPath = await writeConfig(dir, { ...MINIMAL_VALID, ci: { forge: "github", packageManager: "bun" } });
        expect((await loadConfig(bunPath)).config.ci?.packageManager).toBe("bun");
      });
    });

    it("leaves ci.packageManager absent when not set (no defaulting at load time)", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { ...MINIMAL_VALID, ci: { forge: "github" } });
        const loaded = await loadConfig(configPath);
        expect(loaded.config.ci?.packageManager).toBeUndefined();
      });
    });

    it("rejects a ci.packageManager outside the npm/bun enum, naming allowed values", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          ...MINIMAL_VALID,
          ci: { forge: "github", packageManager: "pnpm" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("npm");
        expect(error.message).toContain("bun");
      });
    });

    it("rejects a ci.packageManager that is not a string", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          ...MINIMAL_VALID,
          ci: { forge: "github", packageManager: 5 },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("INVALID_TYPE");
        expect(error.message).toContain("ci.packageManager");
      });
    });
  });

  describe("UNKNOWN_KEY", () => {
    it("rejects an unrecognized top-level key, naming it", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, { ...MINIMAL_VALID, foo: "bar" });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("UNKNOWN_KEY");
        expect(error.message).toContain("foo");
      });
    });

    it("accepts an unrecognized key inside ci (forward-compat)", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          ...MINIMAL_VALID,
          ci: { forge: "github", customThing: true },
        });
        const loaded = await loadConfig(configPath);
        expect(loaded.config.ci?.forge).toBe("github");
      });
    });

    it("rejects an unrecognized key in a sources[] entry, naming it", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: "a", bogus: true }],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("UNKNOWN_KEY");
        expect(error.message).toContain("bogus");
      });
    });

    it("rejects an unrecognized key in brand, naming it", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: "a" }],
          brand: { title: "x", bogus: true },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("UNKNOWN_KEY");
        expect(error.message).toContain("bogus");
      });
    });

    it("rejects an unrecognized key in a nav entry, naming it", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          ...MINIMAL_VALID,
          nav: [{ text: "Docs", link: "/docs/", bogus: true }],
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("UNKNOWN_KEY");
        expect(error.message).toContain("bogus");
      });
    });

  });

  it("UNSUPPORTED_VERSION: configVersion 2 is rejected, naming the version", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, configVersion: 2 });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("UNSUPPORTED_VERSION");
      expect(error.message).toMatch(/\b2\b/);
    });
  });

  it("INVALID_TYPE: a configVersion that isn't a number is a type problem, not a version problem", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, configVersion: "1" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  describe("SOURCE_DISCRIMINANT", () => {
    it("rejects an entry with zero of path/url/git, naming its index", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{}],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("SOURCE_DISCRIMINANT");
        expect(error.message).toMatch(/\b0\b/);
      });
    });

    it("rejects an entry with two of path/url/git, naming its index", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [{ path: "a" }, { path: "b", url: "c" }],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("SOURCE_DISCRIMINANT");
        expect(error.message).toMatch(/\b1\b/);
      });
    });
  });

  it("EMPTY_SOURCES: sources present but empty", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { sources: [], brand: { title: "x" } });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("EMPTY_SOURCES");
    });
  });

  it("MULTIPLE_ROOT: two entries set root:true, naming both indices", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [
          { path: "a", root: true },
          { path: "b" },
          { path: "c", root: true },
        ],
        brand: { title: "x" },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("MULTIPLE_ROOT");
      expect(error.message).toMatch(/\b0\b/);
      expect(error.message).toMatch(/\b2\b/);
    });
  });

  it("MULTIPLE_DEFAULT: two entries set default:true, naming both indices", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [
          { path: "a", default: true },
          { path: "b" },
          { path: "c", default: true },
        ],
        brand: { title: "x" },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("MULTIPLE_DEFAULT");
      expect(error.message).toMatch(/\b0\b/);
      expect(error.message).toMatch(/\b2\b/);
    });
  });

  // `root` and `default` are separate questions — placement vs. which index
  // the catalog opens on — so one entry may answer both, and two entries may
  // answer one each. Neither combination is a conflict.
  it("accepts default on a non-root entry, and root and default on different ones", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [
          { path: "a", root: true },
          { path: "b", default: true },
        ],
        brand: { title: "x" },
      });
      const loaded = await loadConfig(configPath);
      expect(loaded.sources.map((source) => source.entry.default)).toEqual([undefined, true]);
      expect(loaded.sources.map((source) => source.entry.root)).toEqual([true, undefined]);
    });
  });

  it("INVALID_TYPE: default is not a boolean", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [{ path: "a", default: "yes" }],
        brand: { title: "x" },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("sources[0].default");
    });
  });

  describe("LABEL_CONFLICT", () => {
    it("rejects two entries sharing the same explicit label", async () => {
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [
            { path: "a", label: "dup" },
            { path: "b", label: "dup" },
          ],
          brand: { title: "x" },
        });
        const error = await loadConfigError(configPath);
        expect(error.code).toBe("LABEL_CONFLICT");
      });
    });

    it("does not conflict when only one of two entries declares the label explicitly", async () => {
      // load.ts: "LABEL_CONFLICT only compares entries that both set an
      // explicit label" — derivation for the label-less entry, and any
      // re-check once derived, is the source-reading layer's job, not this
      // loader's.
      await withTempDir(async (dir) => {
        const configPath = await writeConfig(dir, {
          sources: [
            { path: "a", label: "dup" },
            { path: "b" },
          ],
          brand: { title: "x" },
        });
        const loaded = await loadConfig(configPath);
        expect(loaded.sources[0]?.label).toBe("dup");
        expect(loaded.sources[1]?.label).toBeNull();
      });
    });
  });
});

/**
 * PATH_ESCAPE, table-driven across the five checked fields: `css`, `docs`,
 * `publicDir`, `brand.logo`, and a `path` source value. Each field gets the
 * same four containment checks the doc comment specifies.
 */
const PATH_FIELDS: ReadonlyArray<{
  readonly key: string;
  readonly messageSubject: string;
  readonly withValue: (value: string) => unknown;
}> = [
  {
    key: "css",
    messageSubject: "css",
    withValue: (value) => ({ ...MINIMAL_VALID, css: value }),
  },
  {
    key: "docs",
    messageSubject: "docs",
    withValue: (value) => ({ ...MINIMAL_VALID, docs: value }),
  },
  {
    key: "publicDir",
    messageSubject: "publicDir",
    withValue: (value) => ({ ...MINIMAL_VALID, publicDir: value }),
  },
  {
    key: "brand.logo",
    messageSubject: "logo",
    withValue: (value) => ({
      ...MINIMAL_VALID,
      brand: { ...MINIMAL_VALID.brand, logo: value },
    }),
  },
  {
    key: "sources[0].path",
    messageSubject: "path",
    withValue: (value) => ({ ...MINIMAL_VALID, sources: [{ path: value }] }),
  },
];

describe.each(PATH_FIELDS)("C-002 PATH_ESCAPE for $key", ({ messageSubject, withValue }) => {
  it("rejects a ../ relative escape, naming the offending key", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, withValue("../escape"));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("PATH_ESCAPE");
      expect(error.message).toContain(messageSubject);
    });
  });

  it("rejects an absolute path outside configDir", async () => {
    await withTempDir(async (dir) => {
      const outside = join(tmpdir(), "elsewhere-outside-configdir");
      const configPath = await writeConfig(dir, withValue(outside));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("PATH_ESCAPE");
    });
  });

  it("accepts a value inside configDir", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, withValue("nested/inside"));
      await expect(loadConfig(configPath)).resolves.toBeDefined();
    });
  });

  it("rejects a sibling directory sharing only a string prefix with configDir (segment semantics)", async () => {
    await withTempDir(async (dir) => {
      // dir + "-sibling" shares `dir` as a *string* prefix but is a distinct
      // directory next to it (same parent, different last segment) — a
      // startsWith()-style check would wrongly treat this as contained.
      const sibling = `${dir}-sibling`;
      const configPath = await writeConfig(dir, withValue(sibling));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("PATH_ESCAPE");
    });
  });
});

/** Security panel (2026-08-22, W1 / CWE-319+CWE-345): a `sources[].url` is
 * the base of every wire fetch, and `/config.json` + `/c/index.json` are the
 * only fetched files never digest-verified — over plain `http:` a network
 * attacker rewrites the enumeration and every downstream digest check then
 * verifies against THEIR digests and passes. https-only, enforced at config
 * load. */
describe("C-002 sources[].url scheme allowlist", () => {
  it("accepts an https url source", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [{ url: "https://index.ocx.sh" }],
        brand: { title: "x" },
      });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.sources[0]?.url).toBe("https://index.ocx.sh");
    });
  });

  it.each([
    ["plain http", "http://insecure.example"],
    ["a non-http(s) scheme", "ftp://x"],
    ["a file: URL", "file:///etc/passwd"],
  ])("rejects %s, naming the offending entry", async (_case, url) => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { sources: [{ url }], brand: { title: "x" } });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("sources[0].url");
      expect(error.message).toContain("https");
    });
  });

  it("rejects a url that isn't a URL at all", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        sources: [{ path: "a" }, { url: "notaurl" }],
        brand: { title: "x" },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("sources[1].url");
      expect(error.message).toContain("absolute URL");
    });
  });
});

describe("C-002 siteUrl/description", () => {
  it("accepts a plausible absolute http(s) siteUrl", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, siteUrl: "https://index.ocx.sh" });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.siteUrl).toBe("https://index.ocx.sh");
    });
  });

  it("rejects a siteUrl that isn't a URL at all", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, siteUrl: "not a url" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("siteUrl");
    });
  });

  it("rejects a siteUrl with a non-http(s) protocol", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, siteUrl: "ftp://example.test" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("rejects an empty-string siteUrl", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, siteUrl: "" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("siteUrl absent -> loaded.config.siteUrl is undefined, never fails", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.siteUrl).toBeUndefined();
    });
  });

  it("rejects an empty-string description", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, description: "" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("description absent -> loaded.config.description is undefined, never fails", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.description).toBeUndefined();
    });
  });
});

describe("C-002 favicon", () => {
  it("rejects an empty-string favicon", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, favicon: "" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("favicon");
    });
  });

  it("favicon absent -> undefined on the loaded config, never fails", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.favicon).toBeUndefined();
    });
  });

  // `favicon` is an HREF, not a path this package ever opens — unlike
  // `css`/`docs`/`publicDir`/`brand.logo` it gets NO containment check, so a
  // leading `..` is just an (odd) relative href, never PATH_ESCAPE.
  it("favicon is not path-contained — a ../ href loads unchanged", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, favicon: "../shared/favicon.svg" });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.favicon).toBe("../shared/favicon.svg");
    });
  });
});

describe("C-002 error hygiene", () => {
  it("rejections are ConfigError instances carrying a stable code", async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, "catalog.config.json");
      await expect(loadConfig(missing)).rejects.toBeInstanceOf(ConfigError);
      await expect(loadConfig(missing)).rejects.toMatchObject({ code: "MISSING_FILE" });
    });
  });
});
