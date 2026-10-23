import { describe, expect, test } from "vitest";
import { fetchCommand, readmeProvenance } from "../../../src/site/lib/readmeProvenance.js";

const HEX = "a1".repeat(32);

describe("D-085 the README provenance menu's texts", () => {
  test("D-085 the digest is the sha256 of the README's content-addressed path, as the wire root writes it", () => {
    const provenance = readmeProvenance(`/p/acme/tool/o/sha256/${HEX}.md`, "/");

    expect(provenance).toEqual({ digest: `sha256:${HEX}`, href: `/p/acme/tool/o/sha256/${HEX}.md` });
  });

  test("D-085 the path is joined onto the base, so a site under /catalog/ copies a URL that resolves", () => {
    const provenance = readmeProvenance(`/index/b/p/acme/tool/o/sha256/${HEX}.md`, "/catalog/");

    expect(provenance?.href).toBe(`/catalog/index/b/p/acme/tool/o/sha256/${HEX}.md`);
    expect(provenance?.digest).toBe(`sha256:${HEX}`);
  });

  test("D-085 a package with no README, or a path that is no content-addressed README, offers no menu", () => {
    expect(readmeProvenance(null, "/")).toBeNull();
    expect(readmeProvenance("/p/acme/tool/README.md", "/")).toBeNull();
    expect(readmeProvenance(`/p/acme/tool/o/sha256/${HEX}.svg`, "/")).toBeNull();
    expect(readmeProvenance(`/p/acme/tool/o/sha256/${HEX.slice(1)}.md`, "/")).toBeNull();
  });

  test("D-085 the path is anchored at both ends: a lookalike suffix or a path outside /p/ offers no menu", () => {
    expect(readmeProvenance(`/evil/o/sha256/${HEX}.md`, "/")).toBeNull();
    expect(readmeProvenance(`/other/p/acme/tool/o/sha256/${HEX}.md`, "/")).toBeNull();
    expect(readmeProvenance(`/index/b/other/p/acme/tool/o/sha256/${HEX}.md`, "/")).toBeNull();
    expect(readmeProvenance(`/p/o/sha256/${HEX}.md`, "/")).toBeNull();
    expect(readmeProvenance(`x/p/acme/tool/o/sha256/${HEX}.md`, "/")).toBeNull();
  });

  test("D-085 the fetch command is `curl -sL` and the URL", () => {
    expect(fetchCommand("https://index.example/p/acme/tool/o/sha256/x.md")).toBe("curl -sL https://index.example/p/acme/tool/o/sha256/x.md");
  });
});
