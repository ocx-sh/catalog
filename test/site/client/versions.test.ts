// @vitest-environment happy-dom
//
// The versions island against the LazyMount double (C-033, S-008). The test
// plays the theme's part: it fires the lazy trigger by hand and answers the
// copy menu by dispatching `ocx:menu:select` the way the ActionMenu machine
// does. Parity row ported from test/theme: copy_link_route_wiring (the copied
// link is the page's own route, qualified for a non-root index).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountVersions, type VersionsOptions } from "../../../src/site/client/versions.js";
import type { LazyMount } from "../../../src/site/client/mount.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { createLazyDouble, type LazyDouble } from "./lazy_double.js";

const HEX = (char: string) => char.repeat(64);
const digest = (char: string) => `sha256:${HEX(char)}`;

/** Newest first: 3.0.0, 2.0.0, 1.0.0 (yanked) is dropped, 0.9.0 is the oldest live tag. */
const ROOT = {
  name: "ocx.sh/tools/widget",
  tags: {
    "3.0.0": { content: digest("c"), observed: "2026-04-01T00:00:00Z" },
    "2.0.0": { content: digest("b"), observed: "2026-03-01T00:00:00Z" },
    "1.0.0": { content: digest("a"), observed: "2026-02-01T00:00:00Z", yanked: { reason: "bad", at: "2026-02-02T00:00:00Z" } },
    "0.9.0": { content: digest("d"), observed: "2026-01-01T00:00:00Z" },
    "bad-digest": { content: "sha256:../../etc", observed: "2025-12-01T00:00:00Z" },
  },
};

function imageIndex(...platforms: Array<{ os: string; architecture: string } | undefined>) {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: platforms.map((platform) => ({ mediaType: "m", digest: "sha256:x", size: 1, ...(platform ? { platform } : {}) })),
  };
}

const LINUX = { os: "linux", architecture: "amd64" };
const DARWIN = { os: "darwin", architecture: "arm64" };

