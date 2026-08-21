/**
 * TS transcription of Python `_case_shared_digest_dedup` (`bot/tests/core/test_render.py:253-270`).
 * Expected output: `../expected/catalog.json`.
 *
 * Two tags (`"0.13.0"` and `"latest"`) share one content digest — proves
 * `catalogPlatforms`/`tagCount` behavior under digest aliasing (ADR-1 D3).
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes } from "../_helpers.js";

const shared = digest("z");

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "ziglang", package: "zig" },
    root: {
      name: "ocx.sh/ziglang/zig",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-05-01",
      desc: null,
      tags: {
        "0.13.0": { content: shared, observed: "2026-07-17T00:00:00Z", yanked: null },
        latest: { content: shared, observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${shared}.json`]: indexBytes("0.13.0"),
    },
  },
];
