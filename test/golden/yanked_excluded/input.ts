/**
 * TS transcription of Python `_case_yanked_excluded` (`bot/tests/core/test_render.py:215-250`).
 * Expected output: `../expected/catalog.json`.
 *
 * `yanked.at` (2026-07-20) is strictly later than the live tag's `observed`
 * (2026-07-17) — proves `latestActivity`/`generatedTimestamp` actually fold
 * in `yanked.at`, not just `observed`. The yanked tag's image index also
 * carries a platform (windows/amd64) distinct from the live tag's
 * (linux/amd64), so the golden `platforms` array proves exclusion by
 * absence, not coincidence.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "astral-sh", package: "uv" },
    root: {
      name: "ocx.sh/astral-sh/uv",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-06-01",
      desc: null,
      tags: {
        "1.0.0": { content: digest("x"), observed: "2026-07-17T00:00:00Z", yanked: null },
        "0.9.0": {
          content: digest("y"),
          observed: "2026-07-01T00:00:00Z",
          yanked: { reason: "broken build", at: "2026-07-20T00:00:00Z" },
        },
      },
    },
    contentByDigest: {
      [`${digest("x")}.json`]: indexBytes("1.0.0"),
      [`${digest("y")}.json`]: indexBytes("0.9.0-yanked", [
        { architecture: "amd64", os: "windows" },
      ]),
    },
  },
];
