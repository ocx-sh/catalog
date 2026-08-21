/**
 * TS transcription of Python `_case_no_desc` (`bot/tests/core/test_render.py:273-286`).
 * Expected output: `../expected/catalog.json`.
 *
 * No `desc` — proves `title` falls back to `root.name`, `description`
 * falls back to `""`, `keywords`/`logoUrl`/`readmeUrl` fall back to
 * empty/`null`.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "mvdan", package: "shfmt" },
    root: {
      name: "ocx.sh/mvdan/shfmt",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-04-01",
      desc: null,
      tags: {
        "3.7.0": { content: digest("s"), observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("s")}.json`]: indexBytes("3.7.0"),
    },
  },
];
