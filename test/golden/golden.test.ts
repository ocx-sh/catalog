/**
 * Byte-exact gate for the C-004 emitter port: every `test/golden/<case>/`
 * directory pairs an `input.ts` (`ordered: readonly CatalogSourcePackage[]`)
 * with a committed `expected/catalog.json` — the bytes the Python bot itself
 * emits for that input (see each case's own doc comment for provenance).
 * `catalogIndex(ordered)` piped through `serializeCatalog(...)` must
 * reproduce those bytes exactly.
 *
 * Case directories are discovered at collection time (`readdirSync`), not
 * hardcoded — a 10th case directory joins this suite automatically, no edit
 * here required.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogIndex, serializeCatalog } from "../../src/viewmodel/catalog.js";
import type { CatalogSourcePackage } from "../../src/viewmodel/types.js";

const GOLDEN_ROOT = fileURLToPath(new URL(".", import.meta.url));

const caseNames = readdirSync(GOLDEN_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Human-usable diagnostic for a golden mismatch: the first byte offset the
 * two buffers diverge at, plus surrounding context from both sides. Buffers
 * may differ in length; `offset` still lands at the first point either the
 * bytes differ or one buffer runs out.
 */
function firstDivergenceMessage(caseName: string, actual: Buffer, expected: Buffer): string {
  const shorter = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < shorter && actual[offset] === expected[offset]) {
    offset += 1;
  }
  const contextBytes = 40;
  const around = (buf: Buffer): string =>
    JSON.stringify(
      buf.subarray(Math.max(0, offset - contextBytes), offset + contextBytes).toString("utf8"),
    );
  const lengthNote =
    actual.length === expected.length
      ? ""
      : ` (length mismatch: actual ${actual.length} bytes, expected ${expected.length} bytes)`;
  return (
    `${caseName}: first byte divergence at offset ${offset}${lengthNote}\n` +
    `  actual:   ${around(actual)}\n` +
    `  expected: ${around(expected)}`
  );
}

describe("catalog.json golden byte gate", () => {
  it("discovered at least one golden case directory", () => {
    // Guards the discovery mechanism itself — a wrong GOLDEN_ROOT would
    // silently collect zero cases and this whole describe block would pass
    // vacuously.
    expect(caseNames.length).toBeGreaterThan(0);
  });

  for (const caseName of caseNames) {
    it(`${caseName}: catalogIndex + serializeCatalog reproduces expected/catalog.json byte-for-byte`, async () => {
      const module = (await import(`./${caseName}/input.ts`)) as {
        ordered: readonly CatalogSourcePackage[];
      };
      const expected = readFileSync(join(GOLDEN_ROOT, caseName, "expected", "catalog.json"));
      const actual = Buffer.from(serializeCatalog(catalogIndex(module.ordered)), "utf8");

      if (Buffer.compare(actual, expected) !== 0) {
        throw new Error(firstDivergenceMessage(caseName, actual, expected));
      }
    });
  }
});