function el(tag: string, attributes: Record<string, string> = {}, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function tagItem(tag: string): HTMLElement {
  return el("li", { "data-tag": tag, tabindex: "0" }, el("span", { "data-tag-name": "" }, document.createTextNode(tag)));
}

/** The markup `components/VersionList.astro` (T.4) renders, minus the theme's styling. */
function versionsDom(attributes: Record<string, string>, ssrTags: string[] = ["3.0.0", "2.0.0"]) {
  const list = el("ul", { "data-versions-list": "" }, ...ssrTags.map(tagItem));
  const menu = el("div", { "data-zag-root": "menu" }, list);
  const more = el("button", { type: "button", "data-versions-more": "" }, document.createTextNode("Show all versions"));
  const template = el("template", { "data-versions-tag": "" }) as HTMLTemplateElement;
  template.content.append(tagItem(""));
  const preview = el("p", { "data-versions-preview": "", role: "status", hidden: "" });
  const status = el("p", { "data-versions-status": "", "aria-live": "polite" });
  const root = el(
    "section",
    { "data-ns": "tools", "data-pkg": "widget", "data-wire-base": "", "data-name": "ocx.sh/tools/widget", ...attributes },
    menu,
    more,
    template,
    preview,
    status,
  );
  document.body.replaceChildren(root);
  return { root, menu, list, more, template, preview, status };
}

type Dom = ReturnType<typeof versionsDom>;
type Routes = Record<string, unknown>;

/** 404 for any URL not in `routes`; a `Error` value makes the request reject; `[status]` answers a bare status. */
function wireFetch(routes: Routes) {
  return vi.fn<FetchLike>(async (url) => {
    const answer = routes[url];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (Array.isArray(answer)) return { ok: false, status: answer[0] as number, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answer };
  });
}

let unmount: (() => void) | undefined;
async function start(dom: Dom, options: VersionsOptions = {}, lazy: LazyDouble = createLazyDouble()) {
  unmount = mountVersions(dom.root, lazy, options).destroy;
  const module = await lazy.mounts[0]!.fire();
  return { lazy, module };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const tagsIn = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("[data-tag]")].map((node) => node.dataset.tag);
function over(target: Element) {
  target.dispatchEvent(new Event("pointerover", { bubbles: true }));
}
function select(menu: HTMLElement, value: string) {
  menu.dispatchEvent(new CustomEvent("ocx:menu:select", { bubbles: true, detail: { value } }));
}
function openMenuOn(target: Element, type: "contextmenu" | "pointerdown" = "contextmenu") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  { base: "/", wireBase: "", prefix: "/p/tools/widget", route: "/tools/widget/" },
  { base: "/catalog/", wireBase: "index/acme", prefix: "/catalog/index/acme/p/tools/widget", route: "/catalog/acme/tools/widget/" },
])("base $base, wireBase '$wireBase'", ({ base, wireBase, prefix, route }) => {
  const rootUrl = `${prefix}/_root.json`;
  const indexUrl = (char: string) => `${prefix}/o/sha256/${HEX(char)}.json`;

  function ready(routes: Routes, options: VersionsOptions = {}) {
    const dom = versionsDom({ "data-base": base, "data-wire-base": wireBase });
    const fetch = wireFetch(routes);
    return { ...dom, fetch, begin: () => start(dom, { fetch, copy: async () => {}, ...options }) };
  }

  test("nothing loads before interaction: no fetch, only the lazy mount is registered (C-011)", () => {
    const lazy = createLazyDouble();
    const dom = ready({ [rootUrl]: ROOT });

    unmount = mountVersions(dom.root, lazy, { fetch: dom.fetch }).destroy;
    dom.more.click();
    over(dom.list.firstElementChild!);

    expect(dom.fetch).not.toHaveBeenCalled();
    expect(lazy.mounts).toHaveLength(1);
    expect(lazy.mounts[0]?.root).toBe(dom.root);
    expect(lazy.mounts[0]?.spec.trigger).toBe("interaction");
    expect(dom.list.children).toHaveLength(2);
  });

  describe("show all versions", () => {
    test("loads the mirrored package root from the base-joined wire tree and appends the remaining live tags", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.fetch).toHaveBeenCalledTimes(1);
      expect(dom.fetch).toHaveBeenCalledWith(rootUrl);
      // 3.0.0 and 2.0.0 were SSR'd and stay; 1.0.0 is yanked and is never shown.
      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0", "0.9.0", "bad-digest"]);
      expect(dom.list.querySelectorAll("[data-tag-name]")[2]?.textContent).toBe("0.9.0");
      expect(dom.status.textContent).toBe("Showing all 4 versions.");
    });

    test("falls back to the canonical root URL when the mirror has no _root.json alias", async () => {
      const dom = ready({ [`${prefix}.json`]: ROOT });
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.fetch.mock.calls.map(([url]) => url)).toEqual([rootUrl, `${prefix}.json`]);
    });

    test("a second click while the first load is in flight does not fetch again", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      await dom.begin();

      dom.more.click();
      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.fetch).toHaveBeenCalledTimes(1);
    });

    test("an event aimed at a text node is not a tag interaction", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      await dom.begin();

      dom.list.querySelector("[data-tag-name]")!.firstChild!.dispatchEvent(new Event("pointerover", { bubbles: true }));
      await flush();

      expect(dom.fetch).not.toHaveBeenCalled();
    });

    test("a click elsewhere in the root does nothing", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      await dom.begin();

      dom.status.click();
      document.body.click();
      await flush();

      expect(dom.fetch).not.toHaveBeenCalled();
    });

    test.each([
      ["a network error", new Error("offline")],
      ["an HTTP error", [500]],
      ["a package the mirror does not have", undefined],
    ])("%s: inline error, the SSR tags stay, the button is usable again", async (_name, answer) => {
      const dom = ready({ [rootUrl]: answer, [`${prefix}.json`]: answer });
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.status.textContent).toBe("Could not load all versions."));

      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0"]);
      expect(dom.more.disabled).toBe(false);
      expect(dom.more.hidden).toBe(false);
    });

    test("a failed load is not kept: the retry fetches again and succeeds", async () => {
      const routes: Routes = { [rootUrl]: new Error("offline") };
      const dom = ready(routes);
      await dom.begin();
      dom.more.click();
      await vi.waitFor(() => expect(dom.status.textContent).toBe("Could not load all versions."));

      routes[rootUrl] = ROOT;
      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.status.textContent).toBe("Showing all 4 versions.");
      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0", "0.9.0", "bad-digest"]);
    });

    test("a tag template whose data-tag sits below its first element is filled too", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      dom.template.content.replaceChildren(el("li", {}, el("button", { "data-tag": "" }, el("span", { "data-tag-name": "" }))));
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0", "0.9.0", "bad-digest"]);
      expect(dom.list.lastElementChild?.querySelector("button")?.getAttribute("data-tag")).toBe("bad-digest");
    });

    test("an empty tag template is reported inline and the SSR tags stay", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      dom.template.content.replaceChildren();
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.status.textContent).toBe("Could not load all versions."));

      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0"]);
    });

    test("a tag name from the wire is written as text, never as markup", async () => {
      const hostile = "<img src=x onerror=alert(1)>";
      const dom = ready({ [rootUrl]: { tags: { [hostile]: { content: digest("a"), observed: "2026-01-01T00:00:00Z" } } } });
      await dom.begin();

      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.list.querySelector("img")).toBeNull();
      expect(dom.list.lastElementChild?.querySelector("[data-tag-name]")?.textContent).toBe(hostile);
    });

    test("a session stopped mid-flight writes nothing", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      const lazy = createLazyDouble();
      unmount = mountVersions(dom.root, lazy, { fetch: dom.fetch }).destroy;
      const session = (await lazy.mounts[0]!.spec.load()).start(dom.root);

      dom.more.click();
      session?.stop();
      await flush();
      await flush();

      expect(dom.fetch).toHaveBeenCalledTimes(1);
      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0"]);
      expect(dom.status.textContent).toBe("");
    });
  });

  describe("hover and focus preview", () => {
    test("loads the tag's image index (base-joined CAS URL) and shows its platforms, sorted and deduplicated", async () => {
      const dom = ready({
        [rootUrl]: ROOT,
        [indexUrl("c")]: imageIndex(LINUX, DARWIN, LINUX, undefined, { os: "unknown", architecture: "unknown" }),
      });
      await dom.begin();

      over(dom.list.querySelector("[data-tag='3.0.0'] [data-tag-name]")!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: darwin/arm64, linux/amd64"));

      expect(dom.preview.hidden).toBe(false);
      expect(dom.fetch.mock.calls.map(([url]) => url)).toEqual([rootUrl, indexUrl("c")]);
    });

    test("focus previews like hover", async () => {
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("b")]: imageIndex(LINUX) });
      await dom.begin();

      dom.list.querySelector("[data-tag='2.0.0']")!.dispatchEvent(new Event("focusin", { bubbles: true }));
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("2.0.0: linux/amd64"));
    });

    test("the package root is fetched once for every preview and for show all; an index once per digest", async () => {
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(LINUX), [indexUrl("b")]: imageIndex(DARWIN) });
      await dom.begin();
      const [first, second] = [...dom.list.querySelectorAll("[data-tag]")];

      over(first!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: linux/amd64"));
      over(first!); // already shown: no work
      over(second!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("2.0.0: darwin/arm64"));
      over(first!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: linux/amd64"));
      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      expect(dom.fetch.mock.calls.map(([url]) => url)).toEqual([rootUrl, indexUrl("c"), indexUrl("b")]);
    });

    test("an index with no real platform says so", async () => {
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(undefined) });
      await dom.begin();

      over(dom.list.firstElementChild!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: no platforms"));
    });

    test("an appended tag previews like an SSR'd one", async () => {
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("d")]: imageIndex(DARWIN) });
      await dom.begin();
      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      over(dom.list.querySelector("[data-tag='0.9.0']")!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("0.9.0: darwin/arm64"));
    });

    test.each([
      ["an index the mirror does not have", "2.0.0"],
      ["a digest that is not sha256:<hex>, which never reaches a URL", "bad-digest"],
      ["a tag the package root does not list", "9.9.9"],
    ])("%s: inline error in the preview, no stray request", async (_name, tag) => {
      const dom = ready({ [rootUrl]: ROOT });
      dom.list.append(tagItem("9.9.9"), tagItem("bad-digest"));
      await dom.begin();

      over(dom.list.querySelector(`[data-tag='${tag}']`)!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("Could not load platforms for this version."));

      const urls = dom.fetch.mock.calls.map(([url]) => url);
      expect(urls.filter((url) => url.includes("/o/sha256/"))).toEqual(tag === "2.0.0" ? [indexUrl("b")] : []);
    });

    test("a tag named like an Object.prototype member is not found", async () => {
      const dom = ready({ [rootUrl]: ROOT });
      dom.list.append(tagItem("constructor"));
      await dom.begin();

      over(dom.list.querySelector("[data-tag='constructor']")!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("Could not load platforms for this version."));
    });

    test("a failed root fetch shows the inline error and leaves the tags alone", async () => {
      const dom = ready({ [rootUrl]: new Error("offline") });
      await dom.begin();

      over(dom.list.firstElementChild!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("Could not load platforms for this version."));

      expect(tagsIn(dom.list)).toEqual(["3.0.0", "2.0.0"]);
    });

    test("leaving the list hides the preview and drops an answer still in flight", async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(LINUX) });
      const slow: FetchLike = async (url) => {
        await gate;
        return dom.fetch(url);
      };
      await start(dom, { fetch: slow, copy: async () => {} });

      over(dom.list.firstElementChild!);
      expect(dom.preview.textContent).toBe("3.0.0: loading platforms…");
      dom.list.dispatchEvent(new Event("pointerleave"));
      release?.();
      await flush();
      await flush();

      expect(dom.preview.hidden).toBe(true);
      expect(dom.preview.textContent).toBe("3.0.0: loading platforms…");
    });

    test("focus leaving also hides it, and the same tag previews again afterwards", async () => {
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(LINUX) });
      await dom.begin();
      const first = dom.list.firstElementChild!;

      over(first);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: linux/amd64"));
      dom.list.dispatchEvent(new Event("focusout", { bubbles: true }));
      expect(dom.preview.hidden).toBe(true);
      over(first);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("3.0.0: linux/amd64"));
      expect(dom.preview.hidden).toBe(false);
    });

    test("a slow answer for a superseded tag does not overwrite the newer one", async () => {
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(LINUX), [indexUrl("b")]: imageIndex(DARWIN) });
      const staggered: FetchLike = async (url) => {
        if (url === indexUrl("c")) await firstGate;
        return dom.fetch(url);
      };
      await start(dom, { fetch: staggered, copy: async () => {} });
      const [first, second] = [...dom.list.querySelectorAll("[data-tag]")];

      over(first!);
      over(second!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("2.0.0: darwin/arm64"));
      releaseFirst?.();
      await flush();
      await flush();

      expect(dom.preview.textContent).toBe("2.0.0: darwin/arm64");
    });

    test("a slow failure for a superseded tag does not overwrite the newer answer either", async () => {
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
      const dom = ready({ [rootUrl]: ROOT, [indexUrl("b")]: imageIndex(DARWIN) });
      const staggered: FetchLike = async (url) => {
        if (url === indexUrl("c")) {
          await firstGate;
          throw new Error("offline");
        }
        return dom.fetch(url);
      };
      await start(dom, { fetch: staggered, copy: async () => {} });
      const [first, second] = [...dom.list.querySelectorAll("[data-tag]")];

      over(first!);
      over(second!);
      await vi.waitFor(() => expect(dom.preview.textContent).toBe("2.0.0: darwin/arm64"));
      releaseFirst?.();
      await flush();
      await flush();

      expect(dom.preview.textContent).toBe("2.0.0: darwin/arm64");
    });

    test("a root load that fails after its tag was superseded stays silent", async () => {
      let releaseRoot: (() => void) | undefined;
      const rootGate = new Promise<void>((resolve) => (releaseRoot = resolve));
      const dom = ready({ [rootUrl]: new Error("offline") });
      const slow: FetchLike = async (url) => {
        await rootGate;
        return dom.fetch(url);
      };
      await start(dom, { fetch: slow, copy: async () => {} });

      over(dom.list.firstElementChild!);
      dom.list.dispatchEvent(new Event("pointerleave"));
      releaseRoot?.();
      await flush();
      await flush();

      expect(dom.preview.hidden).toBe(true);
      expect(dom.preview.textContent).toBe("3.0.0: loading platforms…");
    });

    test("a session stopped before the root arrives previews nothing", async () => {
      let releaseRoot: (() => void) | undefined;
      const rootGate = new Promise<void>((resolve) => (releaseRoot = resolve));
      const dom = ready({ [rootUrl]: ROOT });
      const slow: FetchLike = async (url) => {
        await rootGate;
        return dom.fetch(url);
      };
      const lazy = createLazyDouble();
      unmount = mountVersions(dom.root, lazy, { fetch: slow, copy: async () => {} }).destroy;
      const session = (await lazy.mounts[0]!.spec.load()).start(dom.root);

      over(dom.list.firstElementChild!);
      session?.stop();
      releaseRoot?.();
      await flush();
      await flush();

      expect(dom.preview.textContent).toBe("Could not load platforms for this version.");
      expect(dom.fetch.mock.calls.map(([url]) => url)).toEqual([rootUrl]);
    });
  });

  describe("copy menu", () => {
    function copying(routes: Routes = { [rootUrl]: ROOT }) {
      const copied: string[] = [];
      const dom = ready(routes, {
        copy: async (text) => {
          copied.push(text);
        },
      });
      return { ...dom, copied };
    }

    test.each([
      ["Copy identifier", "ocx.sh/tools/widget:2.0.0"],
      ["Copy tag", "2.0.0"],
      ["Add to project", "ocx add ocx.sh/tools/widget:2.0.0"],
      ["Install package", "ocx package install ocx.sh/tools/widget:2.0.0"],
    ])("%s on a right-clicked tag copies %s", async (label, command) => {
      const dom = copying();
      await dom.begin();

      openMenuOn(dom.list.querySelector("[data-tag='2.0.0'] [data-tag-name]")!);
      select(dom.menu, label);

      await vi.waitFor(() => expect(dom.copied).toEqual([command]));
      expect(dom.status.textContent).toBe(`Copied: ${label}.`);
    });

    test("Copy link is the page's own route, base and qualified index segment included (copy_link_route)", async () => {
      window.history.replaceState({}, "", route);
      const dom = copying();
      await dom.begin();

      openMenuOn(dom.list.firstElementChild!);
      select(dom.menu, "Copy link");

      await vi.waitFor(() => expect(dom.copied).toEqual([`${window.location.origin}${route}`]));
    });

    test("a long press (pointerdown) picks the tag the menu opens on", async () => {
      const dom = copying();
      await dom.begin();

      openMenuOn(dom.list.querySelector("[data-tag='2.0.0']")!, "pointerdown");
      select(dom.menu, "Copy tag");

      await vi.waitFor(() => expect(dom.copied).toEqual(["2.0.0"]));
    });

    test("tags appended by show all offer the same menu", async () => {
      const dom = copying();
      await dom.begin();
      dom.more.click();
      await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

      openMenuOn(dom.list.querySelector("[data-tag='0.9.0']")!);
      select(dom.menu, "Copy identifier");

      await vi.waitFor(() => expect(dom.copied).toEqual(["ocx.sh/tools/widget:0.9.0"]));
    });

    test("a right click away from any tag never reaches the action menu and leaves no stale target", async () => {
      const dom = copying();
      await dom.begin();
      const reached: Event[] = [];
      dom.menu.addEventListener("contextmenu", (event) => reached.push(event));

      openMenuOn(dom.list.firstElementChild!);
      expect(reached).toHaveLength(1);
      const event = openMenuOn(dom.list);

      expect(reached).toHaveLength(1);
      expect(event.defaultPrevented).toBe(false);
      select(dom.menu, "Copy tag");
      await flush();
      expect(dom.copied).toEqual([]);
    });

    test("a pointerdown away from a tag clears the target without swallowing the event", async () => {
      const dom = copying();
      await dom.begin();
      const reached: Event[] = [];
      dom.menu.addEventListener("pointerdown", (event) => reached.push(event));

      openMenuOn(dom.list.firstElementChild!, "pointerdown");
      openMenuOn(dom.list, "pointerdown");
      select(dom.menu, "Copy tag");
      await flush();

      expect(reached).toHaveLength(2);
      expect(dom.copied).toEqual([]);
    });

    test("a selection that names no action is ignored", async () => {
      const dom = copying();
      await dom.begin();

      openMenuOn(dom.list.firstElementChild!);
      select(dom.menu, "Reformat disk");
      await flush();

      expect(dom.copied).toEqual([]);
      expect(dom.status.textContent).toBe("");
    });

    test("a clipboard failure is reported inline", async () => {
      const dom = ready({ [rootUrl]: ROOT }, {
        copy: async () => {
          throw new Error("denied");
        },
      });
      await dom.begin();

      openMenuOn(dom.list.firstElementChild!);
      select(dom.menu, "Copy tag");

      await vi.waitFor(() => expect(dom.status.textContent).toBe("Could not copy to the clipboard."));
    });

    test("without a copy option the browser clipboard is used", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const dom = ready({ [rootUrl]: ROOT });
      await start(dom, { fetch: dom.fetch });

      openMenuOn(dom.list.firstElementChild!);
      select(dom.menu, "Copy tag");

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("3.0.0"));
    });
  });

  test("the global fetch is used when none is passed, read at call time", async () => {
    const dom = versionsDom({ "data-base": base, "data-wire-base": wireBase });
    const fetch = wireFetch({ [rootUrl]: ROOT });
    vi.stubGlobal("fetch", fetch);
    await start(dom, { copy: async () => {} });

    dom.more.click();
    await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

    expect(fetch).toHaveBeenCalledWith(rootUrl);
  });

  test("destroy destroys the lazy mount", () => {
    const lazy = createLazyDouble();
    const dom = ready({ [rootUrl]: ROOT });

    mountVersions(dom.root, lazy, { fetch: dom.fetch }).destroy();

    expect(lazy.mounts[0]?.destroyed).toBe(true);
  });

  test("stopping the session removes every listener", async () => {
    const dom = ready({ [rootUrl]: ROOT, [indexUrl("c")]: imageIndex(LINUX) });
    const lazy: LazyMount = createLazyDouble();
    unmount = mountVersions(dom.root, lazy, { fetch: dom.fetch, copy: async () => {} }).destroy;
    const live = lazy as LazyDouble;
    const session = (await live.mounts[0]!.spec.load()).start(dom.root);
    session?.stop();

    dom.more.click();
    over(dom.list.firstElementChild!);
    openMenuOn(dom.list.firstElementChild!);
    openMenuOn(dom.list.firstElementChild!, "pointerdown");
    dom.list.dispatchEvent(new Event("focusin", { bubbles: true }));
    dom.list.dispatchEvent(new Event("pointerleave"));
    dom.list.dispatchEvent(new Event("focusout", { bubbles: true }));
    select(dom.menu, "Copy tag");
    await flush();

    expect(dom.fetch).not.toHaveBeenCalled();
    expect(dom.more.disabled).toBe(false);
    expect(dom.status.textContent).toBe("");
  });
});

