import { describe, it, expect } from "vitest";
import { renderString, renderTemplate } from "../../src/ci/templates.js";

describe("C-007 template engine", () => {
  it("substitutes {{key}} placeholders", () => {
    expect(renderString("uses: actions/checkout@{{pin}}", { pin: "sha" })).toBe(
      "uses: actions/checkout@sha",
    );
  });

  it("leaves GitHub Actions' ${{ ... }} expressions alone", () => {
    const input = "run: echo ${{ github.event.pull_request.number }}";
    expect(renderString(input, {})).toBe(input);
  });

  it("throws on a placeholder with no matching var", () => {
    expect(() => renderString("{{missing}}", {})).toThrow(/unknown placeholder \{\{missing\}\}/);
  });

  it("reads and substitutes a real shipped template", () => {
    const rendered = renderTemplate("ci/github-verify-job.yml", {
      checkoutPin: "csha  # v1",
      setupSteps: "      - uses: actions/setup-node@nsha  # v1",
      installCmd: "npm ci",
      execPrefix: "npx",
    });
    expect(rendered).toContain("uses: actions/checkout@csha  # v1");
    expect(rendered).toContain("uses: actions/setup-node@nsha  # v1");
    expect(rendered).toContain("npx ocx-catalog ci --check");
  });

  it("throws a clear error for a template that doesn't ship", () => {
    expect(() => renderTemplate("ci/does-not-exist.yml", {})).toThrow(/is missing from/);
  });
});
