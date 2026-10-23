// @vitest-environment jsdom
//
// The shipped detail page feeds its eager script: the `<article data-detail>` of the BUILT tools/modern
// page (two releases, an alias chain, four install flavors) is mounted with `client/detail.ts`. A drift
// between the templates (`IdentityBlock`, `VersionList`, `InstallCard`, `MetaRail`, `PlatformMatrix`) and
// the DOM contract at the top of that file fails here, which unit tests on a hand-made DOM cannot show;
// so does a drift between the texts the script writes onto the copy hosts and the items of the theme's
// `CopyMenu` the templates render. Nothing is fetched.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { mount as mountDetail } from "../../src/site/client/detail.js";
import type { FetchLike } from "../../src/site/lib/wireTypes.js";

// `./helpers.js` is not imported: it resolves the repo root from `import.meta.url`, which a DOM
// environment rewrites. The provided value is the same one `site("catalog")` returns.
const catalogSite = (): string => (inject as (key: string) => Record<string, string>)("acceptanceSites").catalog as string;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function load(route: string): Promise<HTMLElement> {
  const html = await readFile(join(catalogSite(), route, "index.html"), "utf8");
  const article = html.slice(html.indexOf("<article"), html.lastIndexOf("</article>") + "</article>".length);
  expect(article, "the built page has an <article>").not.toBe("");
  document.body.innerHTML = article;
  return document.querySelector<HTMLElement>("article[data-detail]") as HTMLElement;
}

/** Stubs the async clipboard; the returned spy sees every write. */
function clipboard() {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}
/** The titles of the toasts the page dispatches, in order. */
function toastLog(): string[] {
  const titles: string[] = [];
  document.addEventListener("ocx:toast", (event) => titles.push((event as CustomEvent<{ title: string }>).detail.title));
  return titles;
}

const BASE = "/catalog/";
/** A fetch served from the built site on disk, as the host would serve it under `/catalog/`; every other path is a 404. */
function mirror(): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    try {
      const body = JSON.parse(await readFile(join(catalogSite(), url.slice(BASE.length)), "utf8")) as unknown;
      return { ok: true, status: 200, json: async () => body };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  return Object.assign(fetchFn, { calls }) as FetchLike & { calls: string[] };
}
const chipTags = (root: HTMLElement) => new Set([...root.querySelectorAll("[data-versions-list] [data-tag]")].map((el) => (el as HTMLElement).dataset.tag));

const memory = (initial?: string) => {
  const store = { value: initial, getItem: () => store.value ?? null, setItem: (_k: string, v: string) => void (store.value = v) };
  return store;
};
const field = (root: HTMLElement, row: string) => root.querySelector(`[data-row="${row}"] [data-field]`) as HTMLElement | null;
/** What the theme's CommandBars are told (the island only sends `ocx:command-bar:set`); attach before mounting. */
function watchCard(root: HTMLElement) {
  const picker: { value?: string }[] = [];
  root.querySelector("[data-install-pin]")!.addEventListener("ocx:command-bar:set", (event) => picker.push((event as CustomEvent<{ value?: string }>).detail));
  const rows = [...root.querySelectorAll("[data-install-row]")];
  const heard = rows.map(() => "");
  rows.forEach((row, i) => row.addEventListener("ocx:command-bar:set", (event) => void (heard[i] = (event as CustomEvent<{ command: string }>).detail.command)));
  return { picker, commands: () => heard };
}
/** A person's pick in the picker, as the theme Select announces it. */
const pickPin = (root: HTMLElement, value: string) =>
  root.querySelector("[data-install-pin]")!.dispatchEvent(new CustomEvent("ocx:select:change", { detail: { value } }));
/** Opens the first breakdown with something to fetch, as the browser does: `toggle` on a `details[data-lazy]` now open. */
function openLazy(root: HTMLElement): void {
  const details = root.querySelector<HTMLDetailsElement>("details[data-lazy]")!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
}

