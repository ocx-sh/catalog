/**
 * TS transcription of Python `_case_attestation_descriptor`
 * (`bot/tests/core/test_render.py:344-378`). Expected output:
 * `../expected/catalog.json`.
 *
 * ADR R4. A real registry serves attestation and referrer descriptors
 * inside the same image index as the runnable ones — cosign/buildkit
 * attestations carry `platform: {"os": "unknown", ...}`, and `platform` is
 * an optional descriptor field so a referrer may carry none at all. The
 * fourth shape is a `platform` object naming only one of the two fields:
 * nothing upstream of the catalog emitter validates `platform` at all, so
 * these are raw publisher bytes and a partial object must be skipped, not
 * throw. None of the five descriptors below names a target anything can
 * run on except the first two — the golden `catalog.json`'s `platforms`
 * array is exactly `["linux/amd64", "linux/arm64"]`.
 */
import type { CatalogSourcePackage } from "../../../src/viewmodel/types.js";
import { descriptor, digest, indexOf } from "../_helpers.js";

export const ordered: readonly CatalogSourcePackage[] = [
  {
    packageId: { namespace: "sigstore", package: "cosign" },
    root: {
      name: "ocx.sh/sigstore/cosign",
      status: "active",
      deprecatedMessage: null,
      supersededBy: null,
      created: "2026-01-01",
      desc: null,
      tags: {
        "2.0.0": { content: digest("t"), observed: "2026-07-17T00:00:00Z", yanked: null },
      },
    },
    contentByDigest: {
      [`${digest("t")}.json`]: indexOf(
        descriptor("2.0.0", { architecture: "amd64", os: "linux" }),
        descriptor("2.0.0", { architecture: "arm64", os: "linux" }),
        descriptor("2.0.0", { architecture: "unknown", os: "unknown" }),
        descriptor("2.0.0", null),
        // Partial platform object: `architecture` missing entirely.
        descriptor("2.0.0", { os: "linux" }),
      ),
    },
  },
];
