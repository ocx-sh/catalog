/**
 * TS transcription of Python `_case_normal` (`bot/tests/core/test_render.py:147-192`).
 * Expected output: `../expected/catalog.json` (byte-copied from the bot's
 * `tests/golden/render/normal/expected/dist/data/catalog/catalog.json`).
 *
 * Different platform sets across the two live tags — exercises
 * `catalogPlatforms`' union + dedup (linux/amd64 shared by both) + sort
 * (darwin/arm64 sorts before linux/amd64). This is the one case carrying a
 * full `desc` (readme + logo + keywords), proving `logoUrl`/`readmeUrl`
 * resolve.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes, utf8 } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "kitware", package: "cmake" },
    root: {
      name: "ocx.sh/kitware/cmake",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-07-17",
      desc: {
        title: "CMake",
        description: "Cross-platform build system generator.",
        keywords: ["build", "cmake"],
        readme: digest("r"),
        logo: digest("l"),
      },
      tags: {
        "1.0.0": { content: digest("1"), observed: "2026-07-17T00:00:00Z", yanked: null },
        "0.9.0": { content: digest("2"), observed: "2026-07-16T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("1")}.json`]: indexBytes("1.0.0", [{ architecture: "amd64", os: "linux" }]),
      [`${digest("2")}.json`]: indexBytes("0.9.0", [
        { architecture: "amd64", os: "linux" },
        { architecture: "arm64", os: "darwin" },
      ]),
      [`${digest("r")}.md`]: utf8("# CMake\n\nCross-platform build system generator.\n"),
      [`${digest("l")}.svg`]: utf8("<svg>cmake-logo</svg>"),
    },
  },
];
