/**
 * TS transcription of Python `_case_png_only_logo` (`bot/tests/core/test_render.py:289-313`).
 * Expected output: `../expected/catalog.json`.
 *
 * `desc.readme` unset, `desc.logo` set — proves `readmeUrl`/`logoUrl`
 * resolve independently (complementary combo covered by
 * `nested_namespace`'s `.md`/`.svg` pair and by the bot's own
 * `test_build_render_plan_reachability_readme_without_logo`, which has no
 * committed golden of its own).
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes, utf8 } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "gitlab-org", package: "glab" },
    root: {
      name: "ocx.sh/gitlab-org/glab",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-03-01",
      desc: {
        title: "glab",
        description: "GitLab CLI.",
        keywords: ["git", "cli"],
        readme: null,
        logo: digest("p"),
      },
      tags: {
        "1.42.0": { content: digest("g"), observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("g")}.json`]: indexBytes("1.42.0"),
      // Placeholder bytes — catalogEntry never reads blob content, only the
      // digest+extension of this key (see _helpers.ts's `utf8` doc).
      [`${digest("p")}.png`]: utf8("fake-glab-logo-png-bytes"),
    },
  },
];
