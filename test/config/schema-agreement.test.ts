/**
 * C-002 schema agreement suite: for a representative set of fixtures, checks
 * that ajv validation against the published `catalog.config.schema.json`
 * agrees with `loadConfig`'s hand-rolled accept/reject decision — the schema
 * is a "published sibling artifact for editor tooling and test-suite
 * schema-validity checks, never loaded here" (`load.ts`), so drift between
 * the two is a real correctness risk even though nothing wires them together
 * at runtime.
 *
 * Two fixtures are DELIBERATE disagreements, not gaps in this suite: the
 * schema (as published, `src/config/schema/catalog.config.schema.json`) has
 * no way to express these, so it accepts what the loader rejects.
 *   - LABEL_CONFLICT: cross-item uniqueness on `label`, not expressible with
 *     `additionalProperties`/`enum`/etc. alone.
 *   - PATH_ESCAPE: filesystem containment relative to the config file's own
 *     directory has no JSON Schema representation at all.
 *   - siteUrl URL-shape: the schema only expresses "non-empty string"
 *     (`"format": "uri"` needs `ajv-formats`, not a dependency here, and the
 *     schema is documentation-only, never ajv-loaded at runtime); `load.ts`
 *     itself does the real `new URL()` + http(s)-only check.
 * `sources[].url`'s https-only rule is NOT on that list: `pattern` expresses
 * it, so schema and loader agree on both the accept and the reject case.
 * MULTIPLE_ROOT used to be a third deliberate disagreement, but draft 2020-12
 * CAN express "at most one item matches" via `contains`/`maxContains`
 * (`minContains: 0` keeps zero root entries legal) — the schema now uses it,
 * so schema and loader agree on this case too.
 * Each remaining disagreement is asserted explicitly (schema valid, loader
 * rejects) rather than skipped, so schema/loader drift in the *dangerous*
 * direction (schema rejecting something the loader accepts) still fails
 * loudly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigErrorCode } from "../../src/config/errors.js";
import { withTempDir, writeConfig, loadConfigError, MINIMAL_VALID, FULL_VALID } from "./helpers.js";

const schemaPath = fileURLToPath(
  new URL("../../src/config/schema/catalog.config.schema.json", import.meta.url),
);

interface Fixture {
  readonly name: string;
  readonly config: unknown;
  /** Expected `loadConfig` outcome: "valid", or the code it must reject with. */
  readonly loader: "valid" | ConfigErrorCode;
  /** Expected ajv outcome against the published schema. */
  readonly schemaValid: boolean;
}

