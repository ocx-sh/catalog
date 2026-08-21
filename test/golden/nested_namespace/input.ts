/**
 * TS transcription of Python `_case_nested_namespace` (`bot/tests/core/test_render.py:316-341`).
 * Expected output: `../expected/catalog.json`.
 *
 * Despite the case name, nothing about this fixture's namespace is
 * structurally nested — it exercises the same full-desc shape as `normal`
 * (readme `.md` + logo `.svg`) against a different package to widen golden
 * coverage.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes, utf8 } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "regclient", package: "regsync" },
    root: {
      name: "ocx.sh/regclient/regsync",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-02-01",
      desc: {
        title: "regsync",
        description: "Utility to sync images between registries.",
        keywords: ["oci", "registry", "sync"],
        readme: digest("q"),
        logo: digest("w"),
      },
      tags: {
        "0.7.0": { content: digest("n"), observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("n")}.json`]: indexBytes("0.7.0"),
      [`${digest("q")}.md`]: utf8("# regsync\n\nUtility to sync images between registries.\n"),
      [`${digest("w")}.svg`]: utf8("<svg>regsync-logo</svg>"),
    },
  },
];
