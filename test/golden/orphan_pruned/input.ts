/**
 * TS transcription of Python `_case_orphan_pruned` (`bot/tests/core/test_render.py:195-212`).
 * Expected output: `../expected/catalog.json`.
 *
 * `contentByDigest` carries a second `.json` blob referenced by no tag and
 * no desc — irrelevant to the catalog emitter (which only ever looks up
 * digests it already knows are live from `root.tags`), but kept here for
 * fixture fidelity with the Python source, where it proves CAS *file*
 * pruning, a concern outside this WP's scope.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "oven-sh", package: "bun" },
    root: {
      name: "ocx.sh/oven-sh/bun",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-07-10",
      desc: null,
      tags: {
        "1.2.0": { content: digest("a"), observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("a")}.json`]: indexBytes("1.2.0"),
      [`${digest("b")}.json`]: indexBytes("orphaned"),
    },
  },
];
