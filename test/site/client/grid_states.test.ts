// @vitest-environment happy-dom
//
// The grid island's layout, windowing and loading-state parity rows (ledger C13
// card / table, C14 windowing, C15 loading / empty / error, and the restored
// view and sort memory).
import { describe, expect, test, vi } from "vitest";
import { startSession } from "../../../src/site/client/grid_session.js";
import type { GridState } from "../../../src/site/client/grid.js";
import { SKELETON_COUNT } from "../../../src/site/lib/gridContract.js";
import { WINDOW_SIZE } from "../../../src/site/lib/windowing.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { gridDom } from "./grid_dom.js";
import {
  FakeObserver,
  answering,
  catalog,
  click,
  index,
  keys,
  pickSort,
  pickView,
  pkg,
  platformChip,
  text,
  type,
  useGridRun,
} from "./grid_harness.js";

const run = useGridRun();

/** A fetch that answers once `release` is called. */
function gated(body: ReturnType<typeof catalog>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetch = vi.fn<FetchLike>(async () => {
    await gate;
    return { ok: true, status: 200, json: async () => body };
  });
  return { fetch, release: () => release() };
}

describe("C13 card and table layout", () => {
  const data = catalog([
    pkg("a/acme/versioned", { latestVersion: "2.0.0", platforms: ["linux/amd64", "darwin/arm64"] }),
    pkg("a/acme/unversioned", { latestVersion: null, platforms: ["linux/amd64"] }),
    pkg("a/acme/agnostic", { platforms: ["any/any"] }),
  ]);

  test("D-039 a row with no latest version keeps its version cell and prints an em dash, so the columns after it keep their tracks", async () => {
    const dom = gridDom();
    await run.open(dom, data);
    pickView("table");
    const version = (name: string) => dom.table.querySelector<HTMLElement>(`[data-key="${name}"] [data-field="version"]`)!;
    expect(version("a/acme/versioned").textContent).toBe("2.0.0");
    expect(version("a/acme/unversioned").textContent).toBe("—");
    expect(version("a/acme/unversioned").hidden).toBe(false);
    // A card still has no business printing a placeholder in its title row.
    pickView("cards");
    expect(dom.cards.querySelector<HTMLElement>('[data-key="a/acme/unversioned"] [data-field="version"]')?.hidden).toBe(true);
  });

  test("D-040 a platform-agnostic row says 'any platform' as visible text across the slots", async () => {
    const dom = gridDom();
    await run.open(dom, data);
    pickView("table");
    const cell = dom.table.querySelector('[data-key="a/acme/agnostic"] [data-field="platforms"]')!;
    expect([...cell.children].map((el) => el.textContent)).toEqual(["any platform"]);
    expect(cell.firstElementChild?.className).toBe("row-any");
    expect(cell.querySelector("[data-os]")).toBeNull();
  });

  test("D-049 the table's platform columns come from the whole population, not the visible rows, and survive filtering", async () => {
    const dom = gridDom();
    await run.open(
      dom,
      catalog([
        pkg("a/acme/one", { platforms: ["linux/amd64"] }),
        pkg("a/acme/two", { platforms: ["windows/amd64"] }),
        pkg("a/acme/three", { platforms: ["darwin/arm64"] }),
      ]),
    );
    pickView("table");
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("3");
    click(platformChip("linux"));
    expect(keys(dom.table)).toEqual(["a/acme/one"]);
    expect(dom.table.style.getPropertyValue("--os-cols")).toBe("3");
    const slots = dom.table.querySelectorAll('[data-key="a/acme/one"] [data-field="platforms"] > *');
    expect(slots).toHaveLength(3);
  });

  test("D-043 a qualified name past the card's character budget keeps its two ends and the whole name in the title", async () => {
    const dom = gridDom();
    const name = "ocx.sh/very-long-namespace-name/some-quite-long-package-name";
    await run.open(dom, catalog([pkg(name)]));
    const el = dom.cards.querySelector(`[data-key="${name}"] [data-field="name"]`)!;
    expect(el.textContent).toBe("ocx.sh/…/some-quite-long-package-name");
    expect(el.getAttribute("title")).toBe(name);
  });
});

