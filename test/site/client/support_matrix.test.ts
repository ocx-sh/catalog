// @vitest-environment happy-dom
//
// The support-matrix dialog's rows (D-149): the island that fills the shell `PlatformMatrix.astro` renders. The test
// builds that shell (the contract is the header of `client/support_matrix.ts`) and drives it as a visitor does.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountSupportMatrix } from "../../../src/site/client/support_matrix.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";

const LINUX = "linux/amd64";
const MAC = "darwin/arm64";

function shell(options: { note?: boolean; url?: string } = {}): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-support-matrix", "");
  host.dataset.supportUrl = options.url ?? "/data/catalog/support/idx/acme/tool.json";
  host.innerHTML = `
    <div role="group">
      <button type="button" data-matrix-require="${LINUX}" aria-pressed="false">${LINUX}</button>
      <button type="button" data-matrix-require="${MAC}" aria-pressed="false">${MAC}</button>
    </div>
    <table data-matrix-table aria-busy="true"><thead><tr>
      <th>Version</th><th data-matrix-col="${LINUX}">${LINUX}</th><th data-matrix-col="${MAC}">${MAC}</th>${options.note ? "<th data-matrix-note>Note</th>" : ""}
    </tr></thead><tbody data-matrix-rows></tbody></table>
    <div data-matrix-skeleton><span class="ocx-ui-skeleton"></span></div>
    <p data-matrix-empty hidden>none</p>
    <p data-matrix-error hidden>failed <button type="button" data-matrix-retry>Retry</button></p>`;
  document.body.replaceChildren(host);
  return host;
}

const ROWS = {
  rows: [
    { tag: "2.0.0", platforms: [LINUX, MAC], ephemeral: false },
    { tag: "1.9.0-snapshot", platforms: [LINUX], ephemeral: true },
    { tag: "1.0.0", platforms: [MAC], ephemeral: false },
  ],
};
const ok = (body: unknown): Awaited<ReturnType<FetchLike>> => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number): Awaited<ReturnType<FetchLike>> => ({ ok: false, status, json: async () => ({}) });

const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;
const tags = (host: HTMLElement) => [...host.querySelectorAll("tbody tr")].map((row) => row.firstElementChild?.textContent);
const shownTags = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("tbody tr")].filter((row) => !row.hidden).map((row) => row.firstElementChild?.textContent);
const busy = (host: HTMLElement) => q(host, "[data-matrix-table]").getAttribute("aria-busy");

let handle: { destroy(): void } | undefined;
const start = (host: HTMLElement, fetch: FetchLike, name = "idx/acme/tool") => {
  const mounted = mountSupportMatrix(host, { fetch, name });
  handle = mounted;
  return mounted;
};

beforeEach(() => document.body.replaceChildren());
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  vi.unstubAllGlobals();
});

describe("loading the rows", () => {
  test("D-149 the skeleton shows and the table is busy until the rows arrive, then the rows replace it", async () => {
    const host = shell();
    let release: (value: Awaited<ReturnType<FetchLike>>) => void = () => {};
    const { ready } = start(host, () => new Promise((resolve) => (release = resolve)));

    expect(busy(host)).toBe("true");
    expect(q(host, "[data-matrix-skeleton]").hidden).toBe(false);
    expect(tags(host)).toEqual([]);

    release(ok(ROWS));
    await ready;

    expect(tags(host)).toEqual(["2.0.0", "1.9.0-snapshot", "1.0.0"]);
    expect(busy(host)).toBe("false");
    expect(q(host, "[data-matrix-skeleton]").hidden).toBe(true);
    expect(q(host, "[data-matrix-error]").hidden).toBe(true);
  });

  test("D-149 a row has the version first, a check per supported platform and the copy texts of its tag", async () => {
    const host = shell();
    await start(host, async () => ok(ROWS)).ready;

    const cells = (row: Element) => [...row.children].map((cell) => cell.textContent);
    const [first, second] = host.querySelectorAll("tbody tr");
    expect(cells(first!)).toEqual(["2.0.0", "✓", "✓"]);
    expect(cells(second!)).toEqual(["1.9.0-snapshot", "✓", ""]);
    expect(first!.hasAttribute("data-ocx-row")).toBe(true);
    const copy = JSON.parse(first!.getAttribute("data-copy")!) as Record<string, string>;
    expect(copy.identifier).toBe("idx/acme/tool:2.0.0");
  });

  test("D-149 the Note column, when the header has one, names an ephemeral tag", async () => {
    const host = shell({ note: true });
    await start(host, async () => ok(ROWS)).ready;

    expect([...host.querySelectorAll("tbody tr")].map((row) => row.lastElementChild?.textContent)).toEqual(["", "ephemeral: may be pruned", ""]);
  });

  test("D-149 the URL is fetched as the page wrote it, base included", async () => {
    const host = shell({ url: "/catalog/data/catalog/support/idx/acme/tool.json" });
    const fetch = vi.fn(async () => ok(ROWS));
    await start(host, fetch).ready;

    expect(fetch).toHaveBeenCalledExactlyOnceWith("/catalog/data/catalog/support/idx/acme/tool.json");
  });

  test("D-149 without an injected fetch the global one is used", async () => {
    const fetch = vi.fn(async () => ok(ROWS));
    vi.stubGlobal("fetch", fetch);
    const host = shell();
    await mountSupportMatrix(host, { name: "idx/acme/tool" }).ready;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tags(host)).toHaveLength(3);
  });
});

