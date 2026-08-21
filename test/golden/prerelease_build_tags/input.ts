/**
 * 9th golden case (plan_index_v1 C-004's "+1", added post-review) — pins
 * the version-grammar edge `version_order.ts`'s two regexes discriminate,
 * plus the `ensure_ascii` byte-gate `serializeCatalog` must replicate.
 * Expected output: `../expected/catalog.json`, generated from the BOT
 * itself as reference implementation (`_catalog_index` +
 * `json.dumps(catalog, indent=2) + "\n"`, `core/render.py`) via a
 * throwaway script, never committed — not transcribed from an existing
 * bot golden fixture like the other 8 cases.
 *
 * Tag set, one live tag per grammar-discriminating branch:
 *   - "1.0.0": unprefixed, no prerelease/build. The ONLY tag `VERSION_RE`
 *     (the narrower grammar `findLatestVersion` uses) accepts — wins
 *     `latestVersion`.
 *   - "1.1.0-rc1": unprefixed + prerelease, no build. `OCX_VERSION_RE`
 *     accepts it (`parseVersion` succeeds, build-fragment group is
 *     `undefined`), but `VERSION_RE` rejects the trailing `-rc1` outright
 *     — excluded from `findLatestVersion`, not build-pinned, no variant.
 *   - "1.1.0-rc1_20260101": unprefixed + prerelease + build.
 *     `OCX_VERSION_RE`'s build-fragment capture is populated ->
 *     `isBuildPinnedVersion` true. Still rejected by `VERSION_RE`
 *     (`findLatestVersion`), still no variant prefix.
 *   - "slim-1.1.0-rc1_20260216": prefixed + prerelease + build, all three
 *     grammar features at once — contributes `"slim"` to `variantNames`,
 *     `isBuildPinnedVersion` true, and excluded from `findLatestVersion`
 *     twice over (`VERSION_RE` rejects the suffix, AND
 *     `find_latest_version`/`findLatestVersion` skips any tag whose
 *     prefix group is non-null regardless of grammar depth).
 *
 * `desc.description` carries `"café ☕"` — both `é` and `☕` are non-ASCII
 * BMP code units, so the bot's reference bytes escape them
 * (`é`/`☕`, Python `ensure_ascii=True`) — `serializeCatalog`'s
 * naive `JSON.stringify` would instead pass them through raw UTF-8 and
 * byte-diverge; this case is the golden that would catch that.
 *
 * `isBuildPinnedVersion` never itself surfaces in `catalog.json` — no
 * assertion for it belongs in this fixture; see `version_order.ts`'s
 * companion unit tests (testing phase) for that.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { digest, indexBytes } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "acme", package: "polyglot" },
    root: {
      name: "ocx.sh/acme/polyglot",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-08-01",
      desc: {
        title: "Polyglot",
        description: "A café ☕ of version grammars.",
        keywords: ["grammar", "tags"],
        readme: null,
        logo: null,
      },
      tags: {
        "1.0.0": { content: digest("1"), observed: "2026-08-01T00:00:00Z", yanked: null },
        "1.1.0-rc1": { content: digest("2"), observed: "2026-08-02T00:00:00Z", yanked: null },
        "1.1.0-rc1_20260101": {
          content: digest("3"),
          observed: "2026-08-03T00:00:00Z",
          yanked: null,
        },
        "slim-1.1.0-rc1_20260216": {
          content: digest("4"),
          observed: "2026-08-04T00:00:00Z",
          yanked: null,
        },
      },
    },
    contentByDigest: {
      [`${digest("1")}.json`]: indexBytes("1.0.0"),
      [`${digest("2")}.json`]: indexBytes("1.1.0-rc1"),
      [`${digest("3")}.json`]: indexBytes("1.1.0-rc1_20260101"),
      [`${digest("4")}.json`]: indexBytes("slim-1.1.0-rc1_20260216"),
    },
  },
];
