// @vitest-environment happy-dom
//
// The grid island's toolbar parity rows (ledger C11 chip rail / scope, C12
// search / sort / count). The island plays the theme's counterpart through the
// documented `ocx:*:change` events, so each row here is one the old Vue
// toolbar had and the 0.6 port lost.
import { describe, expect, test, vi } from "vitest";
import { onSelectSet, onToggleGroupSet } from "../../../node_modules/@ocx-sh/theme/src/components/ui/value-set.mjs";
import { gridDom } from "./grid_dom.js";
import {
  catalog,
  chipNames,
  chipsOf,
  click,
  emit,
  index,
  keys,
  pickScope,
  pickSort,
  platformChip,
  pkg,
  pressed,
  statusChip,
  text,
  type,
  useGridRun,
} from "./grid_harness.js";

const run = useGridRun();

const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("C11 chip rail, scope and popover", () => {
  const families = [
    pkg("a/x/a", { keywords: ["cli", "cli-only"] }),
    pkg("a/x/b", { keywords: ["cli"] }),
    pkg("a/x/c", { keywords: ["db"] }),
    pkg("a/x/d", { keywords: ["db", "db-only"] }),
  ];

  test("D-013 a popover filter that hits nothing says so, and the line goes with the filter and with the popover", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(families));
    emit(dom.more, "ocx:popover:change", { open: true });
    expect(dom.moreEmpty.hidden).toBe(true);

    type(dom.moreFilter, "zzzz");
    expect(chipsOf(dom.moreList)).toHaveLength(0);
    expect(dom.moreEmpty.hidden).toBe(false);
    expect(dom.moreEmpty.textContent).toBe("no keyword matches");

    type(dom.moreFilter, "db");
    expect(dom.moreEmpty.hidden).toBe(true);
    type(dom.moreFilter, "zzzz");
    emit(dom.more, "ocx:popover:change", { open: false });
    expect(dom.moreEmpty.hidden).toBe(true);
  });

  test("D-014 Escape in the popover filter closes the popover in one press: the text is gone before the theme sees the key", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(families));
    emit(dom.more, "ocx:popover:change", { open: true });
    type(dom.moreFilter, "cli");

    // The theme's search field clears and stops an Escape that finds text; the popover machine only closes on an
    // Escape nobody has handled. Both are played here in the order the page registers them (theme first).
    const theme = (event: KeyboardEvent) => {
      const input = event.target as HTMLInputElement;
      if (event.key !== "Escape" || !input.value) return;
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
    };
    const closed = vi.fn();
    const popover = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closed();
    };
    document.addEventListener("keydown", theme, true);
    document.addEventListener("keydown", popover, true);
    try {
      press(dom.moreFilter, "Escape");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(dom.moreFilter.value).toBe("");
      // The list follows the cleared filter at once.
      expect(chipsOf(dom.moreList).length).toBeGreaterThan(1);

      // Another key and another field leave the filter's text alone.
      type(dom.moreFilter, "db");
      press(dom.moreFilter, "a");
      press(dom.search, "Escape");
      expect(dom.moreFilter.value).toBe("db");
      expect(closed).toHaveBeenCalledTimes(2);

      // An already empty filter has nothing to clear: the key goes through, as it did.
      dom.moreFilter.value = "";
      press(dom.moreFilter, "Escape");
      expect(closed).toHaveBeenCalledTimes(3);
    } finally {
      document.removeEventListener("keydown", theme, true);
      document.removeEventListener("keydown", popover, true);
    }
  });

  test("an active rail chip is marked pressed, which the toolbar styles with its close glyph", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(families));
    const chip = chipsOf(dom.rail).find((entry) => entry.dataset.keyword === "cli")!;
    expect(pressed(chip)).toBe(false);
    click(chip);
    expect(pressed(chipsOf(dom.rail).find((entry) => entry.dataset.keyword === "cli")!)).toBe(true);
  });

  test("a keyword chip inside a card's link never navigates; only a real (trusted) click toggles its keyword", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(families));
    const card = dom.cards.querySelector("a[data-card]")!;
    card.insertAdjacentHTML("beforeend", `<button type="button" data-grid-chip data-keyword="cli" aria-pressed="false">cli</button>`);
    const inCard = card.querySelector("[data-grid-chip]")!;
    const railCli = () => pressed(chipsOf(dom.rail).find((entry) => entry.dataset.keyword === "cli")!);

    const replayed = new MouseEvent("click", { bubbles: true, cancelable: true });
    inCard.dispatchEvent(replayed);
    expect(replayed.defaultPrevented).toBe(true);
    expect(railCli()).toBe(false);

    const real = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(real, "isTrusted", { value: true });
    inCard.dispatchEvent(real);
    expect(real.defaultPrevented).toBe(true);
    expect(railCli()).toBe(true);
  });

  test("D-017 the rail animates through the real grid: not on the first render, then each click that reorders it", async () => {
    const animate = vi.fn(() => ({ addEventListener: () => undefined }));
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    try {
      const dom = gridDom();
      dom.rail.style.setProperty("--ocx-duration-moderate", "0.2s");
      await run.open(dom, catalog(families));
      expect(animate).not.toHaveBeenCalled();

      // Picking "cli" narrows the survivors: the rail is rescored, so chips enter and leave.
      click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "cli")!);
      expect(animate).toHaveBeenCalled();
      expect(chipsOf(dom.rail).some((chip) => chip.hasAttribute("data-leaving"))).toBe(true);
    } finally {
      // @ts-expect-error the stub was installed as an own property of the prototype
      delete HTMLElement.prototype.animate;
    }
  });

  describe("D-034 the scope row: tabs, then a +N popover", () => {
    const data = catalog(
      [pkg("a/x/one"), pkg("b/x/two"), pkg("c/x/three"), pkg("d/x/four")],
      [index("a", { root: true }), index("b"), index("c", { default: true }), index("d")],
    );

    test("D-034 an index behind the popover shows as pressed there and leaves every tab off; picking another updates both", async () => {
      const dom = gridDom({ scope: "toggle", scopeValues: [":all", "a", "b"], scopeOverflow: ["c", "d"], ssrScope: "c" });
      await run.open(dom, data);
      expect(keys(dom.cards)).toEqual(["c/x/three"]);
      const options = [...document.querySelectorAll<HTMLElement>("[data-grid-scope-option]")];
      expect(options.map(pressed)).toEqual([true, false]);
      expect([...document.querySelectorAll("[data-grid-scope] [data-part='item']")].map((item) => item.getAttribute("aria-checked"))).toEqual([
        "false",
        "false",
        "false",
      ]);

      click(options[1]!);
      expect(keys(dom.cards)).toEqual(["d/x/four"]);
      expect(location.search).toBe("?index=d");
      expect(options.map(pressed)).toEqual([false, true]);
    });

    test("D-034 a tab chosen again after a +N pick is read from the click, since the machine raises no change for its own value", async () => {
      const dom = gridDom({ scope: "toggle", scopeValues: [":all", "a", "b"], scopeOverflow: ["c", "d"], ssrScope: "a" });
      await run.open(dom, data);
      // The machine holds "a"; the reader picks "c" from the popover, then clicks tab "a" again: no ocx:toggle-group:change.
      click(document.querySelector('[data-grid-scope-option="c"]'));
      expect(keys(dom.cards)).toEqual(["c/x/three"]);
      click(document.getElementById("toggle-group:scope:a"));
      expect(keys(dom.cards)).toEqual(["a/x/one"]);
      expect(document.getElementById("toggle-group:scope:a")?.getAttribute("aria-checked")).toBe("true");
      click(document.getElementById("toggle-group:scope::all"));
      expect(location.search).toBe("?index=");
      expect(keys(dom.cards)).toEqual(["a/x/one", "b/x/two", "c/x/three", "d/x/four"]);
    });

    test("D-034 a scope tab works the same without any popover", async () => {
      const dom = gridDom({ scope: "toggle", scopeValues: [":all", "a", "b", "c", "d"], ssrScope: "c" });
      await run.open(dom, data);
      pickScope("d");
      expect(keys(dom.cards)).toEqual(["d/x/four"]);
      expect(document.querySelector("[data-grid-scope-option]")).toBeNull();
    });
  });

  test("D-047 the grid sets sort, view and scope by the theme's setter events: the right value, no change event back, no attribute written by the grid", async () => {
    // Without the theme's listeners the controls cannot change, so any change to them is the grid writing them itself.
    document.removeEventListener("ocx:toggle-group:set", onToggleGroupSet);
    document.removeEventListener("ocx:select:set", onSelectSet);
    history.replaceState(null, "", "/?sort=updated&view=table&index=b");
    const dom = gridDom({ scope: "toggle", ssrScope: "a" });
    const controls = ["[data-grid-sort]", "[data-grid-view]", "[data-grid-scope]"].map((selector) => document.querySelector<HTMLElement>(selector)!);
    const before = controls.map((control) => control.outerHTML);
    const sets: unknown[] = [];
    const changes: string[] = [];
    for (const type of ["ocx:select:set", "ocx:toggle-group:set"]) {
      document.addEventListener(type, (event) =>
        sets.push([type, (event.target as HTMLElement).dataset.zagRoot, (event as CustomEvent<{ value: string }>).detail.value]),
      );
    }
    for (const type of ["ocx:select:change", "ocx:toggle-group:change"]) document.addEventListener(type, () => changes.push(type));
    run.mount(dom, catalog([pkg("a/x/a"), pkg("b/x/b")], [index("a", { root: true }), index("b")]));

    expect(sets).toEqual([
      ["ocx:select:set", "select", "updated"],
      ["ocx:toggle-group:set", "toggle-group", "table"],
      ["ocx:toggle-group:set", "toggle-group", "b"],
    ]);
    expect(changes).toEqual([]);
    expect(controls.map((control) => control.outerHTML)).toEqual(before);
  });

  test("D-047 the controls show the settled state of a cold URL: sort, view, direction, scope, chips and the pinned keywords", async () => {
    history.replaceState(null, "", "/?index=nope&sort=updated&view=table&invert=1&keyword=db&platform=linux&status=deprecated");
    const multi = catalog(
      [
        pkg("a/x/a", { keywords: ["db"], status: "deprecated", updated: "2026-01-01T00:00:00Z" }),
        pkg("a/x/b", { keywords: ["db"], status: "deprecated", updated: "2026-02-01T00:00:00Z" }),
        pkg("b/x/c", { keywords: ["db"], status: "deprecated" }),
      ],
      [index("a", { root: true }), index("b", { default: true })],
    );
    const dom = gridDom({ scope: "toggle", ssrScope: "a" });
    run.mount(dom, multi);
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));

    expect(text(document.querySelector("[data-grid-sort] .ocx-ui-select__value"))).toBe("updated");
    expect(document.querySelector('[data-grid-view] [aria-checked="true"]')?.id).toBe("toggle-group:view:table");
    expect(document.querySelector('[data-grid-scope] [aria-checked="true"]')?.id).toBe("toggle-group:scope:b");
    expect(pressed(dom.invert)).toBe(true);
    expect([pressed(platformChip("linux")), pressed(statusChip("deprecated")), pressed(statusChip("yanked"))]).toEqual([true, true, false]);
    expect(chipNames(dom.rail)).toEqual(["db"]);
    expect(pressed(chipsOf(dom.rail)[0]!)).toBe(true);
    // Scope b is the default the unknown "nope" fell to; only its package matches the facets.
    expect(keys(dom.table)).toEqual(["b/x/c"]);
    expect(location.search).toBe("?index=b&sort=updated&view=table&keyword=db&platform=linux&status=deprecated&invert=1");
  });

  test("D-047 a sort Select whose markup lacks the option leaves its shown value alone rather than throwing", async () => {
    history.replaceState(null, "", "/?sort=updated");
    const dom = gridDom();
    document.querySelector('[data-grid-sort] option[value="updated"]')!.remove();
    run.mount(dom, catalog([pkg("a/x/a")]));
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(text(document.querySelector("[data-grid-sort] .ocx-ui-select__value"))).toBe("name");
  });
});

