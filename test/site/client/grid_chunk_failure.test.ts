// @vitest-environment happy-dom
//
// The lazy session chunk itself fails to load (a stale hash after a deploy, offline). Nothing of the island is live,
// so the page must come back from its loading state exactly as it does when catalog.json fails.
import { afterEach, describe, expect, test, vi } from "vitest";
import { gridDom } from "./grid_dom.js";
import { catalog, answering, pkg, settle, text, useGridRun } from "./grid_harness.js";
import { createLazyDouble } from "./lazy_double.js";
import type { LazyMount } from "../../../src/site/client/mount.js";

const data = catalog([pkg("a/x/one"), pkg("a/x/two")]);
useGridRun();

/** Mounts a fresh grid whose `import("./grid_session.js")` rejects, as a 404 on the chunk would. */
async function mountWithFailingChunk(root: HTMLElement) {
  vi.resetModules();
  vi.doMock("../../../src/site/client/grid_session.js", () => {
    throw new Error("Failed to fetch dynamically imported module");
  });
  const { mountGrid } = await import("../../../src/site/client/grid.js");
  const inner = createLazyDouble();
  // The theme's mount catches a failed load (it sets data-zag-state="error"); the double would otherwise leak the rejection.
  const lazy: LazyMount = {
    mount: (el, spec) => {
      const handle = inner.mount(el, spec);
      return { ...handle, start: () => handle.start().catch(() => {}) };
    },
  };
  const { destroy } = mountGrid(root, lazy, { fetch: answering(data) });
  return { mount: inner.mounts[0]!, destroy };
}

afterEach(() => vi.doUnmock("../../../src/site/client/grid_session.js"));

describe("C15 a session chunk that does not load", () => {
  test.each(["?q=modern", "?view=table"])("D-032 a cold %s is not left behind its skeleton: cards back, marks cleared, the panel says to reload", async (search) => {
    history.replaceState(null, "", `/${search}`);
    document.documentElement.dataset.catalogView = "table";
    document.documentElement.dataset.catalogWait = "";
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { destroy } = await mountWithFailingChunk(dom.root);
    // Booting at load showed the skeleton and hid the server cards.
    expect(dom.skeleton.hidden).toBe(false);
    expect(dom.cards.hidden).toBe(true);

    // The cold URL starts the island at load: the chunk request has failed once the microtasks drain.
    await settle();
    destroy();

    expect(dom.skeleton.hidden).toBe(true);
    expect(dom.cards.hidden).toBe(false);
    expect(dom.table.hidden).toBe(true);
    expect(dom.toolbar.hidden).toBe(true);
    expect(document.documentElement.dataset.catalogWait).toBeUndefined();
    expect(document.documentElement.dataset.catalogView).toBeUndefined();
    expect(dom.failure.hidden).toBe(false);
    expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("The catalog code did not load. Try reloading.");
  });

  test("D-032 the page keeps its server cards as links when the chunk fails on a plain first interaction", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { mount, destroy } = await mountWithFailingChunk(dom.root);
    await expect(mount.fire()).rejects.toThrow("error when mocking");
    destroy();
    expect(dom.cards.hidden).toBe(false);
    expect(dom.cards.querySelector("a[data-card]")).not.toBeNull();
    expect(dom.failure.hidden).toBe(false);
  });
});