describe("configuration", () => {
  test("options.base wins over data-base", async () => {
    const dom = versionsDom({ "data-base": "/" });
    const fetch = wireFetch({ "/catalog/p/tools/widget/_root.json": ROOT });
    await start(dom, { fetch, base: "/catalog/", copy: async () => {} });

    dom.more.click();
    await vi.waitFor(() => expect(dom.more.hidden).toBe(true));

    expect(fetch).toHaveBeenCalledWith("/catalog/p/tools/widget/_root.json");
  });

  test.each([
    ["data-base", "data-base", /no base/],
    ["data-ns", "data-ns", /no ns/],
    ["data-pkg", "data-pkg", /no pkg/],
    ["data-wire-base", "data-wire-base", /no wire-base/],
    ["data-name", "data-name", /no name/],
  ])("a root without %s fails loudly at start", async (_label, attribute, message) => {
    const dom = versionsDom({ "data-base": "/" });
    dom.root.removeAttribute(attribute!);
    const lazy = createLazyDouble();
    unmount = mountVersions(dom.root, lazy, { fetch: wireFetch({}) }).destroy;

    await expect(lazy.mounts[0]!.fire()).rejects.toThrow(message);
  });

  test.each([
    ["[data-zag-root=\"menu\"]", '[data-zag-root="menu"]'],
    ["[data-versions-list]", "[data-versions-list]"],
    ["template[data-versions-tag]", "template[data-versions-tag]"],
    ["[data-versions-more]", "[data-versions-more]"],
    ["[data-versions-preview]", "[data-versions-preview]"],
    ["[data-versions-status]", "[data-versions-status]"],
  ])("a root without %s fails loudly at start", async (_label, selector) => {
    const dom = versionsDom({ "data-base": "/" });
    dom.root.querySelector(selector!)!.remove();
    const lazy = createLazyDouble();
    unmount = mountVersions(dom.root, lazy, { fetch: wireFetch({}) }).destroy;

    await expect(lazy.mounts[0]!.fire()).rejects.toThrow(/versions: missing/);
  });
});
