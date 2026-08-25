/**
 * Spec tests for `footer.links[]` (WP-1) — a dedicated config key for the
 * footer's own link set, replacing `SiteFooter.vue`'s old `nav[]` reuse and
 * hardcoded `/docs/privacy` anchor (C-602). Entries share `nav[]`'s exact
 * shape and validation (`buildNavEntry`, reused not duplicated) — this file
 * covers the `footer` wrapper object itself; `nav[].link`'s own allowlist
 * behaviour is already exhaustively covered by `load-nav.test.ts`, so only
 * one representative unsafe-link case is repeated here to prove the reuse
 * actually wires through.
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { withTempDir, writeConfig, loadConfigError, MINIMAL_VALID } from "./helpers.js";

describe("WP-1 footer.links[] validation", () => {
  it("GREEN: absent footer -> config.footer stays undefined", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, MINIMAL_VALID);
      const loaded = await loadConfig(configPath);
      expect(loaded.config.footer).toBeUndefined();
    });
  });

  it("GREEN: accepts a footer with a links[] array, round-tripping verbatim", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...MINIMAL_VALID,
        footer: { links: [{ text: "Status", link: "/status" }] },
      });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.footer).toEqual({ links: [{ text: "Status", link: "/status" }] });
    });
  });

  it("GREEN: accepts an empty footer.links[] array", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, footer: { links: [] } });
      const loaded = await loadConfig(configPath);
      expect(loaded.config.footer).toEqual({ links: [] });
    });
  });

  it("RED: rejects an unrecognized key inside footer, naming it", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, footer: { links: [], bogus: true } });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("UNKNOWN_KEY");
      expect(error.message).toContain("bogus");
      expect(error.message).toContain("footer");
    });
  });

  it("RED: rejects footer.links that is not an array", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, footer: { links: "nope" } });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("footer.links");
    });
  });

  it("RED: rejects footer that is not an object", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, { ...MINIMAL_VALID, footer: "nope" });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("footer");
    });
  });

  it("RED: rejects an unrecognized key in a footer.links[] entry, naming it", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...MINIMAL_VALID,
        footer: { links: [{ text: "Status", link: "/status", bogus: true }] },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("UNKNOWN_KEY");
      expect(error.message).toContain("bogus");
      expect(error.message).toContain("footer.links[0]");
    });
  });

  // Proves `buildNavEntry`'s `assertSafeNavLink` call is actually reused for
  // footer.links[], not a second, un-validated link field — one
  // representative unsafe payload, not the full allowlist matrix
  // `load-nav.test.ts` already owns for nav[].
  it("RED: rejects a javascript: footer.links[].link with a named ConfigError", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, {
        ...MINIMAL_VALID,
        footer: { links: [{ text: "x", link: "javascript:alert(1)" }] },
      });
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("footer.links[0].link");
    });
  });
});
