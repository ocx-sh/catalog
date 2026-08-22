/**
 * Spec tests for `nav[].link` validation (C-605) — `loadConfig` allowlists
 * an absolute `http:`/`https:` URL or a site-relative path starting with a
 * single `/`, and rejects everything else (a `javascript:` value, above
 * all) with a named `ConfigError`. See `assertSafeNavLink`'s own doc
 * comment (`src/config/load.ts`) for the full rationale.
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { withTempDir, writeConfig, loadConfigError, MINIMAL_VALID } from "./helpers.js";

function configWithNavLink(link: string): unknown {
  return { ...MINIMAL_VALID, nav: [{ text: "Docs", link }] };
}

describe("C-605 nav[].link validation", () => {
  it("RED: rejects a javascript: nav link with a named ConfigError", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("javascript:alert(1)"));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("nav[0].link");
    });
  });

  it("rejects a data: nav link", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("data:text/html,<script>1</script>"));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("rejects a protocol-relative // nav link (resolves to an attacker-chosen host)", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("//evil.example/phish"));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  // The three payloads below all start with a single "/" and are NOT "//",
  // so the original `!value.startsWith("//")` check accepted every one of
  // them — yet each resolves to `https://evil.example` in any WHATWG URL
  // parser, i.e. in every browser. Backslashes are normalized to "/" for
  // special schemes, and tabs/newlines are stripped before parsing.
  it.each([
    ["a backslash authority", "/\\evil.example/phish"],
    ["a tab-split authority", "/\t/evil.example/phish"],
    ["a newline-split authority", "/\n/evil.example/phish"],
  ])("rejects %s — it leaves this origin (CWE-601)", async (_label, link) => {
    // Guard the guard: assert the payload really is an off-site redirect, so
    // this test cannot quietly pass on a payload that was never dangerous.
    expect(new URL(link, "https://catalog.example/page").origin).toBe("https://evil.example");
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink(link));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
      expect(error.message).toContain("nav[0].link");
    });
  });

  it("rejects an unparseable authority (//[ — invalid IPv6)", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("//["));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("rejects a plain non-URL string (fails new URL() parsing)", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("not a url at all"));
      const error = await loadConfigError(configPath);
      expect(error.code).toBe("INVALID_TYPE");
    });
  });

  it("GREEN: accepts an absolute https URL", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("https://example.test/docs"));
      const loaded = await loadConfig(configPath);
      expect(loaded.config.nav).toEqual([{ text: "Docs", link: "https://example.test/docs" }]);
    });
  });

  it("GREEN: accepts an absolute http URL", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("http://example.test/docs"));
      const loaded = await loadConfig(configPath);
      expect(loaded.config.nav).toEqual([{ text: "Docs", link: "http://example.test/docs" }]);
    });
  });

  it("GREEN: accepts a site-relative path starting with a single /", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("/docs/"));
      const loaded = await loadConfig(configPath);
      expect(loaded.config.nav).toEqual([{ text: "Docs", link: "/docs/" }]);
    });
  });

  it("GREEN: accepts a site-relative path carrying a query and fragment", async () => {
    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, configWithNavLink("/?q=cli#top"));
      const loaded = await loadConfig(configPath);
      expect(loaded.config.nav).toEqual([{ text: "Docs", link: "/?q=cli#top" }]);
    });
  });
});