describe("C14 windowing", () => {
  const long = Array.from({ length: 130 }, (_, i) => pkg(`a/x/p${String(i).padStart(3, "0")}`));

  test("D-010 a reader who only scrolls starts the island: the server window is all they would ever get otherwise", async () => {
    const dom = gridDom({ ssrCards: ["a/x/p000"] });
    const fetch = run.mount(dom, catalog(long));
    expect(fetch).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(keys(dom.cards)).toHaveLength(48));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(dom.sentinel.hidden).toBe(false);
  });

  test("D-044 the next slice is built 150% of a viewport ahead of the reader, whatever the viewport", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(long));
    expect(FakeObserver.instances[0]?.options).toEqual({ rootMargin: "150% 0px" });
  });

  test("D-045 each growth re-observes the sentinel in order, and a stale report after the last slice changes nothing", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(long));
    const observer = FakeObserver.instances[0]!;
    expect(observer.calls).toEqual(["unobserve", "observe"]);

    observer.fire();
    expect(keys(dom.cards)).toHaveLength(96);
    expect(observer.calls).toEqual(["unobserve", "observe", "unobserve", "observe"]);
    observer.fire();
    expect(keys(dom.cards)).toHaveLength(130);
    // Exhausted: the sentinel is gone and a stale intersecting record changes nothing visible (the guard only saves the render).
    expect(dom.sentinel.hidden).toBe(true);
    const before = observer.calls.length;
    const items = [...dom.cards.children];
    observer.fire();
    observer.fire();
    expect(observer.calls).toHaveLength(before);
    expect([...dom.cards.children]).toEqual(items);
  });

  test("D-045 a stale report after the last slice leaves the window limit where it stopped, so a later render cannot start past the list", async () => {
    const dom = gridDom();
    const state: GridState = {
      q: "",
      urlIndex: null,
      sort: "name",
      inverted: false,
      view: "cards",
      platforms: [],
      keywords: [],
      deprecated: false,
      yanked: false,
      moreQuery: "",
      moreOpen: false,
      limit: WINDOW_SIZE,
    };
    const session = startSession(dom.root, state, "/", { fetch: answering(catalog(long)) }, { syncControls: () => {} });
    await vi.waitFor(() => expect(session.loaded).toBe(true));
    const observer = FakeObserver.instances[0]!;
    observer.fire();
    observer.fire();
    expect(keys(dom.cards)).toHaveLength(long.length);
    const stopped = state.limit;
    observer.fire();
    observer.fire();
    expect(state.limit).toBe(stopped);
    session.stop();
  });

  test("D-045 the re-observe is what keeps a long catalog growing: without it the sentinel stays unobserved after a growth", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(long));
    const observer = FakeObserver.instances[0]!;
    observer.fire();
    // unobserve then observe: the last call on the sentinel is an observe, never a bare unobserve.
    expect(observer.calls.at(-1)).toBe("observe");
    expect(observer.observed).toEqual([dom.sentinel]);
  });
});

