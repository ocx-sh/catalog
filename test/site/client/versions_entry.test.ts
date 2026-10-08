// @vitest-environment happy-dom
//
// The versions island's page-facing entry (T.6, gate G1 pending): `mount(el, { lazy })`
// registers one interaction mount on the element and nothing else happens until the
// trigger fires; the session it starts reads `data-base` from the element.
import { afterEach, describe, expect, test, vi } from "vitest";
import { mount } from "../../../src/site/client/versions.js";
import { createLazyDouble } from "./lazy_double.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function island(): HTMLElement {
  document.body.innerHTML = `
    <section data-ns="tools" data-pkg="widget" data-wire-base="index/acme" data-name="acme/tools/widget" data-base="/catalog/">
      <div data-zag-root="menu"><ul data-versions-list><li data-tag="1.0.0" tabindex="0"><span data-tag-name>1.0.0</span></li></ul></div>
      <button type="button" data-versions-more>Show all versions</button>
      <template data-versions-tag><li data-tag tabindex="0"><span data-tag-name></span></li></template>
      <p data-versions-preview role="status" hidden></p>
      <p data-versions-status aria-live="polite"></p>
    </section>`;
  return document.querySelector("section") as HTMLElement;
}

describe("mount", () => {
  test("registers exactly one interaction mount on the element and loads nothing until it fires", () => {
    const lazy = createLazyDouble();
    const fetch = vi.fn();
    const el = island();

    const handle = mount(el, { lazy, fetch });

    expect(lazy.mounts).toHaveLength(1);
    expect(lazy.mounts[0]?.root).toBe(el);
    expect(lazy.mounts[0]?.spec.trigger).toBe("interaction");
    expect(fetch).not.toHaveBeenCalled();
    handle.destroy();
    expect(lazy.mounts[0]?.destroyed).toBe(true);
  });

  test("the started session reads data-base and the wire base from the element", async () => {
    const lazy = createLazyDouble();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ name: "acme/tools/widget", tags: { "1.0.0": { content: `sha256:${"a".repeat(64)}`, observed: "2026-01-01T00:00:00Z" }, "0.9.0": { content: `sha256:${"b".repeat(64)}`, observed: "2026-01-01T00:00:00Z" } } })));
    const el = island();
    const handle = mount(el, { lazy, fetch });

    await lazy.mounts[0]?.fire();
    el.querySelector<HTMLButtonElement>("[data-versions-more]")?.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith("/catalog/index/acme/p/tools/widget/_root.json");
    handle.destroy();
  });
});