describe("a failed load", () => {
  test.each([
    ["an HTTP error", async () => fail(500)],
    ["a 404", async () => fail(404)],
    ["a body that is not a list of tags", async () => ok({ rows: [{ tag: 1 }] })],
    ["a body that is not an object", async () => ok(null)],
    ["a network error", async () => Promise.reject(new Error("offline"))],
  ] as const)("D-149 %s shows the inline error and ends the busy state, never throws", async (_name, response) => {
    const host = shell();
    await start(host, response).ready;

    expect(q(host, "[data-matrix-error]").hidden).toBe(false);
    expect(busy(host)).toBe("false");
    expect(q(host, "[data-matrix-skeleton]").hidden).toBe(true);
    expect(tags(host)).toEqual([]);
  });

  test("D-149 Retry asks again: the skeleton returns, then the rows replace the error", async () => {
    const host = shell();
    const fetch = vi.fn<FetchLike>().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok(ROWS));
    await start(host, fetch).ready;

    q(host, "[data-matrix-retry]").click();
    expect(q(host, "[data-matrix-error]").hidden).toBe(true);
    expect(q(host, "[data-matrix-skeleton]").hidden).toBe(false);
    expect(busy(host)).toBe("true");
    await vi.waitFor(() => expect(busy(host)).toBe("false"));

    expect(tags(host)).toHaveLength(3);
    expect(q(host, "[data-matrix-error]").hidden).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("D-149 two Retry clicks while a request is out make one request", async () => {
    const host = shell();
    let release: (value: Awaited<ReturnType<FetchLike>>) => void = () => {};
    const fetch = vi.fn<FetchLike>().mockResolvedValueOnce(fail(500)).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await start(host, fetch).ready;

    q(host, "[data-matrix-retry]").click();
    q(host, "[data-matrix-retry]").click();
    release(ok(ROWS));
    await vi.waitFor(() => expect(busy(host)).toBe("false"));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(tags(host)).toHaveLength(3);
  });
});

describe("the platform chips", () => {
  test("D-149 a pressed chip keeps the rows that ship for it; two chips mean ships both; unpressing widens", async () => {
    const host = shell();
    await start(host, async () => ok(ROWS)).ready;
    const chip = (label: string) => q(host, `[data-matrix-require="${label}"]`);

    chip(LINUX).click();
    expect(shownTags(host)).toEqual(["2.0.0", "1.9.0-snapshot"]);
    expect(chip(LINUX).getAttribute("aria-pressed")).toBe("true");
    chip(MAC).click();
    expect(shownTags(host)).toEqual(["2.0.0"]);
    chip(LINUX).click();
    expect(shownTags(host)).toEqual(["2.0.0", "1.0.0"]);
    expect(q(host, "[data-matrix-empty]").hidden).toBe(true);
  });

  test("D-149 chips pressed before the rows arrive apply to them; none left says so", async () => {
    const host = shell();
    let release: (value: Awaited<ReturnType<FetchLike>>) => void = () => {};
    const { ready } = start(host, () => new Promise((resolve) => (release = resolve)));
    q(host, `[data-matrix-require="${MAC}"]`).click();
    expect(q(host, "[data-matrix-empty]").hidden).toBe(true);

    release(ok({ rows: [{ tag: "1.0.0", platforms: [LINUX], ephemeral: false }] }));
    await ready;

    expect(shownTags(host)).toEqual([]);
    expect(q(host, "[data-matrix-empty]").hidden).toBe(false);
  });

  test("D-149 a click elsewhere in the dialog does nothing, and a destroyed island hears no more clicks", async () => {
    const host = shell();
    const mounted = start(host, async () => ok(ROWS));
    await mounted.ready;

    q(host, "[data-matrix-table]").click();
    mounted.destroy();
    q(host, `[data-matrix-require="${LINUX}"]`).click();

    expect(q(host, `[data-matrix-require="${LINUX}"]`).getAttribute("aria-pressed")).toBe("false");
    expect(shownTags(host)).toHaveLength(3);
  });
});
