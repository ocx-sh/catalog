// @vitest-environment happy-dom
//
// The palette island against the LazyMount double (C-033). The test plays the
// theme's part: it answers `ocx:list:filter` with `ocx:list:fetch` the way the
// async List machine does, and reads the island's `respond(...)` promise.
// Parity rows ported from test/theme: palette_route_wiring (qualified route for
// a non-root index), search_shortcut_kbd_wiring (Mod = Meta or Ctrl, either
// spelling opens), useCommandPalette (shortcuts, editable-focus skip, unmount
// removes the listener, "/" is opt-in, unrelated keys ignored).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountPalette, type PaletteOptions } from "../../../src/site/client/palette.js";
import type { LazyMount, MountHandle } from "../../../src/site/client/mount.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { createLazyDouble } from "./lazy_double.js";

interface Row {
  value: string;
  label: string;
  description: string;
}
type Answer = Promise<{ items: Row[] }>;

function pkg(name: string, title: string, keywords: string[] = []) {
  const [, namespace, ...rest] = name.split("/");
  return {
    namespace,
    package: rest.join("/"),
    name,
    status: "active",
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title,
    description: `${title} description`,
    keywords,
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}

/** Same id published by two indexes; `corp.example` is left out of the "all" tab. */
const AGGREGATED = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: true, default: true, count: 1 },
    { name: "corp.example", root: false, default: false, excludeFromAll: true, count: 1 },
  ],
  packages: [pkg("ocx.sh/tools/widget", "Widget"), pkg("corp.example/tools/widget", "Widget")],
};

function el(tag: string, attributes: Record<string, string> = {}, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** The markup `components/Palette.astro` (K.2) renders, minus the theme's styling. */
function palette(attributes: Record<string, string>) {
  const trigger = el("button", { type: "button", "data-palette-trigger": "" });
  const input = el("input", { type: "search" }) as HTMLInputElement;
  const status = el("p", { "data-palette-status": "", role: "status" });
  const list = el("div", { "data-zag-root": "listbox", "data-ocx-async": "" });
  const dialog = el("div", { "data-zag-root": "dialog", "data-zag-id": "palette-dialog" }, input, status, list);
  const root = el("div", attributes, trigger, dialog);
  document.body.replaceChildren(root);
  return { root, trigger, dialog, input, status, list };
}

/** Plays the async List machine: a filter command becomes a fetch event, whose answer is kept. */
function listenAsTheme(list: HTMLElement): Answer[] {
  const answers: Answer[] = [];
  list.addEventListener("ocx:list:filter", (event) => {
    const { text } = (event as CustomEvent<{ text: string }>).detail;
    list.dispatchEvent(
      new CustomEvent("ocx:list:fetch", {
        bubbles: true,
        detail: { filter: text, respond: (answer: Answer) => answers.push(answer) },
      }),
    );
  });
  return answers;
}

function catalogFetch(payload: unknown) {
  return vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => payload }) as Response);
}

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function dialogOpens(): Array<{ id: string }> {
  const opens: Array<{ id: string }> = [];
  document.addEventListener("ocx:dialog:open", (event) => opens.push((event as CustomEvent<{ id: string }>).detail));
  return opens;
}

function change(target: HTMLElement, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}

