/**
 * Live CW tests from before P-base (B.1): the type and key-shape rules for
 * `base` and `chrome`. Value validation and defaults live in
 * `load-base-chrome.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/errors.js";
import { loadConfig } from "../../src/config/load.js";
import { MINIMAL_VALID, loadConfigError, withTempDir, writeConfig } from "./helpers.js";

describe("base and chrome key shape", () => {
  it("keeps both keys as written", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(
        await writeConfig(dir, { sources: MINIMAL_VALID.sources, base: "/catalog/", chrome: "ocx" }),
      );
      expect(loaded.config.base).toBe("/catalog/");
      expect(loaded.config.chrome).toBe("ocx");
    });
  });

  it("defaults base to / and leaves chrome undefined when absent", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig(await writeConfig(dir, MINIMAL_VALID));
      expect(loaded.config.base).toBe("/");
      expect(loaded.config.chrome).toBeUndefined();
    });
  });

  it("rejects a non-string base with INVALID_TYPE", async () => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, base: 7 }));
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain('"base"');
    });
  });

  it("rejects a chrome outside neutral|ocx with INVALID_TYPE", async () => {
    await withTempDir(async (dir) => {
      const error = await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, chrome: "bogus" }));
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain('"chrome"');
    });
  });

  it("declares the P-base and P-engine error codes", () => {
    for (const code of ["BASE_INVALID", "BASE_SITEURL_MISMATCH", "CHROME_OCX_CONFLICT", "OUT_DIR_OVERLAPS_INPUT"] as const) {
      expect(new ConfigError(code, "x").code).toBe(code);
    }
  });
});
