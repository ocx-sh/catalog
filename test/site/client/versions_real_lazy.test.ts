// @vitest-environment happy-dom
//
// The versions island on the REAL `@ocx-sh/theme/lazy` (T.6, C-011): the theme's trigger layer arms,
// loads and starts the island, and replays the one "show all versions" click that arrived while the
// island was still loading.
import { mount as themeMount } from "@ocx-sh/theme/lazy";
import { afterEach, expect, test, vi } from "vitest";
import type { LazyMount } from "../../../src/site/client/mount.js";
import { mount } from "../../../src/site/client/versions.js";

afterEach(() => {
  document.body.replaceChildren();
});

const digest = (c: string) => ({ content: `sha256:${c.repeat(64)}`, observed: "2026-01-01T00:00:00Z" });

function island(): HTMLElement {
  document.body.innerHTML = `
    <section data-versions data-zag-root="versions" data-ns="tools" data-pkg="widget" data-wire-base="index/acme" data-name="acme/tools/widget" data-base="/catalog/">
      <div data-zag-root="menu"><ul data-versions-list><li data-tag="1.0.0" tabindex="0"><span data-tag-name>1.0.0</span></li></ul></div>
      <button type="button" data-versions-more>Show all versions</button>
      <template data-versions-tag><li data-tag tabindex="0"><span data-tag-name></span></li></template>
      <p data-versions-preview role="status" hidden></p>
      <p data-versions-status aria-live="polite"></p>
    </section>`;
  return document.querySelector("section") as HTMLElement;
}

test("nothing loads before the first interaction; an early click is replayed once after the one load", async () => {
  const loads = vi.fn();
  const lazy: LazyMount = {
    mount: (root, spec) =>
      themeMount(root, {
        ...spec,
        load: () => {
          loads();
          return spec.load();
        },
      }),
  };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ name: "acme/tools/widget", tags: { "1.0.0": digest("a"), "0.9.0": digest("b") } })));
  const el = island();
  const handle = mount(el, { lazy, fetch });
  expect(el.dataset.zagState).toBeUndefined();
  expect(loads).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  el.dispatchEvent(new Event("pointerenter"));
  el.querySelector<HTMLButtonElement>("[data-versions-more]")?.click();
  await vi.waitFor(() => expect(el.querySelectorAll("[data-versions-list] [data-tag]")).toHaveLength(2));

  expect(el.dataset.zagState).toBe("live");
  expect(loads).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/catalog/index/acme/p/tools/widget/_root.json");
  handle.destroy();
});
