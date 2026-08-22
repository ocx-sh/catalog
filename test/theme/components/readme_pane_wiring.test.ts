// @vitest-environment jsdom
//
// WP-08 integration pin: ReadmePane must route markdown-it's output through
// the sanitizer before it reaches `v-html`. The sanitizer itself is covered
// exhaustively in `test/theme/utils/sanitize.test.ts`; this test exists so a
// future refactor cannot quietly unwire the chokepoint — the failure mode
// that made the module dead code for its first three rounds of review.
//
// jsdom, not this package's happy-dom default (C-608): the mounted-DOM
// describe block below actually calls the real `sanitizeReadmeHtml`
// (DOMPurify), which silently drops content under happy-dom — see
// `sanitize.ts`'s own header docblock and `sanitize.test.ts`'s identical
// environment override. The grep-only describe blocks below don't need a
// DOM at all, so this override is safe for the whole file either way.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import ReadmePane from "../../../src/theme/components/detail/ReadmePane.vue";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/theme/components/detail/ReadmePane.vue"),
  "utf8",
);

describe("ReadmePane sanitizer wiring", () => {
  // C-606: the sanitizer (dompurify, ~29KB) moved from a static top-level
  // import into this component's existing dynamic-import group (alongside
  // markdown-it/highlight.js) so it leaves the grid entry chunk too — a
  // static `import { sanitizeReadmeHtml } from '../../utils/sanitize'` must
  // never come back (that would re-widen the entry chunk this split shrinks).
  test("imports the sanitizer chokepoint dynamically, never statically", () => {
    expect(SOURCE).not.toMatch(/^\s*import\s*\{\s*sanitizeReadmeHtml\s*\}\s*from/m);
    expect(SOURCE).toMatch(/import\(['"]\.\.\/\.\.\/utils\/sanitize['"]\)/);
    expect(SOURCE).toMatch(/\{\s*sanitizeReadmeHtml\s*\}/);
  });

  test("every markdown render is wrapped in sanitizeReadmeHtml before assignment", () => {
    const renders = SOURCE.match(/md\.render\([^)]*\)/g) ?? [];
    expect(renders.length).toBeGreaterThan(0);
    for (const call of renders) {
      const index = SOURCE.indexOf(call);
      const preceding = SOURCE.slice(Math.max(0, index - 60), index);
      expect(preceding).toContain("sanitizeReadmeHtml(");
    }
  });

  test("markdown-it stays configured with html:false (defence in depth, not replaced by the sanitizer)", () => {
    expect(SOURCE).toMatch(/html:\s*false/);
  });
});

// C-608: replaces/augments the lexical-only checks above with a REAL mount
// — the source-text pin above proves `sanitizeReadmeHtml(` wraps every
// `md.render()` call, but not that the resulting DOM is actually safe (a
// wrapper that sanitized the wrong variable would still pass that grep).
describe("C-608 ReadmePane XSS — mounted DOM assertion", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("a README carrying a raw <script> and an onerror img never produces a live script/handler in the rendered DOM", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    // Two payload classes: raw HTML (`<script>`, the onerror `<img>`) and a
    // `javascript:`-scheme markdown image. Empirically (verified by
    // temporarily deleting the `sanitizeReadmeHtml(` wrap and re-running
    // this test): under THIS pipeline's markdown-it config, BOTH classes
    // are already neutralized before ever reaching the sanitizer —
    // `html:false` escapes raw HTML to inert text, and markdown-it's own
    // built-in link/image scheme validator refuses to construct a
    // `javascript:` element at all (falls back to literal text). So this
    // mounted test's decisive value is proving the FULL render pipeline
    // produces safe DOM for a realistic hostile README end-to-end — not
    // isolating `sanitizeReadmeHtml` specifically from markdown-it's other
    // two independent layers (that isolation is `sanitize.test.ts`'s job:
    // it calls `sanitizeReadmeHtml` directly with raw HTML strings that
    // bypass markdown-it entirely, so ITS red/green is decisive for the
    // sanitizer alone). Two independent guards defending one property both
    // staying green when either alone is deleted is expected, not a gap —
    // see quality-core.md's "Unchecked Green" corollary.
    const payload = [
      "# Hello",
      "",
      "before-marker",
      "",
      "<script>alert(1)</script>",
      "",
      '<img src="x" onerror="alert(1)">',
      "",
      "![evil](javascript:alert(1))",
      "",
      "after-marker",
    ].join("\n");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(payload) }),
    ) as unknown as typeof fetch;

    const wrapper = mount(ReadmePane, { props: { bareName: "ns/pkg", digest } });
    await vi.waitFor(() => expect(wrapper.find(".readme-content").exists()).toBe(true));
    await flushPromises();

    const content = wrapper.find(".readme-content");
    // Decisive DOM-shape assertions — no live <script> element, no live
    // event-handler attribute, no live javascript:-scheme attribute
    // anywhere in the rendered TREE (`querySelector` walks real DOM
    // nodes/attributes, not source text — the payload's words surviving as
    // escaped/inert display text is fine and expected; what must never
    // happen is either becoming a real element/attribute).
    expect(content.element.querySelector("script")).toBeNull();
    expect(content.element.querySelector("[onerror]")).toBeNull();
    expect(content.element.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(content.html()).not.toMatch(/<script/i);
    // Surrounding content still rendered — a broken sanitizer wouldn't just
    // drop the payload, it would drop the whole render or throw.
    expect(content.text()).toContain("before-marker");
    expect(content.text()).toContain("after-marker");

    wrapper.unmount();
  });
});
