/**
 * Contract tests for the `base` and `chrome` config keys (C-003). The
 * assertions are the plan's contract, not the CW pass-through's behaviour:
 * `base` is validated (`BASE_INVALID`, dot segments rejected), defaulted from
 * `siteUrl`'s path, and conflicts with a differing `siteUrl` path
 * (`BASE_SITEURL_MISMATCH`); `chrome: "ocx"` rejects the keys the ocx shell
 * owns (`CHROME_OCX_CONFLICT`).
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { MINIMAL_VALID, loadConfigError, withTempDir, writeConfig } from "./helpers.js";

async function loaded(extra: Record<string, unknown>) {
  return withTempDir(async (dir) => loadConfig(await writeConfig(dir, { ...MINIMAL_VALID, ...extra })));
}

async function errorCode(extra: Record<string, unknown>) {
  return withTempDir(async (dir) => (await loadConfigError(await writeConfig(dir, { ...MINIMAL_VALID, ...extra }))).code);
}

describe("base (C-003)", () => {
  it.each(["/", "/catalog/", "/a/b/", "/a.b/c_d-e/"])("accepts %j", async (base) => {
    expect((await loaded({ base })).config.base).toBe(base);
  });

  it.each([
    ["no leading slash", "catalog/"],
    ["no trailing slash", "/catalog"],
    ["an absolute URL", "https://example.test/catalog/"],
    ["an empty segment", "/a//b/"],
    ["a space", "/a b/"],
    ["a backslash", "/a\\b/"],
    ["a percent escape", "/%41/"],
    ["a parent segment", "/../"],
    ["a current-directory segment", "/./"],
    ["a parent segment after a name", "/catalog/../"],
    ["a current-directory segment after a name", "/catalog/./"],
    ["a parent segment in the middle", "/a/../b/"],
  ])("rejects %s with BASE_INVALID", async (_label, base) => {
    expect(await errorCode({ base })).toBe("BASE_INVALID");
  });

  it("defaults to / without base or siteUrl", async () => {
    expect((await loaded({})).config.base).toBe("/");
  });

  it("adds the trailing slash to a siteUrl path that lacks one", async () => {
    expect((await loaded({ siteUrl: "https://example.test/catalog" })).config.base).toBe("/catalog/");
    expect((await loaded({ siteUrl: "https://example.test/catalog", base: "/catalog/" })).config.base).toBe(
      "/catalog/",
    );
  });

  it("rejects a siteUrl path that is not a canonical base with BASE_INVALID", async () => {
    expect(await errorCode({ siteUrl: "https://example.test/%41/" })).toBe("BASE_INVALID");
  });

  it("defaults to the path of siteUrl", async () => {
    expect((await loaded({ siteUrl: "https://example.test/catalog/" })).config.base).toBe("/catalog/");
  });

  it("defaults to / for an origin-only siteUrl", async () => {
    expect((await loaded({ siteUrl: "https://example.test" })).config.base).toBe("/");
    expect((await loaded({ siteUrl: "https://example.test/" })).config.base).toBe("/");
  });

  it("accepts any valid base beside an origin-only siteUrl", async () => {
    expect((await loaded({ siteUrl: "https://example.test", base: "/catalog/" })).config.base).toBe("/catalog/");
  });

  it("accepts a base equal to siteUrl's path", async () => {
    const config = (await loaded({ siteUrl: "https://example.test/catalog/", base: "/catalog/" })).config;
    expect(config.base).toBe("/catalog/");
  });

  it("rejects a base that differs from siteUrl's path with BASE_SITEURL_MISMATCH", async () => {
    expect(await errorCode({ siteUrl: "https://example.test/catalog/", base: "/other/" })).toBe("BASE_SITEURL_MISMATCH");
  });

  it("rejects a root base beside a siteUrl that carries a path with BASE_SITEURL_MISMATCH", async () => {
    expect(await errorCode({ siteUrl: "https://example.test/catalog/", base: "/" })).toBe("BASE_SITEURL_MISMATCH");
  });
});

describe("chrome (C-003)", () => {
  it.each(["neutral", "ocx"] as const)("accepts %s", async (chrome) => {
    // ocx rejects brand, so MINIMAL_VALID's brand is dropped (JSON drops undefined).
    const brand = chrome === "ocx" ? undefined : MINIMAL_VALID.brand;
    expect((await loaded({ chrome, brand })).config.chrome).toBe(chrome);
  });

  it.each([
    ["nav", { nav: [{ text: "Docs", link: "/docs/" }] }],
    ["footer", { footer: { links: [{ text: "Status", link: "/status" }] } }],
    ["docsNav", { docs: "./docs", docsNav: [{ text: "Guides", link: "/docs/guides/" }] }],
    ["brand.title", { brand: { title: "Catalog" } }],
    ["brand.wordmark", { brand: { title: "Catalog", wordmark: "catalog.example" } }],
    ["brand.logo", { brand: { title: "Catalog", logo: "assets/logo.svg" } }],
  ])("rejects chrome: ocx beside %s with CHROME_OCX_CONFLICT", async (_label, extra) => {
    expect(await errorCode({ chrome: "ocx", ...extra })).toBe("CHROME_OCX_CONFLICT");
  });

  it("accepts the same keys under chrome: neutral", async () => {
    const config = (
      await loaded({ chrome: "neutral", nav: [{ text: "Docs", link: "/docs/" }], footer: { links: [] } })
    ).config;
    expect(config.chrome).toBe("neutral");
  });

  // The plan's contract row wins over the CW test: brand is rejected under
  // ocx (ADR config surface table), so "nothing else to conflict" means the
  // MINIMAL_VALID brand is dropped, and brand is no longer required there.
  it("accepts chrome: ocx with no brand, nav or footer", async () => {
    const config = (await loaded({ chrome: "ocx", brand: undefined })).config;
    expect(config.chrome).toBe("ocx");
    expect(config.brand).toBeUndefined();
  });

  it("still requires brand under chrome: neutral and when chrome is absent", async () => {
    expect(await errorCode({ chrome: "neutral", brand: undefined })).toBe("INVALID_TYPE");
    expect(await errorCode({ brand: undefined })).toBe("INVALID_TYPE");
  });
});
