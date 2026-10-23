// @vitest-environment happy-dom
//
// The README provenance menu's links, made absolute against the open page (D-085). The markup is what
// `components/ReadmePane.astro` renders around the theme's `CopyMenu` (the contract is the docblock of
// `client/readme_provenance.ts`).
import { describe, expect, test } from "vitest";
import { absolutizeProvenance } from "../../../src/site/client/readme_provenance.js";

const HREF = "/catalog/p/acme/tool/o/sha256/aa.md";

function menu(): HTMLElement {
  document.body.innerHTML = `<div data-readme-provenance data-path="${HREF}">
    <div data-part="item" data-value="digest" data-copy-text="sha256:aa"></div>
    <div data-part="item" data-value="url" data-copy-text="${HREF}"></div>
    <div data-part="item" data-value="curl" data-copy-text="curl -sL ${HREF}"></div>
  </div>`;
  return document.querySelector<HTMLElement>("[data-readme-provenance]")!;
}
const text = (root: HTMLElement, value: string) => root.querySelector(`[data-value="${value}"]`)?.getAttribute("data-copy-text");

describe("D-085 the provenance menu copies absolute links", () => {
  test("D-085 'Copy URL' and 'Copy fetch command' take the origin of the page that is open", () => {
    const root = menu();

    absolutizeProvenance(root, "https://index.example/catalog/tools/modern/");

    expect(text(root, "url")).toBe("https://index.example/catalog/p/acme/tool/o/sha256/aa.md");
    expect(text(root, "curl")).toBe("curl -sL https://index.example/catalog/p/acme/tool/o/sha256/aa.md");
  });

  test("D-085 'Copy digest' is left as rendered: the digest has no origin", () => {
    const root = menu();

    absolutizeProvenance(root, "https://index.example/catalog/tools/modern/");

    expect(text(root, "digest")).toBe("sha256:aa");
  });

  test("D-085 a menu that lost its link items is left alone, not a throw", () => {
    document.body.innerHTML = `<div data-readme-provenance data-path="${HREF}"></div>`;

    expect(() => absolutizeProvenance(document.querySelector<HTMLElement>("[data-readme-provenance]")!, "https://index.example/")).not.toThrow();
  });
});