describe("C12 search, sort and count", () => {
  const packages = [
    pkg("a/x/a", { updated: "2026-01-01T00:00:00Z", keywords: ["k1"] }),
    pkg("a/x/b", { updated: "2026-03-01T00:00:00Z", keywords: ["k1"] }),
    pkg("a/x/c", { updated: null, keywords: ["k2"] }),
  ];

  test("D-007 the result count is rewritten only when its text changes, so a screen reader is not told the same thing twice", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    const watcher = new MutationObserver(() => undefined);
    watcher.observe(dom.count, { childList: true, characterData: true, subtree: true });

    pickSort("updated");
    emit(dom.invert, "ocx:toggle-button:change", { pressed: true });
    click(document.querySelector('[data-grid-view] [data-part="item"]'));
    expect(watcher.takeRecords()).toHaveLength(0);

    type(dom.search, "a/x/b");
    expect(watcher.takeRecords().length).toBeGreaterThan(0);
    expect(dom.count.textContent).toBe("1 of 3 packages");
    type(dom.search, "");
    expect(dom.count.textContent).toBe("3 packages");
    watcher.disconnect();
  });

  test("D-020 a second Escape blurs the field; the first, which clears, is the theme's and leaves focus alone", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    dom.search.focus();
    type(dom.search, "abc");
    press(dom.search, "Escape");
    // No theme in this page: the text is still there, so this Escape must not blur.
    expect(document.activeElement).toBe(dom.search);

    dom.search.value = "";
    press(dom.search, "Escape");
    expect(document.activeElement).not.toBe(dom.search);
  });

  test("D-020 focusing the field selects what it holds, and only the first mouseup after focus is held back", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    type(dom.search, "abcd");
    dom.search.dispatchEvent(new FocusEvent("focus"));
    expect([dom.search.selectionStart, dom.search.selectionEnd]).toEqual([0, 4]);

    const first = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    dom.search.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    const second = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    dom.search.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
  });

  test("D-021 Tab with Ctrl, Alt or Meta is not hijacked; bare Tab still is", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(press(dom.search, "Tab", init).defaultPrevented).toBe(false);
    }
    expect(press(dom.search, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dom.cards.querySelector("a[data-card]"));
  });

  test("D-021 on a cold URL the server cards sit hidden behind the skeleton: Tab is left alone until the results are in", async () => {
    history.replaceState(null, "", "/?q=a");
    const dom = gridDom({ ssrCards: ["a/x/a"] });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    run.mount(dom, async () => {
      await gate;
      return { ok: true, status: 200, json: async () => catalog(packages) };
    });
    await vi.waitFor(() => expect(dom.cards.hidden).toBe(true));
    expect(press(dom.search, "Tab").defaultPrevented).toBe(false);

    release();
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(press(dom.search, "Tab").defaultPrevented).toBe(true);
  });

  test("D-022 picking another sort key starts from its natural order: the direction button is released", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    emit(dom.invert, "ocx:toggle-button:change", { pressed: true });
    expect(pressed(dom.invert)).toBe(true);
    expect(keys(dom.cards)).toEqual(["a/x/c", "a/x/b", "a/x/a"]);

    pickSort("updated");
    expect(pressed(dom.invert)).toBe(false);
    expect(keys(dom.cards)).toEqual(["a/x/b", "a/x/a", "a/x/c"]);
    expect(location.search).toBe("?sort=updated");
  });

  test("D-022 the direction button names the next click, and carries the order in the URL", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    expect(dom.invert.getAttribute("title")).toBe("invert order");
    emit(dom.invert, "ocx:toggle-button:change", { pressed: true });
    expect(dom.invert.getAttribute("title")).toBe("natural order");
    expect(location.search).toBe("?invert=1");
    emit(dom.invert, "ocx:toggle-button:change", { pressed: false });
    expect(dom.invert.getAttribute("title")).toBe("invert order");
    expect(location.search).toBe("");
  });

  test("D-048 the toolbar's clear button is the one beside the count, and clears query, chips and status together", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    const clear = dom.toolbar.querySelector<HTMLElement>("[data-grid-clear]")!;
    type(dom.search, "a");
    click(platformChip("linux"));
    expect(clear.hidden).toBe(false);
    click(clear);
    expect([dom.search.value, pressed(platformChip("linux")), clear.hidden]).toEqual(["", false, true]);
  });

  test("a keyword, platform and status chip each write their own URL param (the D-047 cold-URL test restores them)", async () => {
    const dom = gridDom();
    await run.open(dom, catalog(packages));
    click(chipsOf(dom.rail).find((chip) => chip.dataset.keyword === "k1")!);
    click(platformChip("linux"));
    click(statusChip("yanked"));
    expect(location.search).toBe("?keyword=k1&platform=linux&status=yanked");
  });

  test("a platform the page has no chip for is dropped from the URL, not carried as a filter", async () => {
    history.replaceState(null, "", "/?platform=beos&platform=linux");
    const dom = gridDom();
    run.mount(dom, catalog(packages));
    await vi.waitFor(() => expect(dom.skeleton.hidden).toBe(true));
    expect(location.search).toBe("?platform=linux");
  });
});