let unmount: (() => void) | undefined;
function mountIt(
  root: HTMLElement,
  options: PaletteOptions = {},
  lazy: LazyMount = createLazyDouble(),
): { destroy(): void } {
  const mounted = mountPalette(root, lazy, options);
  unmount = mounted.destroy;
  return mounted;
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  { base: "/", catalogUrl: "/data/catalog/catalog.json", widget: "/tools/widget/", corp: "/corp.example/tools/widget/" },
  {
    base: "/catalog/",
    catalogUrl: "/catalog/data/catalog/catalog.json",
    widget: "/catalog/tools/widget/",
    corp: "/catalog/corp.example/tools/widget/",
  },
])("base $base", ({ base, catalogUrl, widget, corp }) => {
  function ready(payload: unknown = AGGREGATED) {
    const dom = palette({ "data-base": base });
    const fetch = catalogFetch(payload);
    const navigate = vi.fn();
    mountIt(dom.root, { fetch, navigate });
    const opens = dialogOpens();
    return { ...dom, fetch, navigate, opens, answers: listenAsTheme(dom.list) };
  }

  /** Mod+K, then wait until the lazy module is live (the filter listener is attached). */
  async function openPalette(dom: ReturnType<typeof ready>) {
    press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(dom.opens).toHaveLength(1));
  }

  async function ask(dom: ReturnType<typeof ready>, text: string): Promise<Row[]> {
    dom.input.value = text;
    dom.input.dispatchEvent(new Event("input", { bubbles: true }));
    const answer = dom.answers.at(-1);
    return (await answer!).items;
  }

  test("nothing loads before interaction: no fetch, no session, only the lazy mount is registered (C-011)", () => {
    const lazy = createLazyDouble();
    const dom = palette({ "data-base": base });
    const fetch = catalogFetch(AGGREGATED);
    mountIt(dom.root, { fetch }, lazy);
    const filters: Event[] = [];
    dom.list.addEventListener("ocx:list:filter", (event) => filters.push(event));

    dom.input.value = "widget";
    dom.input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fetch).not.toHaveBeenCalled();
    expect(filters).toEqual([]);
    expect(lazy.mounts).toHaveLength(1);
    expect(lazy.mounts[0]?.root).toBe(dom.root);
    expect(lazy.mounts[0]?.spec.trigger).toBe("interaction");
  });

  test("Mod+K opens the dialog by id; both Ctrl and Meta spellings, either letter case", async () => {
    const dom = ready();

    const event = press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(dom.opens).toEqual([{ id: "palette-dialog" }]));
    expect(event.defaultPrevented).toBe(true);

    press({ key: "K", metaKey: true });
    await vi.waitFor(() => expect(dom.opens).toHaveLength(2));
  });

  test("a second open reuses the live session instead of starting another", async () => {
    const dom = ready();
    await openPalette(dom);
    press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(dom.opens).toHaveLength(2));

    dom.input.value = "widget";
    dom.input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(dom.answers).toHaveLength(1);
  });

  test("the header trigger opens the dialog too", async () => {
    const dom = ready();

    dom.trigger.click();

    await vi.waitFor(() => expect(dom.opens).toEqual([{ id: "palette-dialog" }]));
  });

  test("opening the dialog fetches catalog.json once, from the base-joined URL (C-011)", async () => {
    const dom = ready();
    await openPalette(dom);

    change(dom.dialog, "ocx:dialog:change", { open: true });
    await ask(dom, "widget");
    await ask(dom, "wid");

    await vi.waitFor(() => expect(dom.fetch).toHaveBeenCalledTimes(1));
    expect(dom.fetch).toHaveBeenCalledWith(catalogUrl);
  });

  test("closing the dialog fetches nothing", async () => {
    const dom = ready();
    await openPalette(dom);

    change(dom.dialog, "ocx:dialog:change", { open: false });

    expect(dom.fetch).not.toHaveBeenCalled();
  });

  test("results are packages, ignore excludeFromAll, and link through packageHref (C-009, non-root index qualified)", async () => {
    const dom = ready();
    await openPalette(dom);

    const rows = await ask(dom, "widget");

    expect(rows).toEqual([
      { value: widget, label: "Widget", description: "ocx.sh/tools/widget" },
      { value: corp, label: "Widget", description: "corp.example/tools/widget" },
    ]);
    expect(dom.status.textContent).toBe("");
  });

  test("a single-source catalog keeps bare routes", async () => {
    const dom = ready({ generated: null, packages: [pkg("ocx.sh/tools/widget", "Widget")] });
    await openPalette(dom);

    expect((await ask(dom, "widget")).map((row) => row.value)).toEqual([widget]);
  });

  test("a catalog with no root index qualifies every route", async () => {
    const dom = ready({
      generated: null,
      indexes: [{ name: "corp.example", root: false, default: true, count: 1 }],
      packages: [pkg("corp.example/tools/widget", "Widget")],
    });
    await openPalette(dom);

    expect((await ask(dom, "widget")).map((row) => row.value)).toEqual([corp]);
  });

  test("shows at most eight results", async () => {
    const many = Array.from({ length: 10 }, (_, i) => pkg(`ocx.sh/tools/widget-${i}`, `Widget ${i}`));
    const dom = ready({ generated: null, packages: many });
    await openPalette(dom);

    expect(await ask(dom, "widget")).toHaveLength(8);
  });

  test("a blank query answers with no rows and never fetches", async () => {
    const dom = ready();
    await openPalette(dom);

    expect(await ask(dom, "   ")).toEqual([]);
    expect(dom.fetch).not.toHaveBeenCalled();
  });

  test("zero matches shows the empty state as text, and a later match clears it", async () => {
    const dom = ready();
    await openPalette(dom);

    expect(await ask(dom, "<img src=x onerror=alert(1)>")).toEqual([]);
    expect(dom.status.textContent).toBe("No packages match “<img src=x onerror=alert(1)>”.");
    expect(dom.status.children).toHaveLength(0);

    expect(await ask(dom, "widget")).toHaveLength(2);
    expect(dom.status.textContent).toBe("");
  });

  test("a genuine 404 is an empty catalog: the empty state, not an error", async () => {
    const dom = ready();
    dom.fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await openPalette(dom);

    expect(await ask(dom, "widget")).toEqual([]);
    expect(dom.status.textContent).toBe("No packages match “widget”.");
  });

  test("a failed fetch is an inline error and the answer rejects; the next query retries", async () => {
    const dom = ready();
    dom.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await openPalette(dom);

    await expect(ask(dom, "widget")).rejects.toThrow("HTTP 500");
    expect(dom.status.textContent).toBe("Could not load the package list.");

    expect(await ask(dom, "widget")).toHaveLength(2);
    expect(dom.status.textContent).toBe("");
    expect(dom.fetch).toHaveBeenCalledTimes(2);
  });

  test("a failed prefetch on open shows the inline error without a query", async () => {
    const dom = ready();
    dom.fetch.mockRejectedValueOnce(new TypeError("network down"));
    await openPalette(dom);

    change(dom.dialog, "ocx:dialog:change", { open: true });

    await vi.waitFor(() => expect(dom.status.textContent).toBe("Could not load the package list."));
  });

  test("picking a row navigates to its href (click and keyboard both arrive as ocx:list:change)", async () => {
    const dom = ready();
    await openPalette(dom);

    change(dom.list, "ocx:list:change", { value: [corp] });

    expect(dom.navigate).toHaveBeenCalledExactlyOnceWith(corp);
  });

  test("clearing the selection navigates nowhere", async () => {
    const dom = ready();
    await openPalette(dom);

    change(dom.list, "ocx:list:change", { value: [] });

    expect(dom.navigate).not.toHaveBeenCalled();
  });

  test("Enter in the search field navigates to the first result; other keys and empty results do not", async () => {
    const dom = ready();
    await openPalette(dom);

    press({ key: "Enter" }, dom.input);
    expect(dom.navigate).not.toHaveBeenCalled();

    await ask(dom, "widget");
    press({ key: "ArrowDown" }, dom.input);
    press({ key: "Enter", isComposing: true }, dom.input);
    expect(dom.navigate).not.toHaveBeenCalled();

    press({ key: "Enter" }, dom.input);
    expect(dom.navigate).toHaveBeenCalledExactlyOnceWith(widget);
  });

  test("a stopped session ignores the list, the input and the dialog", async () => {
    const lazy = createLazyDouble();
    const dom = palette({ "data-base": base });
    const fetch = catalogFetch(AGGREGATED);
    const navigate = vi.fn();
    mountIt(dom.root, { fetch, navigate }, lazy);
    const answers = listenAsTheme(dom.list);
    const session = (await lazy.mounts[0]!.spec.load()).start(dom.root);

    session?.stop();
    change(dom.list, "ocx:list:change", { value: [widget] });
    press({ key: "Enter" }, dom.input);
    dom.input.dispatchEvent(new Event("input", { bubbles: true }));
    change(dom.dialog, "ocx:dialog:change", { open: true });

    expect(navigate).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("base resolution", () => {
  test("options.base wins over data-base", async () => {
    const dom = palette({ "data-base": "/ignored/" });
    const fetch = catalogFetch(AGGREGATED);
    mountIt(dom.root, { base: "/catalog/", fetch });
    const opens = dialogOpens();

    press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(opens).toHaveLength(1));
    change(dom.dialog, "ocx:dialog:change", { open: true });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/catalog/data/catalog/catalog.json"));
  });

  test("with neither, mounting throws instead of guessing", () => {
    const dom = palette({});
    expect(() => mountPalette(dom.root, createLazyDouble())).toThrow(/no base/);
  });
});

describe("defaults", () => {
  test("fetch defaults to the global fetch, read when the catalog is needed", async () => {
    const dom = palette({ "data-base": "/" });
    const fetch = catalogFetch(AGGREGATED);
    mountIt(dom.root);
    const opens = dialogOpens();
    const answers = listenAsTheme(dom.list);

    press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(opens).toHaveLength(1));
    vi.stubGlobal("fetch", fetch);
    dom.input.value = "widget";
    dom.input.dispatchEvent(new Event("input", { bubbles: true }));

    expect((await answers[0]!).items).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith("/data/catalog/catalog.json");
  });

  test("navigation defaults to location.assign", async () => {
    const dom = palette({ "data-base": "/" });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    mountIt(dom.root, { fetch: catalogFetch(AGGREGATED) });
    const opens = dialogOpens();

    press({ key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(opens).toHaveLength(1));
    change(dom.list, "ocx:list:change", { value: ["/tools/widget/"] });

    expect(assign).toHaveBeenCalledExactlyOnceWith("/tools/widget/");
  });
});

describe("shortcuts (useCommandPalette parity)", () => {
  function mounted(options: PaletteOptions = {}) {
    const dom = palette({ "data-base": "/" });
    mountIt(dom.root, { fetch: catalogFetch(AGGREGATED), ...options });
    return { ...dom, opens: dialogOpens() };
  }

  test("an unrelated key, or K without a modifier, is ignored", async () => {
    const dom = mounted();

    const a = press({ key: "a", ctrlKey: true });
    const k = press({ key: "k" });
    await Promise.resolve();

    expect(dom.opens).toEqual([]);
    expect(a.defaultPrevented).toBe(false);
    expect(k.defaultPrevented).toBe(false);
  });

  test("the shortcut is skipped while an editable element has focus", async () => {
    const dom = mounted();
    const field = el("input", { type: "text" }) as HTMLInputElement;
    document.body.append(field);
    field.focus();

    const event = press({ key: "k", ctrlKey: true }, field);
    await Promise.resolve();

    expect(dom.opens).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test("/ does not open the palette: the landing page owns it for its filter", async () => {
    const dom = mounted();
    press({ key: "/" });
    await Promise.resolve();
    expect(dom.opens).toEqual([]);
  });

  test("destroy removes the document listener and the trigger click", async () => {
    const lazy = createLazyDouble();
    const dom = palette({ "data-base": "/" });
    const mount = mountIt(dom.root, { fetch: catalogFetch(AGGREGATED) }, lazy);
    const opens = dialogOpens();

    mount.destroy();
    press({ key: "k", ctrlKey: true });
    dom.trigger.click();
    await Promise.resolve();

    expect(opens).toEqual([]);
    expect(lazy.mounts[0]?.destroyed).toBe(true);
  });

  test("a module that failed to start leaves the shortcut a no-op", async () => {
    const dom = palette({ "data-base": "/" });
    const handle: MountHandle = { start: async () => {}, destroy: () => {}, ready: Promise.resolve(), api: undefined };
    const start = vi.spyOn(handle, "start");
    mountIt(dom.root, {}, { mount: () => handle });
    const opens = dialogOpens();

    press({ key: "k", ctrlKey: true });

    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(opens).toEqual([]);
  });
});

describe("markup contract", () => {
  test("a missing part is named in the error", async () => {
    const dom = palette({ "data-base": "/" });
    dom.status.remove();
    const lazy = createLazyDouble();
    mountIt(dom.root, {}, lazy);

    await expect(lazy.mounts[0]!.spec.load().then((module) => module.start(dom.root))).rejects.toThrow(
      "missing [data-palette-status]",
    );
  });

  test("mounting without the trigger throws", () => {
    const dom = palette({ "data-base": "/" });
    dom.trigger.remove();
    expect(() => mountPalette(dom.root, createLazyDouble())).toThrow("missing [data-palette-trigger]");
  });

  test("the island writes DOM through textContent only (no HTML sinks)", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../src/site/client/palette.ts"), "utf8");
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
