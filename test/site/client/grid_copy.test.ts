// @vitest-environment happy-dom
//
// Copying from the catalog (ledger D-001, D-002): the install command on a card copies itself, and every card
// and row carries the texts the theme's copy menu offers on right-click.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { DEFAULT_INSTALL_FLAVORS, installCommand } from "../../../src/site/lib/installFlavors.js";
import { gridDom } from "./grid_dom.js";
import { catalog, click, keys, pickView, pkg, useGridRun } from "./grid_harness.js";

const run = useGridRun();

/** Stubs the async clipboard; `null` takes it away (an insecure context). */
function clipboard(write: ((text: string) => Promise<void>) | null) {
  const writeText = write === null ? undefined : vi.fn(write);
  vi.stubGlobal("navigator", { clipboard: writeText && { writeText } });
  return writeText;
}

const toasts = () => {
  const seen: { title: string; tone?: string; slot?: string }[] = [];
  document.addEventListener("ocx:toast", (event) => seen.push((event as CustomEvent).detail));
  return seen;
};

const installOf = (list: HTMLElement, name: string) =>
  list.querySelector<HTMLButtonElement>(`[data-key="${name}"] [data-grid-install]`)!;

/** Waits on real I/O ticks, which fake timers leave alone (`vi.waitFor` would advance them). */
async function until(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 200 && !condition(); tick++) await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

afterEach(() => vi.useRealTimers());

// The click loads the copy code on demand; warm it so the first test does not wait on the transform.
beforeAll(() => import("@ocx-sh/theme/copy"));

