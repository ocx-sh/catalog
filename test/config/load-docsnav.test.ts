/**
 * Spec tests for `docsNav[]` (WP-2) — labelled/split entries for the
 * docs-mount link(s) in the top nav, replacing the single auto `docs` entry
 * `docsPresent` alone produces. Entries share `nav[]`'s exact shape and
 * `assertSafeNavLink` validation (`buildNavEntry`, reused not duplicated),
 * plus two rules unique to this key: every link must resolve under
 * `/docs/`, and `docsNav` requires `docs` to be configured.
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { withTempDir, writeConfig, loadConfigError, MINIMAL_VALID } from "./helpers.js";

const WITH_DOCS = { ...MINIMAL_VALID, docs: "docs" };

describe("WP-2 docsNav[] validation", () => {
  it("GREEN: docs set, docsNav absent -> config.docsNav stays undefined", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, WITH_DOCS);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.docsNav).toBeUndefined();
    });
  });

  it("GREEN: accepts docsNav alongside docs, round-tripping verbatim", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...WITH_DOCS,
        docsNav: [
          { text: "Setup", link: "/docs/setup/" },
          { text: "Reference", link: "/docs/reference/" },
        ],
      });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.docsNav).toEqual([
        { text: "Setup", link: "/docs/setup/" },
        { text: "Reference", link: "/docs/reference/" },
      ]);
    });
  });

  it("GREEN: accepts a docsNav entry whose link is exactly /docs/", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...WITH_DOCS, docsNav: [{ text: "Setup", link: "/docs/" }] });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.docsNav).toEqual([{ text: "Setup", link: "/docs/" }]);
    });
  });

  it("RED: rejects docsNav present without docs configured", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...MINIMAL_VALID,
        docsNav: [{ text: "Setup", link: "/docs/setup/" }],
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("docsNav");
      expect(error.message).toContain("docs");
    });
  });

  it("RED: rejects a docsNav[].link outside /docs/ — it's a nav[] entry with extra steps", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...WITH_DOCS, docsNav: [{ text: "Other", link: "/other/" }] });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("docsNav[0].link");
    });
  });

  it("RED: rejects a docsNav[].link that merely starts with /docs (no trailing slash) as a prefix trick", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...WITH_DOCS, docsNav: [{ text: "Setup", link: "/docsx/" }] });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("docsNav[0].link");
    });
  });

  // Proves `buildNavEntry`'s `assertSafeNavLink` call runs BEFORE the /docs/
  // prefix check — a javascript: payload is rejected as unsafe, not merely
  // as "outside /docs/".
  it("RED: rejects a javascript: docsNav[].link with a named ConfigError", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...WITH_DOCS,
        docsNav: [{ text: "x", link: "javascript:alert(1)" }],
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("docsNav[0].link");
    });
  });

  it("RED: rejects an unrecognized key in a docsNav[] entry, naming it", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...WITH_DOCS,
        docsNav: [{ text: "Setup", link: "/docs/setup/", bogus: true }],
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("UNKNOWN_KEY");
      expect(error.message).toContain("bogus");
      expect(error.message).toContain("docsNav[0]");
    });
  });

  it("RED: rejects docsNav that is not an array", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...WITH_DOCS, docsNav: "nope" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("docsNav");
    });
  });
});
