/**
 * C-304: `synthesizePages`'s package-page write loop used to be an
 * unbounded `Promise.all` — one `mkdir`+`writeFile` pair opened per
 * resolved package, all at once. A large index (thousands of packages)
 * turned that into thousands of concurrent filesystem writes in flight
 * simultaneously. The fix routes every package-page write through the
 * SAME `Semaphore` primitive `walker.ts` already bounds its fetch queue
 * with (cap 16), reused via `walker.ts`'s own export rather than
 * reinvented here.
 *
 * This needs to observe REAL `node:fs/promises` `writeFile` concurrency,
 * which the rest of `pages.test.ts` exercises un-mocked — isolated in its
 * own file so this mock (and its artificial per-write delay) never touches
 * those tests (vitest mocks are file-scoped, same reasoning as
 * `test/sources/walker-cache-concurrency.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let activeWrites = 0;
let maxActiveWrites = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      // Only PACKAGE-page writes are gated by C-304's semaphore — the two
      // always-on root pages (index.md/404.md) are fixed at exactly 2,
      // never scale with package count, and are deliberately NOT routed
      // through it (see pages.ts's own doc); counting them here would pad
      // the observed max by a constant unrelated to the bound under test.
      const isPackageWrite = String(args[0]).includes("pkg");
      if (isPackageWrite) {
        activeWrites++;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      }
      try {
        // Long enough that, WITHOUT the semaphore gating these writes, a
        // large package count would visibly stack far past PAGE_WRITE_CONCURRENCY
        // (16) before any of these settle.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await actual.writeFile(...(args as Parameters<typeof actual.writeFile>));
      } finally {
        if (isPackageWrite) activeWrites--;
      }
    },
  };
});

const { synthesizePages } = await import("../../src/build/pages.js");
const { createScratchRoot } = await import("../../src/build/scratch.js");

const cleanupRoots: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((dispose) => dispose()));
  activeWrites = 0;
  maxActiveWrites = 0;
});

describe("C-304 synthesizePages — package-page writes stay bounded (16)", () => {
  it("never has more than 16 node:fs/promises writeFile calls in flight, across a large package set", async () => {
    const root = await createScratchRoot();
    cleanupRoots.push(() => root.dispose());

    const packageCount = 60;
    const packages = Array.from({ length: packageCount }, (_, i) => {
      const segments = ["ns", `pkg${String(i).padStart(3, "0")}`];
      return { segments, namespace: segments[0]!, package: segments.slice(1).join("/"), wireBase: "" };
    });

    await synthesizePages({ scratchRoot: root.path, srcDir: "src", packages });

    expect(maxActiveWrites).toBeLessThanOrEqual(16);
    expect(maxActiveWrites).toBeGreaterThan(1);
  });
});
