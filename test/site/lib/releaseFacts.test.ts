import { describe, expect, it } from "vitest";
import { imageIndexFacts, NO_FACTS } from "../../../src/site/lib/releaseFacts.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const LICENSE = "org.opencontainers.image.licenses";
const SOURCE = "org.opencontainers.image.source";
const REVISION = "org.opencontainers.image.revision";

function manifest(os: unknown, architecture: unknown) {
  return { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: DIGEST, size: 1, platform: { os, architecture } };
}

describe("imageIndexFacts — one image index read the same way at build and in the browser (D-060, D-071)", () => {
  it("D-060: reads the platforms, license, source and revision of an index", () => {
    const facts = imageIndexFacts(
      {
        manifests: [manifest("linux", "arm64"), manifest("linux", "amd64"), manifest("linux", "amd64")],
        annotations: { [LICENSE]: "MIT", [SOURCE]: "https://example.com/r", [REVISION]: "abc123" },
      },
      DIGEST,
    );

    expect(facts).toEqual({ platforms: ["linux/amd64", "linux/arm64"], license: "MIT", source: "https://example.com/r", revision: "abc123" });
  });

  it("D-071: leaves out the unknown/unknown attestation entries and entries with a non-text platform", () => {
    const facts = imageIndexFacts(
      { manifests: [manifest("unknown", "unknown"), manifest(1, "amd64"), manifest("linux", null), manifest("darwin", "arm64")] },
      DIGEST,
    );
    expect(facts.platforms).toEqual(["darwin/arm64"]);
  });

  it("D-062: an index without annotations has no license, source or revision", () => {
    expect(imageIndexFacts({ manifests: [] }, DIGEST)).toEqual(NO_FACTS);
  });

  it("D-062: a malformed annotations value costs the annotations, not the platforms", () => {
    const facts = imageIndexFacts({ manifests: [manifest("linux", "amd64")], annotations: [LICENSE] }, DIGEST);
    expect(facts).toEqual({ platforms: ["linux/amd64"], license: null, source: null, revision: null });
  });

  it("D-062: a body that is no object has no facts", () => {
    for (const body of [null, 3, "x", ["a"]]) expect(imageIndexFacts(body, DIGEST)).toBe(NO_FACTS);
  });

  it("D-062: a manifests value that is no list has no platforms", () => {
    expect(imageIndexFacts({ manifests: "linux" }, DIGEST).platforms).toEqual([]);
  });
});