describe("D-001 the install command on a card copies itself", () => {
  const data = catalog([pkg("a/acme/tool", { latestVersion: "2.0.0" })]);

  test("D-001 a click copies the card's one-line command, toasts it, and marks the button copied for 1.5 s", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const dom = gridDom();
    await run.open(dom, data);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const button = installOf(dom.cards, "a/acme/tool");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await until(() => button.hasAttribute("data-copied"));
    expect(write).toHaveBeenCalledExactlyOnceWith(installCommand(DEFAULT_INSTALL_FLAVORS[0]!.command, "a/acme/tool"));
    expect(seen).toEqual([{ title: "Copied — install command", duration: 2000, slot: "copy" }]);

    vi.advanceTimersByTime(1499);
    expect(button.hasAttribute("data-copied")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button.hasAttribute("data-copied")).toBe(false);
  });

  test("D-001 the click never follows the card's link", async () => {
    clipboard(async () => {});
    const dom = gridDom();
    await run.open(dom, data);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    installOf(dom.cards, "a/acme/tool").dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    // A click on the card itself still navigates.
    const onCard = new MouseEvent("click", { bubbles: true, cancelable: true });
    dom.cards.querySelector("a[data-card]")!.dispatchEvent(onCard);
    expect(onCard.defaultPrevented).toBe(false);
  });

  test("D-001 the click stops at the grid: no listener above it (a link interceptor, an analytics hook) sees it as a link click", async () => {
    clipboard(async () => {});
    const dom = gridDom();
    await run.open(dom, data);
    const above = vi.fn();
    document.addEventListener("click", above);
    try {
      installOf(dom.cards, "a/acme/tool").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(above).not.toHaveBeenCalled();
      // Control: a click on the card itself does bubble past the grid, so the spy can see one.
      dom.cards.querySelector("a[data-card]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(above).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", above);
    }
  });

  test("D-001 a second copy restarts the copied window", async () => {
    const write = clipboard(async () => {})!;
    const dom = gridDom();
    await run.open(dom, data);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const button = installOf(dom.cards, "a/acme/tool");
    click(button);
    await until(() => button.hasAttribute("data-copied"));
    vi.advanceTimersByTime(1000);
    click(button);
    await until(() => write.mock.calls.length === 2);
    await until(() => vi.getTimerCount() === 1);
    vi.advanceTimersByTime(1000);
    expect(button.hasAttribute("data-copied")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(button.hasAttribute("data-copied")).toBe(false);
  });

  test("D-001 a clipboard that is missing or refuses says 'Copy failed' and marks nothing copied", async () => {
    const seen = toasts();
    const dom = gridDom();
    await run.open(dom, data);
    const button = installOf(dom.cards, "a/acme/tool");
    for (const write of [null, async () => Promise.reject(new Error("denied"))]) {
      seen.length = 0;
      clipboard(write);
      click(button);
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ title: "Copy failed", tone: "danger" });
      expect(button.hasAttribute("data-copied")).toBe(false);
    }
  });

  test("D-001 a card the server rendered copies before the island has loaded anything", async () => {
    const write = clipboard(async () => {});
    const dom = gridDom();
    dom.cards.innerHTML = `<li><a data-card href="/a/acme/tool/"><button type="button" data-grid-install><span data-field="install">ocx add a/acme/tool</span></button></a></li>`;
    const fetch = run.mount(dom, data);
    click(dom.cards.querySelector("[data-grid-install]"));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("ocx add a/acme/tool"));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("D-001 a click on something that is not an install button copies nothing", async () => {
    const write = clipboard(async () => {});
    const dom = gridDom();
    await run.open(dom, data);
    click(dom.cards.querySelector('[data-key="a/acme/tool"] [data-field="title"]'));
    click(dom.count);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("D-002 every card and row offers the copy menu its texts", () => {
  const data = catalog([
    pkg("a/acme/tool", { latestVersion: "2.0.0" }),
    pkg("a/acme/untagged", { latestVersion: null }),
  ]);
  const texts = (el: Element | null) => JSON.parse((el as HTMLElement).dataset.copy ?? "null") as Record<string, string>;

  test("D-002 a card carries identifier, tag, the absolute qualified link and one command per install flavor", async () => {
    const dom = gridDom({ base: "/catalog/" });
    await run.open(dom, data);
    const map = texts(dom.cards.querySelector('a[data-key="a/acme/tool"]'));
    expect(map).toEqual({
      identifier: "a/acme/tool:2.0.0",
      tag: "2.0.0",
      link: `${location.origin}/catalog/acme/tool/`,
      project: "ocx add a/acme/tool:2.0.0",
      global: "ocx --global add a/acme/tool:2.0.0",
      exec: "ocx package exec a/acme/tool:2.0.0",
      install: "ocx package install a/acme/tool:2.0.0",
    });
  });

  test("D-002 a package with no tag offers no 'Copy tag' and copies its bare name", async () => {
    const dom = gridDom();
    await run.open(dom, data);
    const map = texts(dom.cards.querySelector('a[data-key="a/acme/untagged"]'));
    expect(Object.keys(map)).not.toContain("tag");
    expect(map["identifier"]).toBe("a/acme/untagged");
    expect(map["project"]).toBe("ocx add a/acme/untagged");
  });

  test("D-002 a table row carries the same texts as its card", async () => {
    const dom = gridDom();
    await run.open(dom, data);
    const card = texts(dom.cards.querySelector('a[data-key="a/acme/tool"]'));
    pickView("table");
    expect(keys(dom.table)).toEqual(["a/acme/tool", "a/acme/untagged"]);
    expect(texts(dom.table.querySelector('a[data-key="a/acme/tool"]'))).toEqual(card);
  });

  test("D-002 a card the server rendered gains its absolute link when the island mounts; the other texts stay", () => {
    const dom = gridDom();
    dom.cards.innerHTML = `<li><a data-card href="/catalog/a/acme/tool/" data-copy='{"identifier":"a/acme/tool"}'>x</a></li><li><a data-card>no href</a></li>`;
    run.mount(dom, data);
    const [first, second] = dom.cards.querySelectorAll<HTMLElement>("a[data-card]");
    expect(JSON.parse(first!.dataset.copy!)).toEqual({ identifier: "a/acme/tool", link: `${location.origin}/catalog/a/acme/tool/` });
    expect(second!.dataset.copy).toBeUndefined();
  });
});
