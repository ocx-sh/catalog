// @vitest-environment jsdom
//
// The shipped detail page feeds the versions island: the `[data-versions]` section is cut out of
// the BUILT HTML of tools/many-tags (25 tags, 20 in the page), mounted with `mount()` over the lazy
// double, and driven against the BUILT wire tree. A drift between `VersionList.astro` and the DOM
// contract at the top of `client/versions.ts` fails here, which unit tests on a hand-made DOM
// cannot show. The theme's trigger is played by the double (the real one: test/site/client/versions_real_lazy.test.ts).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { mount } from "../../src/site/client/versions.js";
import { createLazyDouble } from "../site/client/lazy_double.js";

// `./helpers.js` is not imported: it resolves the repo root from `import.meta.url`, which a DOM
// environment rewrites. The provided value is the same one `site("catalog")` returns.
const catalogSite = (): string => (inject as (key: string) => Record<string, string>)("acceptanceSites").catalog as string;

afterEach(() => {
  document.body.replaceChildren();
});

/** Serves the built site's files under `/catalog/`; anything else is a 404. */
const builtWire = (dir: string) =>
  vi.fn(async (url: string) => {
    if (!url.startsWith("/catalog/")) return new Response("", { status: 404 });
    try {
      return new Response(await readFile(join(dir, url.slice("/catalog/".length))));
    } catch {
      return new Response("", { status: 404 });
    }
  });

async function mountBuilt() {
  const dir = catalogSite();
  const html = await readFile(join(dir, "tools/many-tags/index.html"), "utf8");
  const section = /<section[^>]*\sdata-versions[\s>][\s\S]*?<\/section>/.exec(html)?.[0];
  expect(section, "the built page has a [data-versions] section").toBeDefined();
  document.body.innerHTML = section as string;
  const el = document.querySelector<HTMLElement>("[data-versions]") as HTMLElement;
  const lazy = createLazyDouble();
  const copy = vi.fn(async () => {});
  const fetch = builtWire(dir);
  const handle = mount(el, { lazy, fetch, copy });
  await lazy.mounts[0]?.fire();
  return { el, fetch, copy, handle };
}

const tagsIn = (el: Element) => [...el.querySelectorAll("[data-versions-list] [data-tag]")].map((tag) => tag.getAttribute("data-tag"));

describe("the built many-tags page drives the versions island", () => {
  it("show all versions appends the remaining 5 live tags from the mirrored root, base-joined", async () => {
    const { el, fetch, handle } = await mountBuilt();
    expect(tagsIn(el)).toHaveLength(20);

    el.querySelector<HTMLButtonElement>("[data-versions-more]")?.click();
    await vi.waitFor(() => expect(el.querySelector<HTMLButtonElement>("[data-versions-more]")?.hidden).toBe(true));

    expect(tagsIn(el)).toHaveLength(25);
    expect(new Set(tagsIn(el)).size).toBe(25);
    expect(fetch.mock.calls.every(([url]) => url.startsWith("/catalog/p/tools/many-tags"))).toBe(true);
    expect(el.querySelector("[data-versions-status]")?.textContent).toBe("Showing all 25 versions.");
    handle.destroy();
  });

  it("a menu selection copies the install command for the tag the menu opened on", async () => {
    const { el, copy, handle } = await mountBuilt();
    const tag = el.querySelector("[data-versions-list] [data-tag]") as HTMLElement;

    tag.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
    el.querySelector("[data-zag-root='menu']")?.dispatchEvent(
      new CustomEvent("ocx:menu:select", { bubbles: true, detail: { value: "Install package" } }),
    );

    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(`ocx package install index-a/tools/many-tags:${tag.dataset.tag}`));
    handle.destroy();
  });
});
