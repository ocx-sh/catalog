import { describe, it, expect } from "vitest";
import { normalizeForDrift } from "../../src/ci/normalize.js";

describe("C-007 normalizeForDrift", () => {
  it("normalizes CRLF to LF", () => {
    expect(normalizeForDrift("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("strips @ref and a trailing comment from a uses: line", () => {
    const input = "      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1\n";
    expect(normalizeForDrift(input)).toBe("      - uses: actions/checkout\n");
  });

  it("strips @ref from a uses: line with no trailing comment", () => {
    const input = "      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n";
    expect(normalizeForDrift(input)).toBe("      - uses: actions/checkout\n");
  });

  it("strips @ref from a uses: line without the list-dash prefix", () => {
    const input = "uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n";
    expect(normalizeForDrift(input)).toBe("uses: actions/checkout\n");
  });

  it("a bumped pin and its unbumped twin normalize identically (S-004)", () => {
    const before = "      - uses: actions/checkout@aaa  # v4.3.0\n";
    const after = "      - uses: actions/checkout@bbb  # v4.3.1\n";
    expect(normalizeForDrift(before)).toBe(normalizeForDrift(after));
  });

  it("strips a digest ref from a GitLab image: line", () => {
    const input = "image: node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    expect(normalizeForDrift(input)).toBe("image: node:22-alpine\n");
  });

  it("leaves lines carrying neither uses: nor image: untouched", () => {
    const input = "name: catalog-ci\non:\n  push:\n    branches: [main]\n";
    expect(normalizeForDrift(input)).toBe(input);
  });

  it("swapping the action itself still trips drift (only the suffix is stripped)", () => {
    const checkout = normalizeForDrift("uses: actions/checkout@sha\n");
    const setupNode = normalizeForDrift("uses: actions/setup-node@sha\n");
    expect(checkout).not.toBe(setupNode);
  });
});
