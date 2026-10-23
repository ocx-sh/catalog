// @vitest-environment happy-dom
//
// The detail page's entry (C-017): `detail.ts` is not part of the pre-input graph. It loads on the first
// interaction, or at once for a stored pin; a click that beats it is replayed. The entry runs against the real
// `detail.ts`, so a drift between the two shows up here.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { bootDetail } from "../../../src/site/client/detail_entry.js";
import type { PinStorage } from "../../../src/site/lib/installPin.js";

let root: HTMLElement;
let destroy: (() => void) | undefined;
const storage = (value: string | null): PinStorage => ({ getItem: () => value, setItem: () => {} });
/** The tag host `detail.ts` writes `data-copy` on when it starts. */
const tag = (): HTMLElement => root.querySelector<HTMLElement>("[data-tag]") as HTMLElement;
const started = (): boolean => tag().hasAttribute("data-copy");

beforeEach(() => {
  document.body.innerHTML = `<article data-detail data-package="acme/tool">
    <button data-tag="1.0.0" data-release="0">1.0.0</button>
    <div data-readme-provenance data-path="/p/acme/tool/readme.md">
      <button data-part="item" data-value="url"></button><button data-part="item" data-value="curl"></button>
    </div>
  </article>`;
  root = document.querySelector("[data-detail]") as HTMLElement;
});

afterEach(() => {
  destroy?.();
  destroy = undefined;
  vi.restoreAllMocks();
  vi.doUnmock("../../../src/site/client/detail.js");
});

describe("a visitor with no stored pin", () => {
  test("loads nothing until the first interaction", async () => {
    destroy = bootDetail(root, { storage: storage(null) }).destroy;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started()).toBe(false);

    root.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await vi.waitFor(() => expect(started()).toBe(true));
  });

  test("reads the browser's own storage when none is handed in", async () => {
    localStorage.setItem("ocx-install-pin", "major");
    try {
      destroy = bootDetail(root).destroy;
      await vi.waitFor(() => expect(started()).toBe(true));
    } finally {
      localStorage.removeItem("ocx-install-pin");
    }
  });

  test("a stored `latest` is the default too", async () => {
    destroy = bootDetail(root, { storage: storage("latest") }).destroy;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started()).toBe(false);
  });

  test.each(["pointerdown", "focusin", "touchstart"])("%s starts it, once", async (type) => {
    destroy = bootDetail(root, { storage: storage(null) }).destroy;
    root.dispatchEvent(new Event(type, { bubbles: true }));
    root.dispatchEvent(new Event(type, { bubbles: true }));
    await vi.waitFor(() => expect(started()).toBe(true));
  });

  test("a click that beats the module is replayed into it, and the provenance links name the origin", async () => {
    destroy = bootDetail(root, { storage: storage(null) }).destroy;
    root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    tag().click();
    tag().click();
    await vi.waitFor(() => expect(tag().hasAttribute("data-copied")).toBe(true));
    expect(root.querySelector('[data-value="url"]')?.getAttribute("data-copy-text")).toBe(`${location.origin}/p/acme/tool/readme.md`);
  });

  test("a start with no click to replay just mounts", async () => {
    destroy = bootDetail(root, { storage: storage(null) }).destroy;
    root.dispatchEvent(new Event("focusin", { bubbles: true }));
    await vi.waitFor(() => expect(started()).toBe(true));
    expect(tag().hasAttribute("data-copied")).toBe(false);
  });

  test("destroy before any interaction disarms it", async () => {
    bootDetail(root, { storage: storage(null) }).destroy();
    root.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started()).toBe(false);
  });

  test("destroy after the start tears the island down", async () => {
    const entry = bootDetail(root, { storage: storage(null) });
    root.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await vi.waitFor(() => expect(started()).toBe(true));
    entry.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    tag().click();
    expect(tag().hasAttribute("data-copied")).toBe(false);
  });
});

describe("a visitor with a stored pin", () => {
  test("loads at once: the page has a pick to apply", async () => {
    destroy = bootDetail(root, { storage: storage("major") }).destroy;
    await vi.waitFor(() => expect(started()).toBe(true));
  });

  test("blocked storage is the default", async () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
    destroy = bootDetail(root, { storage: blocked }).destroy;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started()).toBe(false);
  });
});

test("a chunk that fails to load is logged and leaves the page as rendered", async () => {
  vi.resetModules();
  vi.doMock("../../../src/site/client/detail.js", () => {
    throw new Error("chunk gone");
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { bootDetail: boot } = await import("../../../src/site/client/detail_entry.js");
  destroy = boot(root, { storage: storage("major") }).destroy;
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  expect(String(error.mock.calls[0]?.[0])).toContain("detail script failed");
});