describe("C15 loading, empty and error", () => {
  const data = catalog([pkg("a/x/one"), pkg("a/x/two")]);

  test("D-173 a bare first interaction keeps the server cards and no skeleton: a click on a card during the fetch is a real link", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { fetch, release } = gated(data);
    run.mount(dom, fetch);
    expect(dom.skeleton.hidden).toBe(true);

    void run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(dom.skeleton.hidden).toBe(true);
    expect(dom.cards.hidden).toBe(false);
    const link = dom.cards.querySelector<HTMLAnchorElement>("a[data-card]")!;
    expect(link.isConnected).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);

    release();
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]));
    expect(dom.skeleton.hidden).toBe(true);
  });

  test("D-173 D-025 a query typed before the catalog is here shows the skeleton in place of the wrong cards until it resolves", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { fetch, release } = gated(data);
    run.mount(dom, fetch);
    void run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    dom.search.value = "two";
    dom.search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dom.skeleton.hidden).toBe(false);
    expect(dom.skeleton.childElementCount).toBe(SKELETON_COUNT);
    expect(dom.cards.hidden).toBe(true);

    release();
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(keys(dom.cards)).toEqual(["a/x/two"]);
  });

  test("D-173 a cold URL with state shows the skeleton, not the server cards, until the results are in", async () => {
    history.replaceState(null, "", "/?sort=updated");
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { fetch, release } = gated(data);
    run.mount(dom, fetch);
    expect(dom.skeleton.hidden).toBe(false);
    expect(dom.cards.hidden).toBe(true);
    release();
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(dom.cards.hidden).toBe(false);
  });

  test("D-173 a render asked of the session before the catalog is here changes nothing: the server cards stay", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const state: GridState = {
      q: "",
      urlIndex: null,
      sort: "name",
      inverted: false,
      view: "cards",
      platforms: [],
      keywords: [],
      deprecated: false,
      yanked: false,
      moreQuery: "",
      moreOpen: false,
      limit: WINDOW_SIZE,
    };
    const { fetch, release } = gated(data);
    const session = startSession(dom.root, state, "/", { fetch }, { syncControls: () => {} });
    session.render();
    expect(session.loaded).toBe(false);
    expect(keys(dom.cards)).toEqual(["a/x/one"]);
    expect(dom.skeleton.hidden).toBe(true);
    release();
    await vi.waitFor(() => expect(session.loaded).toBe(true));
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
    session.stop();
  });

  test("D-173 the skeleton keeps the list's height while it stands in", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    Object.defineProperty(dom.cards, "offsetHeight", { configurable: true, value: 240 });
    const first = gated(data);
    run.mount(dom, first.fetch);
    void run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(first.fetch).toHaveBeenCalledTimes(1));
    dom.search.value = "x";
    dom.search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dom.skeleton.hidden).toBe(false);
    expect(dom.root.style.getPropertyValue("--reserve")).toBe("240px");
  });

  test("D-173 a keyboard reader on a card is not dropped to the page: the cards stay until the results replace them", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const card = dom.cards.querySelector<HTMLElement>("a[data-card]")!;
    card.focus();
    const { fetch, release } = gated(data);
    run.mount(dom, fetch);
    void run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    dom.root.querySelector<HTMLElement>("[data-grid-platform]")!.click();
    expect(dom.skeleton.hidden).toBe(true);
    expect(dom.cards.hidden).toBe(false);
    expect(document.activeElement).toBe(card);
    release();
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]));
  });

  test("D-025 Retry shows the skeleton again until the new answer lands", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockImplementation(async () => {
        await gate;
        return { ok: true, status: 200, json: async () => data };
      });
    run.mount(dom, fetch);
    await run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));

    click(dom.failure.querySelector("[data-grid-retry]"));
    expect(dom.failure.hidden).toBe(true);
    expect(dom.skeleton.hidden).toBe(false);
    release();
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]));
    expect(dom.skeleton.hidden).toBe(true);
  });

  test("D-026 the first results release the reserved height, so a cold ?q= with few matches never sits in a viewport-tall box", async () => {
    history.replaceState(null, "", "/?q=one");
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    Object.defineProperty(dom.cards, "offsetHeight", { configurable: true, value: 300 });
    run.mount(dom, data);
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(dom.root.style.getPropertyValue("--reserve")).toBe("");
  });

  test("D-027 a cold ?q and ?index show in the controls before any result, and the unfiltered server cards never show", async () => {
    history.replaceState(null, "", "/?q=one&index=b");
    const dom = gridDom({ scope: "toggle", ssrScope: "a", ssrCards: ["a/x/one"] });
    const { fetch, release } = gated(catalog([pkg("a/x/one"), pkg("b/x/one")], [index("a", { root: true, default: true }), index("b")]));
    run.mount(dom, fetch);

    expect(dom.search.value).toBe("one");
    expect(document.querySelector('[data-grid-scope] [aria-checked="true"]')?.id).toBe("toggle-group:scope:b");
    expect(dom.cards.hidden).toBe(true);
    expect(dom.skeleton.hidden).toBe(false);
    release();
    await vi.waitFor(() => expect(keys(dom.cards)).toEqual(["b/x/one"]));
  });

  test("C-017 the head script's marks come off the root when the island takes over: the table mark at the skeleton, the rail wait with the results", async () => {
    history.replaceState(null, "", "/?q=one");
    document.documentElement.dataset.catalogView = "table";
    document.documentElement.dataset.catalogWait = "";
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const { fetch, release } = gated(data);
    run.mount(dom, fetch);
    expect(document.documentElement.dataset.catalogView).toBeUndefined();
    expect(document.documentElement.dataset.catalogWait).toBe("");
    release();
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(document.documentElement.dataset.catalogWait).toBeUndefined();
  });

  test("C-017 a failed load also ends the rail wait: the toolbar's rail is not left undrawn", async () => {
    history.replaceState(null, "", "/?q=one");
    document.documentElement.dataset.catalogWait = "";
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    run.mount(dom, answering(data, 500));
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(document.documentElement.dataset.catalogWait).toBeUndefined();
  });

  test("D-029 a query that matches nothing offers 'clear search' alone; filters alone offer 'clear filters' alone", async () => {
    const dom = gridDom();
    await run.open(dom, data);
    const clearSearch = dom.noMatch.querySelector<HTMLElement>("[data-grid-clear-search]")!;
    const clearFilters = dom.noMatch.querySelector<HTMLElement>("[data-grid-clear]")!;
    expect([clearSearch.hidden, clearFilters.hidden]).toEqual([true, true]);

    click(platformChip("windows"));
    expect([clearSearch.hidden, clearFilters.hidden]).toEqual([true, false]);
    type(dom.search, "zzzz");
    expect([clearSearch.hidden, clearFilters.hidden]).toEqual([false, true]);

    // "Clear search" drops the query and keeps the chip.
    click(clearSearch);
    expect(dom.search.value).toBe("");
    expect(platformChip("windows").getAttribute("aria-pressed")).toBe("true");
    expect(dom.noMatch.hidden).toBe(false);
    click(clearFilters);
    expect(dom.noMatch.hidden).toBe(true);
    expect(keys(dom.cards)).toEqual(["a/x/one", "a/x/two"]);
  });

  test("D-031 the error panel gives the reason and tells the reader to reload; an Error with no message gets a plain sentence", async () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    run.mount(dom, vi.fn<FetchLike>().mockRejectedValue(new Error("")));
    await run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(text(dom.failure.querySelector('[data-field="message"]'))).toBe("Something went wrong fetching package data. Try reloading.");
  });

  test("D-032 D-033 a failed fetch takes the toolbar away (its controls would filter nothing) and Retry brings it back", async () => {
    const dom = gridDom({ scope: "toggle", ssrCards: ["a/x/one"] });
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => data });
    run.mount(dom, fetch);
    await run.lazy.mounts[0]?.fire();
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect(dom.toolbar.hidden).toBe(true);
    // The server cards are still links to read.
    expect(dom.cards.hidden).toBe(false);

    click(dom.failure.querySelector("[data-grid-retry]"));
    await vi.waitFor(() => expect(dom.toolbar.hidden).toBe(false));
    expect(dom.failure.hidden).toBe(true);
  });

  test("D-032 a failure while the table view was asked for still shows the server cards, never an empty table", async () => {
    history.replaceState(null, "", "/?view=table");
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    run.mount(dom, answering(data, 500));
    await vi.waitFor(() => expect(dom.failure.hidden).toBe(false));
    expect([dom.cards.hidden, dom.table.hidden]).toEqual([false, true]);
    expect(keys(dom.cards)).toEqual(["a/x/one"]);
  });

  test.each(["pointerover", "focusin"])("D-153 a lone %s on a card link hints its detail page", (eventName) => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    run.mount(dom, data);
    const link = dom.cards.querySelector<HTMLAnchorElement>("a[data-card]")!;
    link.dispatchEvent(new Event(eventName, { bubbles: true }));
    expect([...document.head.querySelectorAll('link[rel="prefetch"]')].map((hint) => hint.getAttribute("href"))).toEqual([
      link.getAttribute("href"),
    ]);
  });

  test("D-153 the detail page is prefetched on the first hover or focus of its link, once, before anything has loaded", () => {
    const dom = gridDom({ ssrCards: ["a/x/one"] });
    const fetch = run.mount(dom, data);
    const link = dom.cards.querySelector<HTMLAnchorElement>("a[data-card]")!;
    link.dispatchEvent(new Event("pointerover", { bubbles: true }));
    link.dispatchEvent(new Event("focusin", { bubbles: true }));
    link.dispatchEvent(new Event("pointerover", { bubbles: true }));
    const hints = [...document.head.querySelectorAll('link[rel="prefetch"]')];
    expect(hints.map((hint) => hint.getAttribute("href"))).toEqual([link.getAttribute("href")]);

    // Something that is not a card link, and a bare text target, hint nothing.
    dom.count.dispatchEvent(new Event("pointerover", { bubbles: true }));
    const bare = document.createTextNode("x");
    dom.root.append(bare);
    bare.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(document.head.querySelectorAll('link[rel="prefetch"]')).toHaveLength(1);
    // The hover is the eager half's own: no catalog.json was asked for.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("D-170 the view and sort key are remembered", () => {
  const packages = [
    pkg("a/x/a", { updated: "2026-01-01T00:00:00Z" }),
    pkg("a/x/b", { updated: "2026-03-01T00:00:00Z" }),
  ];

  test("D-170 picking a view and a sort key writes them under the 0.5.x keys", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    pickView("table");
    pickSort("updated");
    expect(localStorage.getItem("ocx-catalog-view")).toBe("table");
    expect(localStorage.getItem("ocx-catalog-sort")).toBe("updated");
    pickView("cards");
    pickSort("name");
    expect([localStorage.getItem("ocx-catalog-view"), localStorage.getItem("ocx-catalog-sort")]).toEqual(["cards", "name"]);
  });

  test("D-170 a remembered table view and sort boot the grid at load, with the controls showing them and the URL following", async () => {
    localStorage.setItem("ocx-catalog-view", "table");
    localStorage.setItem("ocx-catalog-sort", "updated");
    const dom = gridDom({ ssrCards: ["a/x/a"] });
    run.mount(dom, catalog(packages));
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(keys(dom.table)).toEqual(["a/x/b", "a/x/a"]);
    expect(text(document.querySelector("[data-grid-sort] .ocx-ui-select__value"))).toBe("updated");
    expect(location.search).toBe("?sort=updated&view=table");
  });

  test("D-170 the URL wins over what is remembered, and what it names becomes the remembered value", async () => {
    localStorage.setItem("ocx-catalog-view", "table");
    localStorage.setItem("ocx-catalog-sort", "updated");
    history.replaceState(null, "", "/?view=cards&sort=name");
    const dom = gridDom({ ssrCards: ["a/x/a"] });
    run.mount(dom, catalog(packages));
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(keys(dom.cards)).toEqual(["a/x/a", "a/x/b"]);
    expect(dom.table.hidden).toBe(true);
    expect(localStorage.getItem("ocx-catalog-view")).toBe("cards");
    expect(localStorage.getItem("ocx-catalog-sort")).toBe("name");
  });

  test("D-170 an unknown remembered value is ignored, and the default view does not boot a bare URL", () => {
    localStorage.setItem("ocx-catalog-view", "gallery");
    localStorage.setItem("ocx-catalog-sort", "name");
    const dom = gridDom();
    const fetch = run.mount(dom, catalog(packages));
    expect(fetch).not.toHaveBeenCalled();
    expect(dom.skeleton.hidden).toBe(true);
  });

  test("D-170 blocked storage changes nothing but the memory", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    expect(() => pickView("table")).not.toThrow();
    expect(keys(dom.table)).toEqual(["a/x/a", "a/x/b"]);
  });
});
