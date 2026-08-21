import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { ConfigError, type ConfigErrorCode } from "../../src/config/errors.js";
import { loadConfig } from "../../src/config/load.js";

/**
 * Runs `fn` against a freshly created, isolated temp directory, removing it
 * (recursively) afterward regardless of outcome. Every call gets its own
 * directory — tests never share mutable filesystem state.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-config-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes `data` as JSON to `<dir>/catalog.config.json`, returns the path. */
export async function writeConfig(dir: string, data: unknown): Promise<string> {
  const path = join(dir, "catalog.config.json");
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

/** Writes raw text (e.g. malformed JSON) to `<dir>/catalog.config.json`. */
export async function writeRawConfig(dir: string, text: string): Promise<string> {
  const path = join(dir, "catalog.config.json");
  await writeFile(path, text, "utf8");
  return path;
}

/**
 * Awaits `loadConfig(configPath)`, asserting it rejects with a `ConfigError`,
 * and returns that error for further assertions (`.code`, `.message`).
 * Fails the test explicitly if `loadConfig` resolves instead of rejecting,
 * so a missing `await` never surfaces as a silent false pass.
 */
export async function loadConfigError(configPath: string): Promise<ConfigError> {
  try {
    await loadConfig(configPath);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error(`expected loadConfig(${configPath}) to reject, but it resolved`);
}

/** Base config re-used by tests that only need one valid field to vary. */
export const MINIMAL_VALID = {
  sources: [{ path: "packages" }],
  brand: { title: "My Catalog" },
};

export const FULL_VALID = {
  $schema:
    "https://cdn.jsdelivr.net/npm/@ocx-sh/catalog/src/config/schema/catalog.config.schema.json",
  configVersion: 1,
  sources: [
    { path: "packages", label: "local", root: true },
    { url: "https://example.com/index.json", label: "remote" },
    { git: "https://example.com/repo.git", ref: "main", dir: "catalog" },
  ],
  brand: { title: "My Catalog", wordmark: "my.catalog.example", logo: "assets/logo.svg" },
  nav: [{ text: "Docs", link: "/docs/" }],
  docs: "docs",
  css: "styles/custom.css",
  publicDir: "static",
  ci: { forge: "github", verifyCi: true, someUnknownKey: "ignored" },
  siteUrl: "https://example.test",
  description: "A test catalog.",
  favicon: "/favicon.svg",
};

export type { ConfigErrorCode };