const FIXTURES: readonly Fixture[] = [
  { name: "minimal valid config", config: MINIMAL_VALID, loader: "valid", schemaValid: true },
  { name: "full valid config", config: FULL_VALID, loader: "valid", schemaValid: true },
  {
    name: "unknown key inside ci is accepted (forward-compat)",
    config: { ...MINIMAL_VALID, ci: { forge: "github", customThing: true } },
    loader: "valid",
    schemaValid: true,
  },
  {
    name: "ci.packageManager bun is accepted by both",
    config: { ...MINIMAL_VALID, ci: { forge: "github", packageManager: "bun" } },
    loader: "valid",
    schemaValid: true,
  },
  {
    name: "ci.packageManager outside the npm/bun enum is rejected by both",
    config: { ...MINIMAL_VALID, ci: { forge: "github", packageManager: "pnpm" } },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "SOURCE_DISCRIMINANT: zero of path/url/git",
    config: { sources: [{}], brand: { title: "x" } },
    loader: "SOURCE_DISCRIMINANT",
    schemaValid: false,
  },
  {
    name: "SOURCE_DISCRIMINANT: both path and url",
    config: { sources: [{ path: "a", url: "b" }], brand: { title: "x" } },
    loader: "SOURCE_DISCRIMINANT",
    schemaValid: false,
  },
  {
    name: "UNKNOWN_KEY: unrecognized top-level key",
    config: { ...MINIMAL_VALID, foo: "bar" },
    loader: "UNKNOWN_KEY",
    schemaValid: false,
  },
  {
    name: "EMPTY_SOURCES: sources is []",
    config: { sources: [], brand: { title: "x" } },
    loader: "EMPTY_SOURCES",
    schemaValid: false,
  },
  {
    name: "UNSUPPORTED_VERSION: configVersion 2",
    config: { ...MINIMAL_VALID, configVersion: 2 },
    loader: "UNSUPPORTED_VERSION",
    schemaValid: false,
  },
  {
    name: "INVALID_TYPE: sources is not an array",
    config: { sources: "nope", brand: { title: "x" } },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "INVALID_TYPE: brand missing title",
    config: { sources: [{ path: "a" }], brand: {} },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "INVALID_TYPE: sources[].path is an empty string",
    config: { sources: [{ path: "" }], brand: { title: "x" } },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "INVALID_TYPE: docs is an empty string",
    config: { ...MINIMAL_VALID, docs: "" },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "INVALID_TYPE: brand.title is an empty string",
    config: { sources: [{ path: "a" }], brand: { title: "" } },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "UNKNOWN_KEY: unrecognized key in a sources[] entry",
    config: { sources: [{ path: "a", bogus: true }], brand: { title: "x" } },
    loader: "UNKNOWN_KEY",
    schemaValid: false,
  },
  {
    name: "UNKNOWN_KEY: unrecognized key in brand",
    config: { sources: [{ path: "a" }], brand: { title: "x", bogus: true } },
    loader: "UNKNOWN_KEY",
    schemaValid: false,
  },
  {
    name: "MULTIPLE_ROOT",
    config: {
      sources: [
        { path: "a", root: true },
        { path: "b", root: true },
      ],
      brand: { title: "x" },
    },
    loader: "MULTIPLE_ROOT",
    schemaValid: false,
  },
  {
    name: "LABEL_CONFLICT (schema is weaker — see file header)",
    config: {
      sources: [
        { path: "a", label: "dup" },
        { path: "b", label: "dup" },
      ],
      brand: { title: "x" },
    },
    loader: "LABEL_CONFLICT",
    schemaValid: true,
  },
  {
    name: "PATH_ESCAPE (schema is weaker — see file header)",
    config: { ...MINIMAL_VALID, css: "../escape" },
    loader: "PATH_ESCAPE",
    schemaValid: true,
  },
  {
    // Unlike siteUrl below, https-only IS expressible in the schema
    // (`pattern`), so schema and loader agree here — a plain-http source is
    // rejected by both.
    name: "sources[].url over plain http is rejected by schema AND loader",
    config: { sources: [{ url: "http://insecure.example" }], brand: { title: "x" } },
    loader: "INVALID_TYPE",
    schemaValid: false,
  },
  {
    name: "sources[].url over https is accepted by both",
    config: { sources: [{ url: "https://index.ocx.sh" }], brand: { title: "x" } },
    loader: "valid",
    schemaValid: true,
  },
  {
    name: "siteUrl: not a URL at all (schema is weaker — see file header)",
    config: { ...MINIMAL_VALID, siteUrl: "not a url" },
    loader: "INVALID_TYPE",
    // The schema only expresses "non-empty string" for siteUrl — URL shape
    // (and http(s)-only) is a runtime-only check, load.ts's own doc says so.
    schemaValid: true,
  },
];

describe("C-002 schema/loader agreement", () => {
  let validate: ValidateFunction;

  beforeAll(() => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validate = ajv.compile(schema);
  });

  it.each(FIXTURES)("$name", async ({ config, loader, schemaValid }) => {
    expect(validate(config)).toBe(schemaValid);

    await withTempDir(async (dir) => {
      const configPath = await writeConfig(dir, config);
      if (loader === "valid") {
        await expect(loadConfig(configPath)).resolves.toBeDefined();
      } else {
        const error = await loadConfigError(configPath);
        expect(error.code).toBe(loader);
      }
    });
  });
});