describe("the built tools/modern page drives the detail script", () => {
  it("D-060, D-071: the revision shown is the picked tag's release; hovering another tag changes nothing", async () => {
    const root = await load("tools/modern");
    const handle = mountDetail(root, { storage: memory() });
    const opened = field(root, "revision")?.textContent?.trim();
    expect(opened).toMatch(/^[0-9a-f]{40}$/);
    const older = root.querySelector("[data-versions-list] [data-tag='2.0.0']") as HTMLElement;

    older.dispatchEvent(new Event("pointerover", { bubbles: true }));
    older.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(field(root, "revision")?.textContent?.trim()).toBe(opened);

    pickPin(root, "2.1");
    expect(field(root, "revision")?.textContent?.trim()).toBe(opened);
    expect(root.querySelector<HTMLElement>("[data-platforms] [data-platform-set]:not([hidden])")).not.toBeNull();
    handle.destroy();
  });

  it("D-058, D-171: the stored level picks the version, the commands retarget, a person's pick is stored", async () => {
    const root = await load("tools/modern");
    const store = memory("minor");
    const watched = watchCard(root);
    const handle = mountDetail(root, { storage: store });

    expect(watched.picker.at(-1)?.value).toBe("2.1");
    expect(watched.commands()).toEqual([
      "ocx add index-a/tools/modern:2.1",
      "ocx --global add index-a/tools/modern:2.1",
      "ocx package exec index-a/tools/modern:2.1",
      "ocx package install index-a/tools/modern:2.1",
    ]);
    expect(store.value).toBe("minor");

    pickPin(root, "2");
    expect(watched.commands()[0]).toBe("ocx add index-a/tools/modern:2");
    expect(store.value).toBe("major");
    handle.destroy();
  });

  it("D-058, D-073: an install command is copied by the theme's CommandBar, not by the island", async () => {
    const write = clipboard();
    const toasts = toastLog();
    const root = await load("tools/modern");
    const handle = mountDetail(root, { storage: memory() });

    (root.querySelector("[data-install-copy][data-label='Install package'] button.ocx-cmdbar__trigger") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(write).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
    handle.destroy();
  });

  it("D-055: a click on a tag copies name:tag of the tag it is", async () => {
    const write = clipboard();
    const toasts = toastLog();
    const root = await load("tools/many-tags");
    const handle = mountDetail(root, { storage: memory() });
    const tag = root.querySelector("[data-versions-list] [data-tag]") as HTMLElement;

    tag.click();

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(`index-a/tools/many-tags:${tag.dataset.tag}`));
    await vi.waitFor(() => expect(toasts).toEqual([`Copied — :${tag.dataset.tag} identifier`]));
    handle.destroy();
  });

  it("D-074: a click on the package name copies it", async () => {
    const write = clipboard();
    const toasts = toastLog();
    const root = await load("tools/modern");
    const handle = mountDetail(root, { storage: memory() });

    (root.querySelector("[data-name-copy]") as HTMLElement).click();

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("index-a/tools/modern"));
    await vi.waitFor(() => expect(toasts).toEqual(["Copied — package name"]));
    handle.destroy();
  });

  it("D-052: a click on the registry row copies the physical address without the oci:// scheme", async () => {
    const write = clipboard();
    const toasts = toastLog();
    const root = await load("tools/modern");
    const handle = mountDetail(root, { storage: memory() });
    const registry = root.querySelector("[data-row='registry'] [data-registry-copy]") as HTMLElement;
    expect(registry.textContent?.trim()).toBe("oci://ghcr.io/ocx-contrib/tools/modern");

    registry.click();

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("ghcr.io/ocx-contrib/tools/modern"));
    await vi.waitFor(() => expect(toasts).toEqual(["Copied — registry address"]));
    handle.destroy();
  });

  it("D-056, D-073: every copy host carries only texts its own menu has an item for", async () => {
    const root = await load("tools/many-tags");
    const handle = mountDetail(root, { storage: memory() });
    const hosts = [...root.querySelectorAll<HTMLElement>("[data-tag], [data-name-copy], [data-install-copy]")];
    expect(hosts.length).toBeGreaterThan(10);

    for (const host of hosts) {
      const menu = host.closest("[data-zag-root='copy-menu']");
      expect(menu, host.outerHTML).not.toBeNull();
      const values = new Set([...menu!.querySelectorAll("[role='menuitem']")].map((item) => item.getAttribute("data-value") ?? ""));
      const keys = Object.keys(JSON.parse(host.dataset.copy ?? "null") as Record<string, string>);
      expect(keys.length, host.outerHTML).toBeGreaterThan(0);
      for (const key of keys) expect(values.has(key), `${key} on ${host.outerHTML}`).toBe(true);
    }
    handle.destroy();
  });

  it("never fetches", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const root = await load("tools/many-tags");
    const handle = mountDetail(root, { storage: memory() });
    root.querySelector("[data-tag]")?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    pickPin(root, "2");
    handle.destroy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the built tools/many-tags page loads what it did not prerender, from the mirrored package root", () => {
  /** The tags the built root has and the prerendered page does not. */
  async function missing(root: HTMLElement, fetchFn: FetchLike): Promise<string[]> {
    const wire = (await (await fetchFn(`${BASE}${root.querySelector<HTMLElement>("[data-versions]")!.dataset.wireBase}/p/tools/many-tags/_root.json`)).json()) as { tags: object };
    const shown = chipTags(root);
    return Object.keys(wire.tags).filter((tag) => !shown.has(tag));
  }

  it("D-149, D-053: opening a cut breakdown fetches the preloaded _root.json under the base and draws the tags the page left out", async () => {
    const fetchFn = mirror();
    const root = await load("tools/many-tags");
    const left = await missing(root, fetchFn);
    fetchFn.calls.length = 0;
    expect(left.length, "the fixture is cut by the prerender bound").toBeGreaterThan(0);
    const handle = mountDetail(root, { storage: memory(), fetch: fetchFn });
    expect(root.querySelector("[data-versions-more]")).toBeNull();

    openLazy(root);

    await vi.waitFor(() => expect(root.querySelectorAll("[data-lazy]")).toHaveLength(0));
    expect(fetchFn.calls).toHaveLength(1);
    expect(fetchFn.calls[0]).toMatch(/^\/catalog\/(index\/[^/]+\/)?p\/tools\/many-tags\/_root\.json$/);
    for (const tag of left) expect(chipTags(root).has(tag), tag).toBe(true);
    expect(root.querySelector("[data-versions-status]")?.textContent).toBe("");
    expect(root.querySelectorAll("[data-lazy]")).toHaveLength(0);
    handle.destroy();
  });

  it("D-055, D-149: a tag drawn late copies its identifier like a prerendered one", async () => {
    const write = clipboard();
    const toasts = toastLog();
    const fetchFn = mirror();
    const root = await load("tools/many-tags");
    const [late] = await missing(root, fetchFn);
    const handle = mountDetail(root, { storage: memory(), fetch: fetchFn });

    openLazy(root);
    await vi.waitFor(() => expect(chipTags(root).has(late)).toBe(true));
    (root.querySelector(`[data-versions-list] [data-tag="${late}"]`) as HTMLElement).click();

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(`index-a/tools/many-tags:${late}`));
    await vi.waitFor(() => expect(toasts).toEqual([`Copied — :${late} identifier`]));
    handle.destroy();
  });

  it("D-060, D-071: a tag drawn late is not previewed on hover: only the package root is ever fetched", async () => {
    const fetchFn = mirror();
    const root = await load("tools/many-tags");
    const [late] = await missing(root, fetchFn);
    fetchFn.calls.length = 0;
    const handle = mountDetail(root, { storage: memory(), fetch: fetchFn });
    openLazy(root);
    await vi.waitFor(() => expect(chipTags(root).has(late)).toBe(true));
    const opened = field(root, "revision")?.textContent?.trim();

    (root.querySelector(`[data-versions-list] [data-tag="${late}"]`) as HTMLElement).dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchFn.calls).toHaveLength(1);
    expect(field(root, "revision")?.textContent?.trim()).toBe(opened);
    handle.destroy();
  });

  it("D-093: a mirror that does not serve the root leaves the page as built and says why", async () => {
    const root = await load("tools/many-tags");
    const before = chipTags(root).size;
    const handle = mountDetail(root, { storage: memory(), fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });

    openLazy(root);

    await vi.waitFor(() => expect(root.querySelector("[data-versions-status]")?.textContent).toBe("Failed to load: HTTP 500"));
    expect(chipTags(root).size).toBe(before);
    handle.destroy();
  });
});
